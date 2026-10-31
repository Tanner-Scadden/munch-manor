import type { Duration } from 'effect'
import {
  Context,
  Data,
  Effect,
  Fiber,
  Layer,
  Option,
  Schema,
  Semaphore,
  Stream,
  pipe,
} from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

import type { RoomAccess } from './coop/roomReplica'
import {
  type LinkProblem,
  type PlayerChange,
  type RunSettled,
  StoreEvent,
  SyncState,
} from './playerSync'
import { type PlayerSave, readLegacySave, writeLegacySave } from './save'
import { loadStoreModule } from './storeEarly'
import type { PlayerDatabase } from './storeSqlite'

// STORE

// NOTE: everything that must last across reloads goes through PlayerStore.
// It keeps the PlayerSave in the player sync scope (src/playerScope.ts) on
// on-device SQLite: every change is a mutation in the outbox, applied to the
// view the game reads, and pushed to the player's Durable Object when the
// build has a sync server. The SQLite code, the sync engine, its worker,
// and its wasm load in their own chunks, started by src/early.ts ahead of
// the game's modules, behind the splash, so the first paint never waits on
// them.
//
// Where the save lives, by backend:
// - Opfs: SQLite in the origin private file system. localStorage is read
//   once, to import an older save, and never written again.
// - Memory: SQLite opened in memory, as in a private window or a browser
//   without OPFS sync access handles. The legacy localStorage copy is still
//   written, so the save outlives the tab where localStorage does.
// - LocalStorage: SQLite did not open in time, or not at all. The legacy
//   localStorage copy is read and written for this page session, and
//   nothing syncs.
// NOTE: a live database handle is never decoded or written out: its Schema
// only names the type, checked by shape when a Backend is made.
const OpenDatabase = Schema.declare(
  (value: unknown): value is PlayerDatabase =>
    typeof value === 'object' && value !== null && 'persistence' in value,
)

const Backend = defineTaggedUnion({
  Sqlite: { database: OpenDatabase },
  LocalStorage: { reason: Schema.String },
})
type Backend = typeof Backend.Type

class StoreError extends Data.TaggedError('StoreError')<{
  readonly reason: string
}> {}

class LinkError extends Data.TaggedError('LinkError')<{
  readonly problem: LinkProblem
}> {}

export class PlayerStore extends Context.Service<
  PlayerStore,
  {
    readonly load: Effect.Effect<Option.Option<PlayerSave>, StoreError>
    readonly write: (
      save: PlayerSave,
      changes: ReadonlyArray<PlayerChange>,
    ) => Effect.Effect<Option.Option<string>, StoreError>
    readonly awaitSettled: (id: string) => Effect.Effect<RunSettled, StoreError>
    readonly events: Stream.Stream<StoreEvent>
    readonly requestLinkCode: Effect.Effect<string, LinkError>
    readonly redeemLinkCode: (code: string) => Effect.Effect<void, LinkError>
    readonly roomAccess: Effect.Effect<Option.Option<RoomAccess>>
    readonly queueSummary: (body: string) => Effect.Effect<void, StoreError>
    readonly takeQueuedSummary: Effect.Effect<Option.Option<string>, StoreError>
    readonly clearQueuedSummaries: Effect.Effect<void, StoreError>
  }
>()('munch-manor/store/PlayerStore') {}

// NOTE: long enough for the wasm on a slow phone network, short enough that
// a stuck worker never holds the splash for good.
const SQLITE_OPEN_TIMEOUT: Duration.Input = '12 seconds'

const toStoreError = (error: { readonly reason: string }): StoreError =>
  new StoreError({ reason: error.reason })

const toLinkError = (error: { readonly problem: LinkProblem }): LinkError =>
  new LinkError({ problem: error.problem })

const readLegacy = pipe(readLegacySave, Effect.mapError(toStoreError))

const writeLegacy = (save: PlayerSave) =>
  pipe(writeLegacySave(save), Effect.mapError(toStoreError))

// NOTE: the same open src/early.ts started, if it ran.
const openSqlite: Effect.Effect<PlayerDatabase, StoreError> = pipe(
  Effect.tryPromise({
    try: () =>
      loadStoreModule().then(module => module.openPlayerDatabaseOnce()),
    catch: error => new StoreError({ reason: String(error) }),
  }),
  Effect.flatMap(opened => Effect.mapError(opened, toStoreError)),
)

const loadFrom = (backend: Backend) =>
  Backend.match(backend, {
    Sqlite: ({ database }) =>
      pipe(
        database.load,
        Effect.mapError(toStoreError),
        Effect.catch(error =>
          Effect.andThen(
            Effect.logError(
              'SQLite could not read the save, so it reads localStorage',
              error.reason,
            ),
            readLegacy,
          ),
        ),
      ),
    LocalStorage: () => readLegacy,
  })

// NOTE: in memory, the localStorage copy is the one that outlives the tab,
// so it is written even when the SQLite write fails. Either failure fails
// the write, so the game sends the changes again with the next one. What
// comes back is a recorded run's mutation id, when a server will confirm it.
const writeTo = (
  backend: Backend,
  save: PlayerSave,
  changes: ReadonlyArray<PlayerChange>,
): Effect.Effect<Option.Option<string>, StoreError> =>
  Backend.match(backend, {
    Sqlite: ({ database }) => {
      const written = pipe(
        database.write(save, changes),
        Effect.mapError(toStoreError),
      )
      return database.persistence._tag === 'Opfs'
        ? written
        : Effect.gen(function* () {
            const legacyWritten = yield* Effect.exit(writeLegacy(save))
            const maybeRunId = yield* written
            yield* legacyWritten
            return maybeRunId
          })
    },
    LocalStorage: () => Effect.as(writeLegacy(save), Option.none<string>()),
  })

const localOnly: Stream.Stream<StoreEvent> = Stream.make(
  StoreEvent.SyncStatus({ state: SyncState.LocalOnly() }),
)

// NOTE: SQLite opens in a fiber of the store's own scope, so a timeout here
// only stops waiting: the database is not torn down under a later write. The
// open lives in its own page long scope (see openPlayerDatabaseOnce).
export const layer: Layer.Layer<PlayerStore> = Layer.effect(
  PlayerStore,
  Effect.gen(function* () {
    const scope = yield* Effect.scope
    const backend = yield* Effect.cached(
      Effect.gen(function* () {
        const opening = yield* Effect.forkIn(openSqlite, scope)
        return yield* pipe(
          Fiber.join(opening),
          Effect.map(database => Backend.Sqlite({ database })),
          Effect.timeoutOrElse({
            duration: SQLITE_OPEN_TIMEOUT,
            orElse: () =>
              Effect.succeed(
                Backend.LocalStorage({ reason: 'SQLite did not open in time' }),
              ),
          }),
          Effect.catch(error =>
            Effect.succeed(Backend.LocalStorage({ reason: error.reason })),
          ),
          Effect.tap(opened =>
            Backend.match(opened, {
              Sqlite: () => Effect.void,
              LocalStorage: ({ reason }) =>
                Effect.logWarning(
                  'The save falls back to localStorage for this page',
                  reason,
                ),
            }),
          ),
        )
      }),
    )
    // NOTE: the open starts as the runtime starts, not when the first
    // Command asks for the save, so it runs alongside the first render.
    yield* Effect.forkIn(backend, scope)
    const writes = yield* Semaphore.make(1)
    const database = Effect.flatMap(backend, current =>
      Backend.match(current, {
        Sqlite: ({ database: opened }) => Effect.succeed(opened),
        LocalStorage: () =>
          Effect.fail(new LinkError({ problem: 'Unavailable' })),
      }),
    )
    // NOTE: summaries finished offline wait in SQLite only. Without it
    // (the localStorage fallback) there is nowhere safe to keep them, so
    // they are not queued, and the next run's summary is sent as usual.
    const queued = <A>(
      onSqlite: (opened: PlayerDatabase) => Effect.Effect<A, StoreError>,
      onLocalStorage: A,
    ): Effect.Effect<A, StoreError> =>
      Effect.flatMap(backend, current =>
        Backend.match(current, {
          Sqlite: ({ database: opened }) => onSqlite(opened),
          LocalStorage: () => Effect.succeed(onLocalStorage),
        }),
      )
    return {
      load: Effect.flatMap(backend, loadFrom),
      write: (save, changes) =>
        writes.withPermit(
          pipe(
            Effect.flatMap(backend, next => writeTo(next, save, changes)),
            Effect.tapError(error =>
              Effect.logError('The save was not written', error.reason),
            ),
          ),
        ),
      awaitSettled: id =>
        Effect.flatMap(
          Effect.mapError(
            database,
            error => new StoreError({ reason: error.problem }),
          ),
          opened => Effect.mapError(opened.awaitSettled(id), toStoreError),
        ),
      events: Stream.unwrap(
        Effect.map(backend, current =>
          Backend.match(current, {
            Sqlite: ({ database: opened }) => opened.events,
            LocalStorage: () => localOnly,
          }),
        ),
      ),
      requestLinkCode: Effect.flatMap(database, opened =>
        Effect.mapError(opened.requestLinkCode, toLinkError),
      ),
      redeemLinkCode: code =>
        Effect.flatMap(database, opened =>
          Effect.mapError(opened.redeemLinkCode(code), toLinkError),
        ),
      queueSummary: body =>
        Effect.asVoid(
          queued(
            opened => Effect.mapError(opened.queueSummary(body), toStoreError),
            undefined,
          ),
        ),
      takeQueuedSummary: queued(
        opened => Effect.mapError(opened.takeQueuedSummary, toStoreError),
        Option.none<string>(),
      ),
      clearQueuedSummaries: Effect.asVoid(
        queued(
          opened => Effect.mapError(opened.clearQueuedSummaries, toStoreError),
          undefined,
        ),
      ),
      roomAccess: Effect.map(backend, current =>
        Backend.match(current, {
          Sqlite: ({ database: opened }) => opened.maybeRoomAccess,
          LocalStorage: () => Option.none<RoomAccess>(),
        }),
      ),
    }
  }),
)
