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

import type { SharedSlot } from './decision'
import {
  type HeldTurn,
  type LockHolder,
  LockState,
  classifyLock,
  decodeHeldTurn,
  encodeHeldTurn,
  encodeLockHolder,
  isSameHolder,
  turnFileKey,
} from './records'

export class LockTaken extends Schema.TaggedError<
  LockTaken,
  { readonly brand: unique symbol }
>()('LockTaken', {}) {}

const hasErrorCode = (error: unknown, code: string): boolean =>
  Predicate.hasProperty(error, 'code') && error.code === code

export const isProcessAlive = (pid: number): boolean =>
  pipe(
    Result.try(() => process.kill(pid, 0)),
    Result.match({
      onSuccess: () => true,
      onFailure: error => hasErrorCode(error, 'EPERM'),
    }),
  )

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

export const readWaiters = (directory: string) =>
  readMarkers(directory, WAITER_FILE)

export const readTestRuns = (directory: string) =>
  readMarkers(directory, TEST_RUN_FILE)

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

export const clearIfNotHeld = (
  path: string,
): Effect.Effect<void, PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const maybeText = yield* readTextIfPresent(path)
    if (!LockState.isAnyOf(['Held'])(classifyLock(maybeText, isProcessAlive))) {
      yield* clearStaleLock(path, maybeText)
    }
  })

const heldTurnPath = (directory: string, cwd: string): string =>
  `${directory}/held-${turnFileKey(cwd)}.json`

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
