import {
  Array,
  Context,
  Effect,
  Exit,
  Function,
  Layer,
  Option,
  Predicate,
  Ref,
  Result,
  Scheduler,
  Schema,
  Scope,
  Semaphore,
  Stream,
  Struct,
  SubscriptionRef,
  pipe,
} from 'effect'
import {
  type Event,
  type EventGroup,
  EventLog,
  EventLogMessage,
  SqlEventJournal,
} from 'effect/eventlog'
import { SqlClient } from 'effect/sql'

import { TokenUnavailable } from '@munch/netcode/browser'
import {
  Browser,
  type Persistence,
  SqliteClient,
  type SqliteClientService,
} from '@munch/sqlite-wasm-effect'

import { PlayerSave } from '#shared/playerData.ts'
import { newIdentity, playerStoreOf } from '#shared/sessionApi.ts'

import { API_ORIGIN } from './apiOrigin.ts'
import { dropOldTables, readOldSave } from './legacyTables.ts'
import {
  type EarnedEvents,
  type MissionEvents,
  PLAYER_ROW_KEY,
  PlayerLogSchema,
  PlayerRow,
  type PlayerRowFields,
  type SetEvents,
} from './playerEvents.ts'
import {
  PROJECTION_TABLES,
  PlayerHandlers,
  ValueRow,
  createPlayerTables,
  dropPlayerTables,
  readPlayerRow,
  readPlayerSave,
  rowOfSave,
} from './playerProjection.ts'
import {
  type LinkRefused,
  type PlayerRemote,
  type SyncSetup,
  browserSetup,
  connectPlayerRemote,
  redeemWith,
} from './playerRemote.ts'
import {
  LinkProblem,
  PlayerChange,
  StoreEvent,
  SyncState,
} from './playerSync.ts'
import {
  type RoomAccess,
  type RoomSession,
  makeRoomAccess,
} from './roomReplica.ts'
import {
  type SaveStorageError,
  readLegacySave,
  writeLegacySave,
} from './save.ts'
import {
  STORE_NAME,
  releaseEarlyStoreWorker,
  takeLeaderLock,
  takeStoreWorker,
} from './storeEarly.ts'

export type { SyncSetup }

const PLAYER_MIGRATIONS = {
  '0001_create_player': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`CREATE TABLE player (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      sound TEXT NOT NULL,
      music TEXT NOT NULL,
      shake TEXT NOT NULL,
      share_stats TEXT NOT NULL,
      appearance TEXT NOT NULL,
      difficulty TEXT NOT NULL,
      difficulty_card TEXT NOT NULL,
      nightmare TEXT NOT NULL,
      onboarding TEXT NOT NULL,
      home_screen_tip TEXT NOT NULL,
      runs_played INTEGER NOT NULL,
      total_kills INTEGER NOT NULL,
      difficulty_bests TEXT NOT NULL
    )`
    yield* sql`CREATE TABLE kills_by_kind (
      kind TEXT PRIMARY KEY,
      kills INTEGER NOT NULL
    )`
    yield* sql`CREATE TABLE store_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`
  }),
  '0002_create_queued_summaries': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`CREATE TABLE queued_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      body TEXT NOT NULL
    )`
  }),
  '0003_create_queued_recordings': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`CREATE TABLE queued_recordings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      body TEXT NOT NULL
    )`
  }),
}

const MAX_QUEUED_SUMMARIES = 20

const QueuedSummaryRow = Schema.Struct({
  id: Schema.Finite,
  body: Schema.String,
})

const MAX_QUEUED_RECORDINGS = 4

const RECORD_UNLOCK_KEY = 'record-unlock'
const RECORD_UNLOCKED = 'Unlocked'

const LEGACY_IMPORT_KEY = 'legacy-local-storage-import'
const OLD_TABLES_KEY = 'player-scope-dropped'
const IDENTITY_KEY = 'player-identity'
const ORIGIN_KEY = 'player-identity-origin'

const IdentityOrigin = Schema.Literals(['Created', 'Linked'])
type IdentityOrigin = typeof IdentityOrigin.Type

const isLinkedOrigin = Schema.is(Schema.Literal('Linked'))

const JOURNAL_PREFIX = 'effect_event_'

const TableRow = Schema.Struct({ name: Schema.String })

const META_TABLE = 'store_meta'

export interface LegacySave {
  readonly read: Effect.Effect<Option.Option<PlayerSave>, SaveStorageError>
  readonly write: (save: PlayerSave) => Effect.Effect<void, SaveStorageError>
}

export interface PlayerDatabase {
  readonly persistence: Persistence
  readonly load: Effect.Effect<Option.Option<PlayerSave>, PlayerDatabaseError>
  readonly write: (
    save: PlayerSave,
    changes: ReadonlyArray<PlayerChange>,
  ) => Effect.Effect<void, PlayerDatabaseError>
  readonly events: Stream.Stream<StoreEvent>
  readonly requestLinkCode: Effect.Effect<string, PlayerDatabaseError>
  readonly redeemLinkCode: (
    code: string,
  ) => Effect.Effect<void, PlayerDatabaseError>
  readonly maybeRoomAccess: Option.Option<RoomAccess>
  readonly queueSummary: (
    body: string,
  ) => Effect.Effect<void, PlayerDatabaseError>
  readonly takeQueuedSummary: Effect.Effect<
    Option.Option<string>,
    PlayerDatabaseError
  >
  readonly clearQueuedSummaries: Effect.Effect<void, PlayerDatabaseError>
  readonly isRecordUnlocked: Effect.Effect<boolean, PlayerDatabaseError>
  readonly queueRecording: (
    body: string,
  ) => Effect.Effect<void, PlayerDatabaseError>
  readonly takeQueuedRecording: Effect.Effect<
    Option.Option<string>,
    PlayerDatabaseError
  >
  readonly clearQueuedRecordings: Effect.Effect<void, PlayerDatabaseError>
}

class PlayerDatabaseError extends Schema.TaggedError<
  PlayerDatabaseError,
  { readonly brand: unique symbol }
>()('PlayerDatabaseError', {
  reason: Schema.String,
  problem: LinkProblem,
}) {}

const toDatabaseError = (error: { readonly message: string }) =>
  PlayerDatabaseError.make({ reason: error.message, problem: 'Unavailable' })

const unavailable = (reason: string) => () =>
  PlayerDatabaseError.make({ reason, problem: 'Unavailable' })

const fromRefused = (error: LinkRefused) =>
  PlayerDatabaseError.make({ reason: error.problem, problem: error.problem })

type PlayerEvents = EventGroup.Events<
  typeof SetEvents | typeof EarnedEvents | typeof MissionEvents
>

type PlayerItem = {
  readonly [Tag in Event.Tag<PlayerEvents>]: {
    readonly event: Tag
    readonly payload: Event.PayloadWithTag<PlayerEvents, Tag>
  }
}[Event.Tag<PlayerEvents>]

type RowPatch = Partial<Omit<PlayerRowFields, 'id'>>

type Written = Readonly<{
  patch: RowPatch
  events: ReadonlyArray<PlayerItem>
}>

const patchOf = (patch: RowPatch): Written => ({ patch, events: [] })

const eventOf = (item: PlayerItem): Written => ({ patch: {}, events: [item] })

const writtenOf = (save: PlayerSave, change: PlayerChange): Written =>
  PlayerChange.match(change, {
    ChangedSettings: ({ settings }) => patchOf({ ...settings }),
    ChangedRotation: ({ rotation }) => patchOf({ rotation }),
    ChangedRumble: ({ rumble }) => patchOf({ rumble }),
    ChangedRecordRuns: ({ recordRuns }) => patchOf({ recordRuns }),
    ChangedName: ({ name }) => patchOf({ name }),
    ChangedAppearance: ({ appearance }) => patchOf({ appearance }),
    ChangedDifficulty: ({ chosen, card }) => patchOf({ chosen, card }),
    ChangedOnboarding: ({ onboarding, homeScreenTip }) =>
      patchOf({ onboarding, homeScreenTip }),
    ChangedHome: ({ home }) => patchOf({ home }),
    SawPowerUps: () => patchOf({ seenPowerUps: save.seenPowerUps }),
    ForgotPowerUps: () => patchOf({ seenPowerUps: save.seenPowerUps }),
    EndedRun: ({ lastRun }) => patchOf({ lastRun }),
    ChangedCalling: ({ calling }) => patchOf({ calling }),
    UnlockedNightmare: () =>
      eventOf({ event: 'UnlockedNightmare', payload: {} }),
    UnlockedRecording: () =>
      eventOf({ event: 'UnlockedRecording', payload: {} }),
    SawUnlocks: ({ ids }) => eventOf({ event: 'SawUnlocks', payload: { ids } }),
    RecordedRun: ({ runs, totalKills, kills, bests }) =>
      eventOf({
        event: 'RecordedRun',
        payload: { runs, totalKills, kills, bests },
      }),
    ReachedRecords: ({ records }) =>
      eventOf({ event: 'ReachedRecords', payload: { records } }),
    EarnedRank: ({ points, bones }) =>
      eventOf({ event: 'EarnedRank', payload: { points, bones } }),
    GrantedVeteranRank: ({ points, bones }) =>
      eventOf({ event: 'GrantedVeteranRank', payload: { points, bones } }),
    BoughtCosmetic: ({ id }) =>
      eventOf({ event: 'BoughtCosmetic', payload: { id } }),
    DoubledFirstRun: ({ day, bones }) =>
      eventOf({ event: 'DoubledFirstRun', payload: { day, bones } }),
    EscapedFirst: ({ difficulty }) =>
      eventOf({ event: 'EscapedFirst', payload: { difficulty } }),
    PaidRankPurse: ({ rank }) =>
      eventOf({ event: 'PaidRankPurse', payload: { rank } }),
    ProgressedMissions: ({ day, progress, coop }) =>
      eventOf({
        event: 'ProgressedMissions',
        payload: { day, progress, coop },
      }),
    RolledMissions: ({ day, rolled }) =>
      eventOf({ event: 'RolledMissions', payload: { day, rolled } }),
    RerolledMission: ({ day, reroll }) =>
      eventOf({ event: 'RerolledMission', payload: { day, reroll } }),
    ClaimedMission: ({ day, mission }) =>
      eventOf({ event: 'ClaimedMission', payload: { day, mission } }),
    StampedMissionDay: ({ day }) =>
      eventOf({ event: 'StampedMissionDay', payload: { day } }),
    ShelvedProof: ({ entry }) =>
      eventOf({ event: 'ShelvedProof', payload: { entry } }),
    KeptJournal: ({ added }) =>
      eventOf({ event: 'KeptJournal', payload: { added } }),
    GainedMastery: ({ added }) =>
      eventOf({ event: 'GainedMastery', payload: { added } }),
    ClimbedDareLadder: ({ difficulty, mark }) =>
      eventOf({ event: 'ClimbedDareLadder', payload: { difficulty, mark } }),
  })

const itemsOf = (
  save: PlayerSave,
  changes: ReadonlyArray<PlayerChange>,
): ReadonlyArray<PlayerItem> => {
  const written = Array.map(changes, change => writtenOf(save, change))
  const patch = Array.reduce(
    written,
    {},
    (merged: RowPatch, next): RowPatch => ({ ...merged, ...next.patch }),
  )
  const events = Array.flatMap(written, next => next.events)
  return Array.isReadonlyArrayEmpty(Struct.keys(patch))
    ? events
    : Array.append(events, PlayerRow.patch(PLAYER_ROW_KEY, patch))
}

const seedItems = (
  save: PlayerSave,
): Array.NonEmptyReadonlyArray<PlayerItem> => [
  { event: 'Seeded', payload: { save: Struct.omit(save, ['version']) } },
  PlayerRow.set(rowOfSave(save, PLAYER_ROW_KEY)),
]

const readMeta = (sql: SqlClient.SqlClient, key: string) =>
  pipe(
    sql`SELECT value FROM store_meta WHERE key = ${key}`,
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(ValueRow))),
    Effect.map(rows => Option.map(Array.head(rows), ({ value }) => value)),
  )

const markMeta = (sql: SqlClient.SqlClient, key: string, value: string) =>
  sql`INSERT INTO store_meta ${sql.insert({ key, value })}
    ON CONFLICT (key) DO UPDATE SET value = excluded.value`

type QueueTable = Readonly<{ table: string; limit: number }>

const SUMMARY_QUEUE: QueueTable = {
  table: 'queued_summaries',
  limit: MAX_QUEUED_SUMMARIES,
}

const RECORDING_QUEUE: QueueTable = {
  table: 'queued_recordings',
  limit: MAX_QUEUED_RECORDINGS,
}

const queueRow = (
  client: SqliteClientService,
  { table, limit }: QueueTable,
  body: string,
) =>
  pipe(
    Effect.all([
      client.sql`INSERT INTO ${client.sql(table)} ${client.sql.insert({ body })}`,
      client.sql`DELETE FROM ${client.sql(table)} WHERE id NOT IN (
        SELECT id FROM ${client.sql(table)} ORDER BY id DESC
        LIMIT ${limit}
      )`,
    ]),
    client.sql.withTransaction,
    Effect.asVoid,
    Effect.mapError(toDatabaseError),
  )

const takeRow = (client: SqliteClientService, { table }: QueueTable) =>
  pipe(
    Effect.gen(function* () {
      const rows = yield* client.query(
        QueuedSummaryRow,
        client.sql`SELECT id, body FROM ${client.sql(table)} ORDER BY id LIMIT 1`,
      )
      return yield* Option.match(Array.head(rows), {
        onNone: () => Effect.succeedNone,
        onSome: row =>
          Effect.as(
            client.sql`DELETE FROM ${client.sql(table)} WHERE id = ${row.id}`,
            Option.some(row.body),
          ),
      })
    }),
    client.sql.withTransaction,
    Effect.mapError(toDatabaseError),
  )

const clearRows = (client: SqliteClientService, { table }: QueueTable) =>
  pipe(
    client.sql`DELETE FROM ${client.sql(table)}`,
    Effect.asVoid,
    Effect.mapError(toDatabaseError),
  )

type Identity = EventLog.Identity['Service']

const decodeIdentity = (value: string): Option.Option<Identity> =>
  Option.liftThrowable(EventLog.decodeIdentityString)(value)

const logLayer = (sql: SqlClient.SqlClient, identity: Identity) =>
  EventLog.layer(PlayerLogSchema, PlayerHandlers).pipe(
    Layer.provideMerge(SqlEventJournal.layer()),
    Layer.provide(Layer.effectDiscard(createPlayerTables)),
    Layer.provide(Layer.succeed(EventLog.Identity, identity)),
    Layer.provide(
      Layer.succeed(
        EventLog.CurrentStoreId,
        EventLogMessage.StoreId.make(playerStoreOf(identity.publicKey)),
      ),
    ),
    Layer.provide(Layer.succeed(SqlClient.SqlClient, sql)),
  )

type Running = Readonly<{
  identity: Identity
  log: EventLog.EventLog['Service']
  scope: Scope.Closeable
  maybeRemote: Option.Option<PlayerRemote>
}>

const dropJournal = (sql: SqlClient.SqlClient) =>
  Effect.gen(function* () {
    const tables = yield* pipe(
      sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE ${`${JOURNAL_PREFIX}%`}`,
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(TableRow))),
    )
    yield* Effect.forEach(
      tables,
      ({ name }) => sql`DROP TABLE IF EXISTS ${sql(name)}`,
      { discard: true },
    )
    yield* Effect.provideService(dropPlayerTables, SqlClient.SqlClient, sql)
  })

const readLegacyOnce = (sql: SqlClient.SqlClient, legacy: LegacySave) =>
  Effect.gen(function* () {
    const imported = yield* readMeta(sql, LEGACY_IMPORT_KEY)
    if (Option.isSome(imported)) {
      return Option.none<PlayerSave>()
    }
    const maybeLegacy = yield* pipe(
      legacy.read,
      Effect.catch(error =>
        Effect.as(
          Effect.logWarning(
            'Could not read the localStorage save to import',
            error.reason,
          ),
          Option.none<PlayerSave>(),
        ),
      ),
    )
    yield* markMeta(
      sql,
      LEGACY_IMPORT_KEY,
      Option.isSome(maybeLegacy) ? 'Imported' : 'Absent',
    )
    return maybeLegacy
  })

export const makePlayerDatabase: {
  (
    legacy: LegacySave,
    maybeSetup?: Option.Option<SyncSetup>,
  ): (
    client: SqliteClientService,
  ) => Effect.Effect<PlayerDatabase, PlayerDatabaseError, Scope.Scope>
  (
    client: SqliteClientService,
    legacy: LegacySave,
    maybeSetup?: Option.Option<SyncSetup>,
  ): Effect.Effect<PlayerDatabase, PlayerDatabaseError, Scope.Scope>
} = Function.dual(
  (args: IArguments): boolean => Predicate.hasProperty(args[0], 'migrate'),
  (
    client: SqliteClientService,
    legacy: LegacySave,
    maybeSetup: Option.Option<SyncSetup> = Option.none(),
  ): Effect.Effect<PlayerDatabase, PlayerDatabaseError, Scope.Scope> =>
    Effect.gen(function* () {
      const sql = client.sql
      const outer = yield* Effect.scope
      yield* pipe(
        client.migrate(PLAYER_MIGRATIONS),
        Effect.mapError(toDatabaseError),
      )
      const status = yield* client.status
      const lock = yield* Semaphore.make(1)
      const lastSave = yield* Ref.make(Option.none<PlayerSave>())
      const syncState = yield* SubscriptionRef.make<SyncState>(
        Option.isSome(maybeSetup)
          ? SyncState.Connecting()
          : SyncState.LocalOnly(),
      )

      const readSave = Effect.provideService(
        readPlayerSave,
        SqlClient.SqlClient,
        sql,
      )

      const start = (identity: Identity) =>
        Effect.gen(function* () {
          const scope = yield* Scope.fork(outer)
          const context = yield* pipe(
            Layer.buildWithScope(logLayer(sql, identity), scope),
            Effect.onError(cause => Scope.close(scope, Exit.failCause(cause))),
          )
          const maybeRemote = yield* Option.match(maybeSetup, {
            onNone: () => Effect.succeedNone,
            onSome: setup =>
              pipe(
                connectPlayerRemote(setup, identity),
                Effect.tap(remote =>
                  Effect.forkScoped(
                    Stream.runForEach(remote.state, next =>
                      SubscriptionRef.set(syncState, next),
                    ),
                  ),
                ),
                Effect.provideContext(context),
                Scope.provide(scope),
                Effect.asSome,
              ),
          })
          const running: Running = {
            identity,
            log: Context.get(context, EventLog.EventLog),
            scope,
            maybeRemote,
          }
          return running
        })

      const stored = yield* pipe(
        readMeta(sql, IDENTITY_KEY),
        Effect.mapBoth({
          onSuccess: Option.flatMap(decodeIdentity),
          onFailure: toDatabaseError,
        }),
      )
      const identity = yield* Option.match(stored, {
        onSome: Effect.succeed,
        onNone: () =>
          Effect.tap(newIdentity, created =>
            pipe(
              Effect.all([
                markMeta(
                  sql,
                  IDENTITY_KEY,
                  EventLog.encodeIdentityString(created),
                ),
                markMeta(sql, ORIGIN_KEY, 'Created' satisfies IdentityOrigin),
              ]),
              sql.withTransaction,
              Effect.mapError(toDatabaseError),
            ),
          ),
      })
      const first = yield* Effect.mapError(start(identity), toDatabaseError)
      const current = yield* Ref.make(first)

      const originOf = Effect.map(readMeta(sql, ORIGIN_KEY), origin =>
        Option.exists(origin, isLinkedOrigin) ? 'Linked' : 'Created',
      )

      const seed = (running: Running, save: PlayerSave) =>
        running.log.writeMany({
          schema: PlayerLogSchema,
          events: seedItems(save),
        })

      yield* pipe(
        Effect.gen(function* () {
          const dropped = yield* readMeta(sql, OLD_TABLES_KEY)
          if (Option.isSome(dropped)) {
            return
          }
          const running = yield* Ref.get(current)
          const maybeSaved = yield* readSave
          const origin = yield* originOf
          if (Option.isNone(maybeSaved) && origin === 'Created') {
            const maybeOld = yield* readOldSave
            const maybeSave = Option.isSome(maybeOld)
              ? maybeOld
              : yield* readLegacyOnce(sql, legacy)
            yield* Option.match(maybeSave, {
              onNone: () => Effect.void,
              onSome: save => seed(running, save),
            })
          }
          yield* dropOldTables
          yield* markMeta(sql, OLD_TABLES_KEY, 'Dropped')
        }),
        Effect.provideService(SqlClient.SqlClient, sql),
        effect => lock.withPermit(effect),
        Effect.mapError(error => toDatabaseError({ message: String(error) })),
      )

      const load = pipe(
        readSave,
        Effect.tap(maybeSave => Ref.set(lastSave, maybeSave)),
      )

      const write = (save: PlayerSave, changes: ReadonlyArray<PlayerChange>) =>
        lock.withPermit(
          pipe(
            Effect.gen(function* () {
              const running = yield* Ref.get(current)
              const maybeRow = yield* Effect.provideService(
                readPlayerRow,
                SqlClient.SqlClient,
                sql,
              )
              if (Option.isNone(maybeRow)) {
                if ((yield* originOf) === 'Created') {
                  yield* seed(running, save)
                  yield* Ref.set(lastSave, Option.some(save))
                }
                return
              }
              yield* Array.match(itemsOf(save, changes), {
                onEmpty: () => Effect.void,
                onNonEmpty: events =>
                  Effect.asVoid(
                    running.log.writeMany({ schema: PlayerLogSchema, events }),
                  ),
              })
              yield* Ref.set(lastSave, Option.some(save))
            }),
            Effect.mapError(error =>
              toDatabaseError({ message: String(error) }),
            ),
          ),
        )

      const restart = (startAs: Identity, wipe: boolean) =>
        lock.withPermit(
          Effect.gen(function* () {
            const running = yield* Ref.get(current)
            yield* Scope.close(running.scope, Exit.void)
            if (wipe) {
              yield* dropJournal(sql)
            }
            yield* SubscriptionRef.set(
              syncState,
              Option.isSome(maybeSetup)
                ? SyncState.Connecting()
                : SyncState.LocalOnly(),
            )
            const next = yield* start(startAs)
            yield* Ref.set(current, next)
          }),
        )

      const redeemLinkCode = (code: string) =>
        Effect.gen(function* () {
          const setup = yield* Effect.mapError(
            Effect.fromOption(maybeSetup),
            unavailable('No sync'),
          )
          const encoded = yield* Effect.mapError(
            redeemWith(setup, code),
            fromRefused,
          )
          const linked = yield* Effect.mapError(
            Effect.fromOption(decodeIdentity(encoded)),
            unavailable('Bad identity'),
          )
          const running = yield* Ref.get(current)
          if (linked.publicKey === running.identity.publicKey) {
            return
          }
          yield* pipe(
            Effect.all([
              markMeta(sql, IDENTITY_KEY, encoded),
              markMeta(sql, ORIGIN_KEY, 'Linked' satisfies IdentityOrigin),
            ]),
            sql.withTransaction,
            Effect.mapError(toDatabaseError),
          )
          yield* Ref.set(lastSave, Option.none())
          yield* Effect.mapError(restart(linked, true), toDatabaseError)
        })

      const followOtherTabs = pipe(
        client.changes,
        Stream.filter(changes =>
          Array.some(changes, change => change.table === META_TABLE),
        ),
        Stream.runForEach(() =>
          Effect.gen(function* () {
            const maybeEncoded = yield* readMeta(sql, IDENTITY_KEY)
            const maybeStored = Option.flatMap(maybeEncoded, decodeIdentity)
            const running = yield* Ref.get(current)
            yield* Option.match(
              Option.filter(
                maybeStored,
                next => next.publicKey !== running.identity.publicKey,
              ),
              {
                onNone: () => Effect.void,
                onSome: next => restart(next, false),
              },
            )
          }),
        ),
        Effect.catchCause(cause =>
          Effect.logError('Could not follow another tab linking', cause),
        ),
      )
      yield* Effect.forkScoped(followOtherTabs)

      const sameSave = Schema.toEquivalence(PlayerSave)

      const savedChanges: Stream.Stream<StoreEvent> = pipe(
        client.changes,
        Stream.filter(changes =>
          Array.some(changes, change =>
            Array.contains(PROJECTION_TABLES, change.table),
          ),
        ),
        Stream.mapEffect(() =>
          Effect.gen(function* () {
            const maybeSave = yield* readSave
            const before = yield* Ref.get(lastSave)
            const isNew = Option.match(maybeSave, {
              onNone: () => false,
              onSome: save =>
                !Option.exists(before, known => sameSave(known, save)),
            })
            if (isNew) {
              yield* Ref.set(lastSave, maybeSave)
            }
            return isNew ? maybeSave : Option.none<PlayerSave>()
          }),
        ),
        Stream.filterMap(maybeSave =>
          Option.match(maybeSave, {
            onNone: () => Result.failVoid,
            onSome: save => Result.succeed(StoreEvent.SyncedSave({ save })),
          }),
        ),
      )

      const sameState = Schema.toEquivalence(SyncState)

      const statusChanges: Stream.Stream<StoreEvent> = pipe(
        SubscriptionRef.changes(syncState),
        Stream.changesWith(sameState),
        Stream.map(state => StoreEvent.SyncStatus({ state })),
      )

      const remoteOf = Effect.map(
        Ref.get(current),
        running => running.maybeRemote,
      )

      const maybeRoomAccess: Option.Option<RoomAccess> = yield* Option.match(
        maybeSetup,
        {
          onNone: () => Effect.succeedNone,
          onSome: setup =>
            Effect.asSome(
              makeRoomAccess({
                database: {
                  sql,
                  changes: client.changes,
                  role: Effect.map(client.status, now => now.role),
                },
                session: Effect.map(Ref.get(current), running =>
                  Option.match(running.maybeRemote, {
                    onNone: (): RoomSession => ({
                      playerId: running.identity.publicKey,
                      token: Effect.fail(
                        TokenUnavailable.make({ reason: 'Offline' }),
                      ),
                      invalidate: Effect.void,
                    }),
                    onSome: remote => remote.session,
                  }),
                ),
                transports: setup.transports,
              }),
            ),
        },
      )

      return {
        persistence: status.persistence,
        load: Effect.mapError(load, toDatabaseError),
        write,
        events: Stream.merge(savedChanges, statusChanges),
        requestLinkCode: Effect.flatMap(remoteOf, maybeRemote =>
          Option.match(maybeRemote, {
            onNone: () => Effect.fail(unavailable('No sync')()),
            onSome: remote =>
              Effect.mapError(remote.createLinkCode, fromRefused),
          }),
        ),
        redeemLinkCode,
        maybeRoomAccess,
        queueSummary: body => queueRow(client, SUMMARY_QUEUE, body),
        takeQueuedSummary: takeRow(client, SUMMARY_QUEUE),
        clearQueuedSummaries: clearRows(client, SUMMARY_QUEUE),
        isRecordUnlocked: Effect.mapBoth(readMeta(sql, RECORD_UNLOCK_KEY), {
          onSuccess: Option.contains(RECORD_UNLOCKED),
          onFailure: toDatabaseError,
        }),
        queueRecording: body => queueRow(client, RECORDING_QUEUE, body),
        takeQueuedRecording: takeRow(client, RECORDING_QUEUE),
        clearQueuedRecordings: clearRows(client, RECORDING_QUEUE),
      }
    }),
)

export const openPlayerDatabase: {
  (
    syncOrigin: string,
  ): (
    legacy: LegacySave,
  ) => Effect.Effect<PlayerDatabase, PlayerDatabaseError, Scope.Scope>
  (
    legacy: LegacySave,
    syncOrigin: string,
  ): Effect.Effect<PlayerDatabase, PlayerDatabaseError, Scope.Scope>
} = Function.dual(
  2,
  (
    legacy: LegacySave,
    syncOrigin: string,
  ): Effect.Effect<PlayerDatabase, PlayerDatabaseError, Scope.Scope> =>
    Effect.gen(function* () {
      const context = yield* pipe(
        Layer.build(
          Browser.layer({
            worker: takeStoreWorker,
            leaderLock: takeLeaderLock,
            name: STORE_NAME,
            file: '/munch-manor.sqlite3',
          }),
        ),
        Effect.mapError(error =>
          PlayerDatabaseError.make({
            reason: error.reason,
            problem: 'Unavailable',
          }),
        ),
      )
      yield* Effect.sync(releaseEarlyStoreWorker)
      const maybeSetup =
        syncOrigin === ''
          ? Option.none()
          : yield* Effect.asSome(browserSetup(syncOrigin))
      return yield* makePlayerDatabase(
        Context.get(context, SqliteClient),
        legacy,
        maybeSetup,
      )
    }),
)

const LEGACY_SAVE: LegacySave = {
  read: readLegacySave,
  write: writeLegacySave,
}

const OPEN = 'open'

const runNextMicrotask = (callback: () => void): (() => void) => {
  const cancelled = { current: false }
  queueMicrotask(() => {
    if (!cancelled.current) {
      callback()
    }
  })
  return () => {
    cancelled.current = true
  }
}

const OPEN_SCHEDULER = new Scheduler.MixedScheduler('async', runNextMicrotask)

const opens = new Map<
  typeof OPEN,
  Promise<Exit.Exit<PlayerDatabase, PlayerDatabaseError>>
>()

export const openPlayerDatabaseOnce = (): Promise<
  Exit.Exit<PlayerDatabase, PlayerDatabaseError>
> => {
  const maybeOpening = opens.get(OPEN)
  if (maybeOpening !== undefined) {
    return maybeOpening
  }
  const opening = Effect.runPromiseExit(
    pipe(
      Scope.make(),
      Effect.flatMap(scope =>
        Scope.provide(openPlayerDatabase(LEGACY_SAVE, API_ORIGIN), scope),
      ),
      Effect.provideService(Scheduler.Scheduler, OPEN_SCHEDULER),
    ),
  )
  opens.set(OPEN, opening)
  return opening
}
