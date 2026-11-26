import {
  Context,
  type Duration,
  Effect,
  Fiber,
  Layer,
  Option,
  Schema,
  Semaphore,
  Stream,
  pipe,
} from 'effect'

import { UiSchema } from '@effect/ui'

import type { RoomAccess } from '#platform/coop/roomReplica.ts'

import {
  LinkProblem,
  type PlayerChange,
  StoreEvent,
  SyncState,
} from './playerSync.ts'
import { type PlayerSave, readLegacySave, writeLegacySave } from './save.ts'
import { loadStoreModule } from './storeEarly.ts'
import type { PlayerDatabase } from './storeSqlite.ts'

const OpenDatabase = Schema.declare(
  (value: unknown): value is PlayerDatabase =>
    typeof value === 'object' && value !== null && 'persistence' in value,
)

const Backend = UiSchema.TaggedEnum({
  Sqlite: { database: OpenDatabase },
  LocalStorage: { reason: Schema.String },
})
type Backend = typeof Backend.Type

class StoreError extends Schema.TaggedError<
  StoreError,
  { readonly brand: unique symbol }
>()('StoreError', {
  reason: Schema.String,
}) {}

class LinkError extends Schema.TaggedError<
  LinkError,
  { readonly brand: unique symbol }
>()('LinkError', {
  problem: LinkProblem,
}) {}

export class PlayerStore extends Context.Service<
  PlayerStore,
  {
    readonly load: Effect.Effect<Option.Option<PlayerSave>, StoreError>
    readonly write: (
      save: PlayerSave,
      changes: ReadonlyArray<PlayerChange>,
    ) => Effect.Effect<void, StoreError>
    readonly events: Stream.Stream<StoreEvent>
    readonly requestLinkCode: Effect.Effect<string, LinkError>
    readonly redeemLinkCode: (code: string) => Effect.Effect<void, LinkError>
    readonly roomAccess: Effect.Effect<Option.Option<RoomAccess>>
    readonly queueSummary: (body: string) => Effect.Effect<void, StoreError>
    readonly takeQueuedSummary: Effect.Effect<Option.Option<string>, StoreError>
    readonly clearQueuedSummaries: Effect.Effect<void, StoreError>
    readonly isRecordUnlocked: Effect.Effect<boolean, StoreError>
    readonly queueRecording: (body: string) => Effect.Effect<void, StoreError>
    readonly takeQueuedRecording: Effect.Effect<
      Option.Option<string>,
      StoreError
    >
    readonly clearQueuedRecordings: Effect.Effect<void, StoreError>
  }
>()('munch-manor/platform/save/store/PlayerStore') {}

const SQLITE_OPEN_TIMEOUT: Duration.Input = '12 seconds'

const toStoreError = (error: { readonly reason: string }): StoreError =>
  StoreError.make({ reason: error.reason })

const toLinkError = (error: { readonly problem: LinkProblem }): LinkError =>
  LinkError.make({ problem: error.problem })

const readLegacy = pipe(readLegacySave, Effect.mapError(toStoreError))

const writeLegacy = (save: PlayerSave) =>
  pipe(writeLegacySave(save), Effect.mapError(toStoreError))

const openSqlite: Effect.Effect<PlayerDatabase, StoreError> = pipe(
  Effect.tryPromise({
    try: () =>
      loadStoreModule().then(module => module.openPlayerDatabaseOnce()),
    catch: error => StoreError.make({ reason: String(error) }),
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

const writeTo = (
  backend: Backend,
  save: PlayerSave,
  changes: ReadonlyArray<PlayerChange>,
): Effect.Effect<void, StoreError> =>
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
            yield* written
            yield* legacyWritten
          })
    },
    LocalStorage: () => writeLegacy(save),
  })

const localOnly: Stream.Stream<StoreEvent> = Stream.make(
  StoreEvent.SyncStatus({ state: SyncState.LocalOnly() }),
)

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
    yield* Effect.forkIn(backend, scope)
    const writes = yield* Semaphore.make(1)
    const database = Effect.flatMap(backend, current =>
      Backend.match(current, {
        Sqlite: ({ database: opened }) => Effect.succeed(opened),
        LocalStorage: () =>
          Effect.fail(LinkError.make({ problem: 'Unavailable' })),
      }),
    )
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
      isRecordUnlocked: queued(
        opened => Effect.mapError(opened.isRecordUnlocked, toStoreError),
        false,
      ),
      queueRecording: body =>
        Effect.asVoid(
          queued(
            opened =>
              Effect.mapError(opened.queueRecording(body), toStoreError),
            undefined,
          ),
        ),
      takeQueuedRecording: queued(
        opened => Effect.mapError(opened.takeQueuedRecording, toStoreError),
        Option.none<string>(),
      ),
      clearQueuedRecordings: Effect.asVoid(
        queued(
          opened => Effect.mapError(opened.clearQueuedRecordings, toStoreError),
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
