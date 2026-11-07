import {
  Array,
  Effect,
  FileSystem,
  Function,
  Option,
  Predicate,
  Result,
  Schema,
  type Scope,
  pipe,
} from 'effect'
import type { PlatformError } from 'effect/PlatformError'

import {
  type HeldTurn,
  type LockHolder,
  LockState,
  type SharedSlot,
  classifyLock,
  decodeHeldTurn,
  encodeHeldTurn,
  encodeLockHolder,
  isSameHolder,
  turnFileKey,
} from './decision'

export class LockTaken extends Schema.TaggedError<
  LockTaken,
  { readonly brand: unique symbol }
>()('LockTaken', {}) {}

const hasErrorCode = (error: unknown, code: string): boolean =>
  Predicate.hasProperty(error, 'code') && error.code === code

// NOTE: signal 0 checks that the pid exists without touching it. EPERM means
// the process exists but belongs to another user, so it is still alive.
export const isProcessAlive = (pid: number): boolean =>
  pipe(
    Result.try(() => process.kill(pid, 0)),
    Result.match({
      onSuccess: () => true,
      onFailure: error => hasErrorCode(error, 'EPERM'),
    }),
  )

/** @stability unstable */
export const readTextIfPresent = (
  path: string,
): Effect.Effect<Option.Option<string>, PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    return yield* fs.readFileString(path).pipe(
      Effect.asSome,
      Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeedNone),
    )
  })

// NOTE: the holder is written to a draft first and hard linked into place.
// The link fails when the lock exists, so taking the lock is atomic and no
// reader ever sees a half written lock file.
const createLock = (
  path: string,
  holder: LockHolder,
): Effect.Effect<void, LockTaken | PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const draft = `${path}.${holder.pid}.draft`
    yield* fs.writeFileString(draft, encodeLockHolder(holder))
    yield* fs.link(draft, path).pipe(
      Effect.catchReason('PlatformError', 'AlreadyExists', () =>
        Effect.fail(LockTaken.make({})),
      ),
      Effect.ensuring(Effect.ignore(fs.remove(draft, { force: true }))),
    )
  })

// NOTE: removes the lock only while it still names this holder, so a
// second release, or one after another guard took the file, does nothing.
/** @stability unstable */
export const releaseLock: {
  (
    holder: LockHolder,
  ): (path: string) => Effect.Effect<void, never, FileSystem.FileSystem>
  (
    path: string,
    holder: LockHolder,
  ): Effect.Effect<void, never, FileSystem.FileSystem>
} = Function.dual(
  2,
  (
    path: string,
    holder: LockHolder,
  ): Effect.Effect<void, never, FileSystem.FileSystem> =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const maybeText = yield* readTextIfPresent(path)
      if (isSameHolder(maybeText, holder)) {
        yield* fs.remove(path, { force: true })
      }
    }).pipe(Effect.ignore),
)

// NOTE: rewrites the holder in place, for a renewed lease, only while the
// file still names this holder. The rename replaces it atomically.
/** @stability unstable */
export const rewriteLock: {
  (
    holder: LockHolder,
  ): (path: string) => Effect.Effect<void, never, FileSystem.FileSystem>
  (
    path: string,
    holder: LockHolder,
  ): Effect.Effect<void, never, FileSystem.FileSystem>
} = Function.dual(
  2,
  (
    path: string,
    holder: LockHolder,
  ): Effect.Effect<void, never, FileSystem.FileSystem> =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const current = yield* readTextIfPresent(path)
      if (!isSameHolder(current, holder)) {
        return
      }
      const draft = `${path}.${holder.pid}.draft`
      yield* fs.writeFileString(draft, encodeLockHolder(holder))
      yield* fs.rename(draft, path)
    }).pipe(Effect.ignore),
)

/** @stability unstable */
export const acquireLock: {
  (
    holder: LockHolder,
  ): (
    path: string,
  ) => Effect.Effect<
    void,
    LockTaken | PlatformError,
    FileSystem.FileSystem | Scope.Scope
  >
  (
    path: string,
    holder: LockHolder,
  ): Effect.Effect<
    void,
    LockTaken | PlatformError,
    FileSystem.FileSystem | Scope.Scope
  >
} = Function.dual(
  2,
  (
    path: string,
    holder: LockHolder,
  ): Effect.Effect<
    void,
    LockTaken | PlatformError,
    FileSystem.FileSystem | Scope.Scope
  > =>
    Effect.acquireRelease(createLock(path, holder), () =>
      releaseLock(path, holder),
    ),
)

// NOTE: the lock is removed only when it still holds the text that was judged
// stale, so a guard that took the lock in the meantime keeps it.
const clearStaleLock = (
  path: string,
  maybeStaleText: Option.Option<string>,
): Effect.Effect<void, PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const maybeText = yield* readTextIfPresent(path)
    if (
      Option.isSome(maybeText) &&
      Option.contains(maybeStaleText, maybeText.value)
    ) {
      yield* fs.remove(path, { force: true })
    }
  })

// THE LOCK DIRECTORY

// NOTE: the solo lock keeps the old name, `munch-manor-heavy.lock`, beside
// this directory, so a guard that predates classes still waits for a Timing
// or CPU job. The directory holds:
// - `shared-<n>.lock`, one per running Shared job.
// - `exclusive-waiting-<pid>.json`, a Timing or CPU job waiting. The name
//   is the one the two class guard reads, so it still yields to them.
// - `waiting-<pid>.json`, a Shared job waiting.
// - `tests-<pid>.json`, a `bun run test` run, counted in the budget.
// - `held-<key>.json`, when a worktree's job last let go of a file, for the
//   round robin by worktree.
// - `turns-<pid>/`, where a running job asks its guard to yield (turn.ts).
const HELD_TURN_FILE = /^held-[0-9a-f]+\.json$/
const SHARED_SLOT_FILE = /^shared-(\d+)\.lock$/
const WAITER_FILE = /^(?:exclusive-)?waiting-\d+\.json$/
const TEST_RUN_FILE = /^tests-\d+\.json$/

export const sharedSlotPath: {
  (slot: number): (directory: string) => string
  (directory: string, slot: number): string
} = Function.dual(
  2,
  (directory: string, slot: number): string =>
    `${directory}/shared-${slot}.lock`,
)

const waiterPath = (directory: string, holder: LockHolder): string =>
  holder.jobClass === 'Shared'
    ? `${directory}/waiting-${holder.pid}.json`
    : `${directory}/exclusive-waiting-${holder.pid}.json`

const testRunPath = (directory: string, pid: number): string =>
  `${directory}/tests-${pid}.json`

const listDirectory = (
  directory: string,
): Effect.Effect<ReadonlyArray<string>, PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    return yield* fs
      .readDirectory(directory)
      .pipe(
        Effect.catchReason('PlatformError', 'NotFound', () =>
          Effect.succeed<ReadonlyArray<string>>([]),
        ),
      )
  })

/** @stability unstable */
export const ensureLockDirectory = (
  directory: string,
): Effect.Effect<void, PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    yield* fs.makeDirectory(directory, { recursive: true })
  })

const slotNumberOf = (name: string): ReadonlyArray<number> =>
  pipe(
    Option.fromNullishOr(SHARED_SLOT_FILE.exec(name)),
    Option.flatMap(match => Option.fromNullishOr(match[1])),
    Option.map(digits => parseInt(digits, 10)),
    Option.toArray,
  )

/** @stability unstable */
export const readSharedSlots = (
  directory: string,
): Effect.Effect<
  ReadonlyArray<SharedSlot>,
  PlatformError,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const names = yield* listDirectory(directory)
    return yield* Effect.forEach(Array.flatMap(names, slotNumberOf), slot =>
      readTextIfPresent(sharedSlotPath(directory, slot)).pipe(
        Effect.map((maybeText): SharedSlot => ({
          slot,
          lock: classifyLock(maybeText, isProcessAlive),
        })),
      ),
    )
  })

// NOTE: a marker whose pid is gone is removed as it is found, so a process
// killed while it waited or tested never counts.
const readMarkers = (
  directory: string,
  pattern: RegExp,
): Effect.Effect<
  ReadonlyArray<LockHolder>,
  PlatformError,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const listed = yield* listDirectory(directory)
    const names = Array.filter(listed, name => pattern.test(name))
    const found = yield* Effect.forEach(names, name =>
      readTextIfPresent(`${directory}/${name}`).pipe(
        Effect.map(maybeText => ({
          name,
          state: classifyLock(maybeText, isProcessAlive),
        })),
      ),
    )
    yield* Effect.forEach(
      Array.filter(found, ({ state }) => LockState.isAnyOf(['Stale'])(state)),
      ({ name }) => Effect.ignore(fs.remove(`${directory}/${name}`)),
      { discard: true },
    )
    return Array.flatMap(found, ({ state }) =>
      LockState.isAnyOf(['Held'])(state) ? [state.holder] : [],
    )
  })

/** @stability unstable */
export const readWaiters = (directory: string) =>
  readMarkers(directory, WAITER_FILE)

/** @stability unstable */
export const readTestRuns = (directory: string) =>
  readMarkers(directory, TEST_RUN_FILE)

// NOTE: the marker is written to a draft and renamed into place, so a
// reader never sees half of it, and removed when `use` ends however it
// ends.
const withMarker = <A, E, R>(
  path: string,
  holder: LockHolder,
  use: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | PlatformError, R | FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const draft = `${path}.draft`
    return yield* Effect.acquireUseRelease(
      fs
        .writeFileString(draft, encodeLockHolder(holder))
        .pipe(Effect.andThen(fs.rename(draft, path))),
      () => use,
      () => Effect.ignore(fs.remove(path, { force: true })),
    )
  })

// NOTE: marks the job as waiting until it holds its file, gives up, or is
// stopped.
/** @stability unstable */
export const whileWaiting: {
  <A, E, R>(
    holder: LockHolder,
    wait: Effect.Effect<A, E, R>,
  ): (
    directory: string,
  ) => Effect.Effect<A, E | PlatformError, R | FileSystem.FileSystem>
  <A, E, R>(
    directory: string,
    holder: LockHolder,
    wait: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E | PlatformError, R | FileSystem.FileSystem>
} = Function.dual(
  3,
  <A, E, R>(
    directory: string,
    holder: LockHolder,
    wait: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E | PlatformError, R | FileSystem.FileSystem> =>
    withMarker(waiterPath(directory, holder), holder, wait),
)

// NOTE: marks a test run for as long as `run` lasts, so other test runs and
// guards count its cost.
/** @stability unstable */
export const whileTesting: {
  <A, E, R>(
    holder: LockHolder,
    run: Effect.Effect<A, E, R>,
  ): (
    directory: string,
  ) => Effect.Effect<A, E | PlatformError, R | FileSystem.FileSystem>
  <A, E, R>(
    directory: string,
    holder: LockHolder,
    run: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E | PlatformError, R | FileSystem.FileSystem>
} = Function.dual(
  3,
  <A, E, R>(
    directory: string,
    holder: LockHolder,
    run: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E | PlatformError, R | FileSystem.FileSystem> =>
    withMarker(testRunPath(directory, holder.pid), holder, run),
)

// NOTE: clears a lock or slot file only while it still reads as stale or
// corrupt, and only that same text, so a live job that took it in the
// meantime keeps it.
/** @stability unstable */
export const clearIfNotHeld = (
  path: string,
): Effect.Effect<void, PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const maybeText = yield* readTextIfPresent(path)
    if (!LockState.isAnyOf(['Held'])(classifyLock(maybeText, isProcessAlive))) {
      yield* clearStaleLock(path, maybeText)
    }
  })

// TURNS

const heldTurnPath = (directory: string, cwd: string): string =>
  `${directory}/held-${turnFileKey(cwd)}.json`

// NOTE: written to a draft and renamed into place, so a reader never sees
// half of it. A lost write only costs one turn of round robin.
/** @stability unstable */
export const recordTurn: {
  (
    turn: HeldTurn,
  ): (directory: string) => Effect.Effect<void, never, FileSystem.FileSystem>
  (
    directory: string,
    turn: HeldTurn,
  ): Effect.Effect<void, never, FileSystem.FileSystem>
} = Function.dual(
  2,
  (
    directory: string,
    turn: HeldTurn,
  ): Effect.Effect<void, never, FileSystem.FileSystem> =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = heldTurnPath(directory, turn.cwd)
      const draft = `${path}.${process.pid}.draft`
      yield* fs.writeFileString(draft, encodeHeldTurn(turn))
      yield* fs.rename(draft, path)
    }).pipe(Effect.ignore),
)

/** @stability unstable */
export const readTurns = (
  directory: string,
): Effect.Effect<
  ReadonlyArray<HeldTurn>,
  PlatformError,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const listed = yield* listDirectory(directory)
    const names = Array.filter(listed, name => HELD_TURN_FILE.test(name))
    const texts = yield* Effect.forEach(names, name =>
      readTextIfPresent(`${directory}/${name}`),
    )
    return Array.getSomes(
      Array.map(texts, maybeText => Option.flatMap(maybeText, decodeHeldTurn)),
    )
  })
