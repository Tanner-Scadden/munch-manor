// Yielding the heavy guard's turn between the parts of a long job. A job
// the guard runs gets HEAVY_TURN_DIR and HEAVY_GUARD_PID. At each boundary
// it calls `yieldTurn`: it writes a request into that directory and waits
// for the guard's grant. The guard hands its file over when another job is
// waiting and queues again (see `decideHandover` in decision.ts), or grants
// at once when nobody is. The grant carries the WORKERS for the next part.
// Outside the guard, `yieldTurn` does nothing.
import {
  Array,
  Clock,
  Config,
  Duration,
  Effect,
  FileSystem,
  Function,
  Option,
  Order,
  Schema,
  pipe,
} from 'effect'
import type { PlatformError } from 'effect/PlatformError'

import * as NodeServices from '@effect/platform-node/NodeServices'

import { chunkRunsOf } from './decision'
import { isProcessAlive, readTextIfPresent } from './lock'

export const TURN_DIR_ENV = 'HEAVY_TURN_DIR'
export const GUARD_PID_ENV = 'HEAVY_GUARD_PID'
const CHUNK_RUNS_ENV = 'HEAVY_CHUNK_RUNS'

const GRANT_POLL = Duration.millis(200)

// PROTOCOL

const TurnRequest = Schema.Struct({
  pid: Schema.Int,
  label: Schema.String,
})
type TurnRequest = typeof TurnRequest.Type

const TurnRequestJson = Schema.fromJsonString(TurnRequest)

const TurnGrant = Schema.Struct({ workers: Schema.Int })
type TurnGrant = typeof TurnGrant.Type

const TurnGrantJson = Schema.fromJsonString(TurnGrant)

const REQUEST_FILE = /^request-([\w-]+)\.json$/

const requestPath = (directory: string, id: string): string =>
  `${directory}/request-${id}.json`

const grantPath = (directory: string, id: string): string =>
  `${directory}/grant-${id}.json`

const writeAtomically = (
  path: string,
  text: string,
): Effect.Effect<void, PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const draft = `${path}.draft`
    yield* fs.writeFileString(draft, text)
    yield* fs.rename(draft, path)
  })

export type PendingRequest = Readonly<{ id: string; request: TurnRequest }>

// NOTE: the guard's side: the requests waiting for a grant, oldest name
// first. A request that does not decode is answered all the same.
/** @stability unstable */
export const readRequests = (
  directory: string,
): Effect.Effect<
  ReadonlyArray<PendingRequest>,
  PlatformError,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const names = yield* fs
      .readDirectory(directory)
      .pipe(
        Effect.catchReason('PlatformError', 'NotFound', () =>
          Effect.succeed<ReadonlyArray<string>>([]),
        ),
      )
    const ids = pipe(
      names,
      Array.flatMap(name =>
        pipe(
          Option.fromNullishOr(REQUEST_FILE.exec(name)),
          Option.flatMap(match => Option.fromNullishOr(match[1])),
          Option.toArray,
        ),
      ),
      Array.sort(Order.String),
    )
    return yield* Effect.forEach(ids, id =>
      readTextIfPresent(requestPath(directory, id)).pipe(
        Effect.map((maybeText): PendingRequest => ({
          id,
          request: pipe(
            maybeText,
            Option.flatMap(Schema.decodeOption(TurnRequestJson)),
            Option.getOrElse(() => ({ pid: 0, label: 'a part' })),
          ),
        })),
      ),
    )
  })

/** @stability unstable */
export const grantTurn: {
  (
    id: string,
    workers: number,
  ): (
    directory: string,
  ) => Effect.Effect<void, PlatformError, FileSystem.FileSystem>
  (
    directory: string,
    id: string,
    workers: number,
  ): Effect.Effect<void, PlatformError, FileSystem.FileSystem>
} = Function.dual(
  3,
  (
    directory: string,
    id: string,
    workers: number,
  ): Effect.Effect<void, PlatformError, FileSystem.FileSystem> =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      yield* fs.remove(requestPath(directory, id), { force: true })
      const grant = yield* Schema.encodeEffect(TurnGrantJson)({ workers }).pipe(
        Effect.orDie,
      )
      yield* writeAtomically(grantPath(directory, id), `${grant}\n`)
    }),
)

// THE JOB'S SIDE

// NOTE: waits for the grant, or gives up when the guard is gone, since a
// guard that died can never answer.
const awaitGrant = (
  path: string,
  guardPid: number,
): Effect.Effect<Option.Option<string>, PlatformError, FileSystem.FileSystem> =>
  readTextIfPresent(path).pipe(
    Effect.filterOrElse(
      maybeText => Option.isSome(maybeText) || !isProcessAlive(guardPid),
      () =>
        Effect.sleep(GRANT_POLL).pipe(
          Effect.andThen(Effect.suspend(() => awaitGrant(path, guardPid))),
        ),
    ),
  )

const TurnConfig = Config.all({
  maybeDirectory: Config.String(TURN_DIR_ENV).pipe(Config.option),
  maybeGuardPid: Config.Int(GUARD_PID_ENV).pipe(Config.option),
})

// NOTE: yields the turn at a boundary between parts of a job. Returns the
// WORKERS for the next part, or None outside the guard (or when anything
// goes wrong, so a job never fails for yielding).
/** @stability unstable */
export const yieldTurn = (
  label: string,
): Effect.Effect<Option.Option<number>, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const { maybeDirectory, maybeGuardPid } = yield* TurnConfig
    if (Option.isNone(maybeDirectory) || Option.isNone(maybeGuardPid)) {
      return Option.none()
    }
    const fs = yield* FileSystem.FileSystem
    const directory = maybeDirectory.value
    const id = `${process.pid}-${yield* Clock.currentTimeNanos}`
    const request = yield* Schema.encodeEffect(TurnRequestJson)({
      pid: process.pid,
      label,
    }).pipe(Effect.orDie)
    yield* writeAtomically(requestPath(directory, id), `${request}\n`)
    const maybeText = yield* awaitGrant(
      grantPath(directory, id),
      maybeGuardPid.value,
    ).pipe(
      Effect.ensuring(
        Effect.ignore(fs.remove(requestPath(directory, id), { force: true })),
      ),
    )
    yield* Effect.ignore(fs.remove(grantPath(directory, id), { force: true }))
    return pipe(
      maybeText,
      Option.flatMap(Schema.decodeOption(TurnGrantJson)),
      Option.map(({ workers }) => workers),
    )
  }).pipe(Effect.orElseSucceed(() => Option.none()))

// FOR PLAIN SCRIPTS

// NOTE: whether a guard runs this process, so the job splits its work.
export const isUnderGuard = (): boolean =>
  Effect.runSync(
    Config.String(TURN_DIR_ENV).pipe(
      Config.option,
      Effect.map(Option.isSome),
      Effect.orElseSucceed(() => false),
    ),
  )

// NOTE: the runs a chunk of a balance batch plays with these workers.
export const chunkRuns = (workers: number): number =>
  Effect.runSync(
    Config.Int(CHUNK_RUNS_ENV).pipe(
      Config.option,
      Effect.orElseSucceed(() => Option.none<number>()),
      Effect.map(maybeChunkRuns => chunkRunsOf(workers, maybeChunkRuns)),
    ),
  )

// NOTE: `yieldTurn` for a script that is not an Effect program. Resolves
// to the WORKERS for the next part, or `workers` when nothing changed.
export const yieldTurnAsync: {
  (workers: number): (label: string) => Promise<number>
  (label: string, workers: number): Promise<number>
} = Function.dual(2, (label: string, workers: number): Promise<number> =>
  Effect.runPromise(
    yieldTurn(label).pipe(
      Effect.map(Option.getOrElse(() => workers)),
      Effect.provide(NodeServices.layer),
    ),
  ),
)
