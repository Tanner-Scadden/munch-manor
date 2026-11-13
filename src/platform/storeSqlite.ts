import {
  Array,
  Context,
  Effect,
  type Exit,
  Function,
  Layer,
  Option,
  Predicate,
  Record,
  Result,
  Scheduler,
  Schema,
  Scope,
  Stream,
  pipe,
} from 'effect'
import { SqlClient } from 'effect/sql'

import {
  Browser,
  type Persistence,
  SqliteClient,
  type SqliteClientService,
} from '@munch/sqlite-wasm-effect'
import {
  type IdentityApi,
  IdentityFailure,
  IdentityRefused,
  type LocalDatabase,
  type Replica,
  ScopeStatus,
  Settled,
  type Sync,
  SyncStatus,
  type Transport,
  TransportError,
  makeDeviceIdentity,
  makeReplica,
  randomId,
  startSync,
} from '@munch/sync-engine'

import { API_ORIGIN } from './apiOrigin'
import {
  ClaimedMission,
  ProgressedMissions,
  RerolledMission,
  RolledMissions,
  StampedMissionDay,
} from './missionScope'
import {
  BoughtCosmetic,
  BoughtRow,
  ChangedAppearance,
  ChangedCalling,
  ChangedDifficulty,
  ChangedHome,
  ChangedName,
  ChangedOnboarding,
  ChangedRecordRuns,
  ChangedRotation,
  ChangedRumble,
  ChangedSettings,
  DoubledFirstRun,
  EarnedRank,
  EndedRun,
  EscapedFirst,
  ForgotPowerUps,
  GrantedVeteranRank,
  KeptJournal,
  KillsRow,
  PLAYER_COLUMNS,
  PlayerRow,
  PlayerScope,
  ReachedRecords,
  RecordedRun,
  SawPowerUps,
  SawUnlocks,
  SeededPlayer,
  ShelvedProof,
  UnlockedNightmare,
  UnlockedRecording,
  boughtRowsOfSave,
  killsRowsOfSave,
  playerScopeId,
  rowOfSave,
} from './playerScope'
import {
  LinkProblem,
  PlayerChange,
  PlayerScopeStatus,
  RunSettled,
  StoreEvent,
  SyncState,
} from './playerSync'
import { ProofRow, encodedProofRows, proofOfRow } from './proofScope'
import { type RoomAccess, makeRoomAccess } from './roomReplica'
import {
  type PlayerSave,
  SAVE_VERSION,
  type SaveStorageError,
  readLegacySave,
  writeLegacySave,
} from './save'
import {
  STORE_NAME,
  releaseEarlyStoreWorker,
  takeLeaderLock,
  takeStoreWorker,
} from './storeEarly'

// NOTE: this module, the SQLite package, and the sync engine load in their
// own chunk, behind the splash, from src/platform/storeEarly.ts. Nothing in the game's
// bundle imports it.

export { KillsRow, PlayerRow, killsRowsOfSave, rowOfSave }

// SCHEMA

// NOTE: the tables the game made before sync. The player scope's view
// tables are these same `player` and `kills_by_kind` (see
// src/platform/playerScope.ts), so a device that already had a save keeps it.
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
  // NOTE: run summaries finished with no network, waiting to be sent. This
  // table is this device's alone: it is not in the player scope, so it never
  // syncs and a linked device never sees it.
  '0002_create_queued_summaries': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`CREATE TABLE queued_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      body TEXT NOT NULL
    )`
  }),
  // NOTE: recorded runs (src/platform/recording.ts) finished with no
  // network, waiting to be sent, kept on this device alone like the
  // summaries.
  '0003_create_queued_recordings': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`CREATE TABLE queued_recordings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      body TEXT NOT NULL
    )`
  }),
}

// NOTE: a long trip offline keeps this many runs. The oldest go first.
const MAX_QUEUED_SUMMARIES = 20

const QueuedSummaryRow = Schema.Struct({
  id: Schema.Finite,
  body: Schema.String,
})

// NOTE: a recorded run is far bigger than a summary, so a trip offline
// keeps only the last few.
const MAX_QUEUED_RECORDINGS = 4

// NOTE: this device was opened with `?record=1` before the unlock synced
// with the player (save version 20). Only read now: the boot moves it into
// the save, which syncs it to every linked device.
const RECORD_UNLOCK_KEY = 'record-unlock'
const RECORD_UNLOCKED = 'Unlocked'

const LEGACY_IMPORT_KEY = 'legacy-local-storage-import'
const SYNC_SEED_KEY = 'sync-seed'

const LegacyImport = Schema.Literals(['Imported', 'Absent'])
type LegacyImport = typeof LegacyImport.Type

const SyncSeed = Schema.Literals(['Seeded', 'Absent'])
type SyncSeed = typeof SyncSeed.Type

const MetaRow = Schema.Struct({ value: Schema.String })

const DevicesRow = Schema.Struct({ count: Schema.Finite })

const boughtCosmeticsOf = (
  rows: ReadonlyArray<BoughtRow>,
): ReadonlyArray<string> => Array.map(rows, ({ id }) => id)

const saveOfRow = (
  row: PlayerRow,
  kills: ReadonlyArray<KillsRow>,
  bought: ReadonlyArray<BoughtRow>,
  proof: ReadonlyArray<ProofRow>,
): PlayerSave => ({
  version: SAVE_VERSION,
  onboarding: row.onboarding,
  homeScreenTip: row.home_screen_tip,
  settings: {
    sound: row.sound,
    music: row.music,
    shake: row.shake,
    shareStats: row.share_stats,
    cursor: row.cursor,
  },
  appearance: row.appearance,
  difficulty: {
    chosen: row.difficulty,
    card: row.difficulty_card,
    nightmare: row.nightmare,
  },
  bests: {
    runsPlayed: row.runs_played,
    totalKills: row.total_kills,
    killsByKind: Record.fromEntries(
      Array.map(kills, ({ kind, kills: count }): readonly [string, number] => [
        kind,
        count,
      ]),
    ),
    byDifficulty: row.difficulty_bests,
  },
  home: row.home,
  seenPowerUps: row.seen_power_ups,
  seenUnlocks: row.seen_unlocks,
  rotation: row.rotation,
  rumble: row.rumble,
  recordRuns: row.record_runs,
  recordUnlock: row.record_unlock,
  name: row.name,
  calling: row.calling,
  boughtCosmetics: boughtCosmeticsOf(bought),
  records: row.run_records,
  rank: {
    earnedPoints: row.rank_points,
    earnedBones: row.rank_bones,
    veteranPoints: row.veteran_points,
    veteranBones: row.veteran_bones,
    isVeteranGranted: row.veteran_granted === 1,
    spentBones: row.spent_bones,
  },
  bonuses: {
    doubledDay: row.doubled_day,
    escapedOn: row.escaped_on,
  },
  lastRun: row.last_run,
  missions: row.missions,
  journal: row.journal,
  proof: Array.map(proof, proofOfRow),
})

// LEGACY

export interface LegacySave {
  readonly read: Effect.Effect<Option.Option<PlayerSave>, SaveStorageError>
  readonly write: (save: PlayerSave) => Effect.Effect<void, SaveStorageError>
}

// DATABASE

export interface PlayerDatabase {
  readonly persistence: Persistence
  readonly load: Effect.Effect<Option.Option<PlayerSave>, PlayerDatabaseError>
  readonly write: (
    save: PlayerSave,
    changes: ReadonlyArray<PlayerChange>,
  ) => Effect.Effect<Option.Option<string>, PlayerDatabaseError>
  readonly awaitSettled: (
    id: string,
  ) => Effect.Effect<RunSettled, PlayerDatabaseError>
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

const linkProblemOf = (failure: IdentityFailure): LinkProblem =>
  IdentityFailure.match(failure, {
    Unauthorized: (): LinkProblem => 'Unavailable',
    PlayerTaken: (): LinkProblem => 'Unavailable',
    WrongCode: (): LinkProblem => 'WrongCode',
    TooManyTries: (): LinkProblem => 'TooManyTries',
    RateLimited: (): LinkProblem => 'TooManyTries',
    BadRequest: (): LinkProblem => 'WrongCode',
    Unavailable: (): LinkProblem => 'Offline',
  })

const fromRefused = (error: IdentityRefused) =>
  PlayerDatabaseError.make({
    reason: error.failure._tag,
    problem: linkProblemOf(error.failure),
  })

const readKills = (client: SqliteClientService) =>
  pipe(
    client.query(KillsRow, client.sql`SELECT kind, kills FROM kills_by_kind`),
    Effect.catchTag('SchemaError', () => Effect.succeed([])),
  )

const readBought = (client: SqliteClientService) =>
  pipe(
    client.query(BoughtRow, client.sql`SELECT id FROM bought_cosmetics`),
    Effect.catchTag('SchemaError', () => Effect.succeed([])),
  )

const readProof = (client: SqliteClientService) =>
  pipe(
    client.query(
      ProofRow,
      client.sql`SELECT thing, difficulty, wave, hero, crew, day, ending FROM proof`,
    ),
    Effect.catchTag('SchemaError', () => Effect.succeed([])),
  )

const readView = (client: SqliteClientService) =>
  Effect.gen(function* () {
    const sql = client.sql
    const rows = yield* pipe(
      client.query(
        PlayerRow,
        sql`SELECT ${sql.literal(Array.join(PLAYER_COLUMNS, ', '))} FROM player WHERE id = 1`,
      ),
      Effect.catchTag('SchemaError', () => Effect.succeed([])),
    )
    const maybeRow = Array.head(rows)
    if (Option.isNone(maybeRow)) {
      return Option.none<PlayerSave>()
    }
    const kills = yield* readKills(client)
    const bought = yield* readBought(client)
    const proof = yield* readProof(client)
    return Option.some(saveOfRow(maybeRow.value, kills, bought, proof))
  })

const readDevices = (client: SqliteClientService) =>
  pipe(
    client.query(
      DevicesRow,
      client.sql`SELECT count FROM linked_devices WHERE id = 1`,
    ),
    Effect.map(rows =>
      Option.match(Array.head(rows), {
        onNone: () => 1,
        onSome: row => row.count,
      }),
    ),
    Effect.tapError(error =>
      Effect.logWarning('Could not read the linked device count', error),
    ),
    Effect.orElseSucceed(() => 1),
  )

// NOTE: the row as it was written before sync, for the one-time import and
// the seed. The view is overwritten whole, in one transaction.
const writeWhole = (
  sql: SqlClient.SqlClient,
  save: PlayerSave,
): Effect.Effect<void, PlayerDatabaseError> =>
  pipe(
    Effect.all([
      Schema.encodeEffect(PlayerRow)(rowOfSave(save)),
      encodedProofRows(save.proof),
    ]),
    Effect.flatMap(([encoded, proofRows]) =>
      Effect.all([
        sql`INSERT INTO player ${sql.insert({ id: 1, ...encoded })}
        ON CONFLICT (id) DO UPDATE SET ${sql.literal(
          Array.join(
            Array.map(
              PLAYER_COLUMNS,
              column => `${column} = excluded.${column}`,
            ),
            ', ',
          ),
        )}`,
        sql`DELETE FROM kills_by_kind`,
        Array.match(killsRowsOfSave(save), {
          onEmpty: () => Effect.void,
          onNonEmpty: rows =>
            sql`INSERT INTO kills_by_kind ${sql.insert(rows)}`,
        }),
        sql`DELETE FROM bought_cosmetics`,
        Array.match(boughtRowsOfSave(save), {
          onEmpty: () => Effect.void,
          onNonEmpty: rows =>
            sql`INSERT INTO bought_cosmetics ${sql.insert(rows)}`,
        }),
        sql`DELETE FROM proof`,
        Array.match(proofRows, {
          onEmpty: () => Effect.void,
          onNonEmpty: rows => sql`INSERT INTO proof ${sql.insert(rows)}`,
        }),
      ]),
    ),
    sql.withTransaction,
    Effect.asVoid,
    Effect.mapError(toDatabaseError),
  )

const readMeta = (client: SqliteClientService, key: string) =>
  Effect.map(
    client.query(
      MetaRow,
      client.sql`SELECT value FROM store_meta WHERE key = ${key}`,
    ),
    rows => Array.head(rows),
  )

const markMeta = (client: SqliteClientService, key: string, value: string) =>
  client.sql`INSERT INTO store_meta ${client.sql.insert({ key, value })}
    ON CONFLICT (key) DO UPDATE SET value = excluded.value`

// QUEUED SUMMARIES

// NOTE: a queue of bodies waiting for the network: the run summaries, and
// the recorded runs.
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

// NOTE: the oldest body is deleted as it is taken, in one transaction, so
// two tabs or two drains never send the same one twice.
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

// NOTE: the first load on a device finds no player row and no import mark,
// so it reads the localStorage save, writes it as the row, and marks the
// import done, all in one transaction. Every later load reads the row and
// never looks at localStorage again, even if the row is gone. A row that no
// longer decodes reads as no save, as a corrupted localStorage save did.
const importLegacy = (client: SqliteClientService, legacy: LegacySave) =>
  pipe(
    Effect.gen(function* () {
      const existing = yield* readView(client)
      if (Option.isSome(existing)) {
        return existing
      }
      const mark = yield* readMeta(client, LEGACY_IMPORT_KEY)
      if (Option.isSome(mark)) {
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
      yield* Option.match(maybeLegacy, {
        onNone: () => Effect.void,
        onSome: save => writeWhole(client.sql, save),
      })
      const imported: LegacyImport = Option.isSome(maybeLegacy)
        ? 'Imported'
        : 'Absent'
      yield* markMeta(client, LEGACY_IMPORT_KEY, imported)
      return maybeLegacy
    }),
    client.transaction,
    Effect.mapError(toDatabaseError),
  )

// SYNC

// NOTE: where sync goes, when the build has a server. Without one the
// mutations still go through the outbox, and sync catches up whenever a
// build with a server opens the same database.
export interface SyncSetup {
  readonly identityApi: IdentityApi
  readonly transports: Array.NonEmptyReadonlyArray<Transport>
}

const offlineApi: IdentityApi = {
  challenge: Effect.fail(
    IdentityRefused.make({
      failure: IdentityFailure.cases.Unavailable.make({}),
    }),
  ),
  session: () =>
    Effect.fail(
      IdentityRefused.make({
        failure: IdentityFailure.cases.Unavailable.make({}),
      }),
    ),
  link: () =>
    Effect.fail(
      IdentityRefused.make({
        failure: IdentityFailure.cases.Unavailable.make({}),
      }),
    ),
  redeem: () =>
    Effect.fail(
      IdentityRefused.make({
        failure: IdentityFailure.cases.Unavailable.make({}),
      }),
    ),
}

const runChange = (replica: Replica, change: PlayerChange) =>
  PlayerChange.match(change, {
    ChangedSettings: ({ settings }) =>
      replica.run(ChangedSettings, { settings }),
    ChangedRotation: ({ rotation }) =>
      replica.run(ChangedRotation, { rotation }),
    ChangedRumble: ({ rumble }) => replica.run(ChangedRumble, { rumble }),
    ChangedRecordRuns: ({ recordRuns }) =>
      replica.run(ChangedRecordRuns, { recordRuns }),
    ChangedName: ({ name }) => replica.run(ChangedName, { name }),
    ChangedAppearance: ({ appearance }) =>
      replica.run(ChangedAppearance, { appearance }),
    UnlockedNightmare: () => replica.run(UnlockedNightmare, {}),
    UnlockedRecording: () => replica.run(UnlockedRecording, {}),
    ChangedDifficulty: ({ chosen, card }) =>
      replica.run(ChangedDifficulty, { chosen, card }),
    ChangedOnboarding: ({ onboarding, homeScreenTip }) =>
      replica.run(ChangedOnboarding, { onboarding, homeScreenTip }),
    ChangedHome: ({ home }) => replica.run(ChangedHome, { home }),
    SawPowerUps: ({ kinds }) => replica.run(SawPowerUps, { kinds }),
    SawUnlocks: ({ ids }) => replica.run(SawUnlocks, { ids }),
    ForgotPowerUps: () => replica.run(ForgotPowerUps, {}),
    RecordedRun: ({ runs, totalKills, kills, bests }) =>
      replica.run(RecordedRun, { runs, totalKills, kills, bests }),
    ReachedRecords: ({ records }) => replica.run(ReachedRecords, { records }),
    ChangedCalling: ({ calling }) => replica.run(ChangedCalling, { calling }),
    EarnedRank: ({ points, bones }) =>
      replica.run(EarnedRank, { points, bones }),
    BoughtCosmetic: ({ id }) => replica.run(BoughtCosmetic, { id }),
    GrantedVeteranRank: ({ points, bones }) =>
      replica.run(GrantedVeteranRank, { points, bones }),
    DoubledFirstRun: ({ day, bones }) =>
      replica.run(DoubledFirstRun, { day, bones }),
    EscapedFirst: ({ difficulty }) => replica.run(EscapedFirst, { difficulty }),
    EndedRun: ({ lastRun }) => replica.run(EndedRun, { lastRun }),
    ProgressedMissions: ({ day, progress, coop }) =>
      replica.run(ProgressedMissions, { day, progress, coop }),
    RolledMissions: ({ day, rolled }) =>
      replica.run(RolledMissions, { day, rolled }),
    RerolledMission: ({ day, reroll }) =>
      replica.run(RerolledMission, { day, reroll }),
    ClaimedMission: ({ day, mission }) =>
      replica.run(ClaimedMission, { day, mission }),
    StampedMissionDay: ({ day }) => replica.run(StampedMissionDay, { day }),
    ShelvedProof: ({ entry }) => replica.run(ShelvedProof, { entry }),
    KeptJournal: ({ added }) => replica.run(KeptJournal, { added }),
  })

const sameSyncState = Schema.toEquivalence(SyncState)

const scopeStatusOf = (status: ScopeStatus): PlayerScopeStatus =>
  ScopeStatus.match(status, {
    Idle: (): PlayerScopeStatus => PlayerScopeStatus.Idle(),
    Loading: (): PlayerScopeStatus => PlayerScopeStatus.Loading(),
    Ready: ({ seq, fresh }): PlayerScopeStatus =>
      PlayerScopeStatus.Ready({ seq, fresh }),
    Failed: ({ reason }): PlayerScopeStatus =>
      PlayerScopeStatus.Failed({ reason }),
  })

const runSettledOf = (settled: Settled): RunSettled =>
  Settled.match(settled, {
    Confirmed: ({ seq }): RunSettled => RunSettled.Confirmed({ seq }),
    Rejected: ({ code, reason }): RunSettled =>
      RunSettled.Rejected({ reason: `${code}: ${reason}` }),
  })

const stateOf = (status: SyncStatus, devices: number): SyncState =>
  SyncStatus.match(status, {
    Online: (): SyncState => SyncState.Synced({ devices }),
    Following: (): SyncState => SyncState.Synced({ devices }),
    Connecting: ({ attempt }): SyncState =>
      attempt === 0 ? SyncState.Connecting() : SyncState.Offline({ devices }),
    Offline: (): SyncState => SyncState.Offline({ devices }),
  })

/** @stability unstable */
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
  // NOTE: data-first starts with the client, the only argument that can
  // migrate.
  (args: IArguments): boolean => Predicate.hasProperty(args[0], 'migrate'),
  (
    client: SqliteClientService,
    legacy: LegacySave,
    maybeSetup: Option.Option<SyncSetup> = Option.none(),
  ): Effect.Effect<PlayerDatabase, PlayerDatabaseError, Scope.Scope> =>
    Effect.gen(function* () {
      const sql = client.sql
      yield* pipe(
        client.migrate(PLAYER_MIGRATIONS),
        Effect.mapError(toDatabaseError),
      )
      const status = yield* client.status

      const identity = yield* pipe(
        makeDeviceIdentity({
          sql,
          api: Option.match(maybeSetup, {
            onNone: () => offlineApi,
            onSome: setup => setup.identityApi,
          }),
        }),
        Effect.mapError(toDatabaseError),
      )
      const playerId = yield* Effect.mapError(identity.playerId, fromRefused)
      const database: LocalDatabase = {
        sql,
        changes: client.changes,
        role: Effect.map(client.status, current => current.role),
      }
      const replica = yield* pipe(
        makeReplica({
          definition: PlayerScope,
          database,
          scope: playerScopeId(playerId),
        }),
        Effect.mapError(toDatabaseError),
      )

      // NOTE: once per device, the save from before sync seeds the player
      // scope as a pending SeededPlayer, so the server gets it on first sync.
      yield* pipe(
        Effect.gen(function* () {
          const seeded = yield* readMeta(client, SYNC_SEED_KEY)
          if (Option.isSome(seeded)) {
            return
          }
          const maybeSave = yield* importLegacy(client, legacy)
          yield* Option.match(maybeSave, {
            onNone: () => Effect.void,
            onSome: save => Effect.asVoid(replica.run(SeededPlayer, { save })),
          })
          const mark: SyncSeed = Option.isSome(maybeSave) ? 'Seeded' : 'Absent'
          yield* markMeta(client, SYNC_SEED_KEY, mark)
        }),
        client.transaction,
        Effect.mapError(error =>
          error._tag === 'PlayerDatabaseError'
            ? error
            : PlayerDatabaseError.make({
                reason: error.message,
                problem: 'Unavailable',
              }),
        ),
      )

      // NOTE: the changes go in one transaction, so a write that fails leaves
      // nothing behind and the game can send the same changes again. A change
      // the scope's own rules reject would be rejected on every retry, so it is
      // logged and dropped on its own, and the rest still go in. A recorded
      // run's mutation id comes back when there is a server to confirm it.
      const write = (save: PlayerSave, changes: ReadonlyArray<PlayerChange>) =>
        pipe(
          Effect.gen(function* () {
            const current = yield* readView(client)
            if (Option.isNone(current)) {
              yield* replica.run(SeededPlayer, { save })
              return Option.none<string>()
            }
            const ran = yield* Effect.forEach(changes, change =>
              pipe(
                runChange(replica, change),
                Effect.map(id =>
                  change._tag === 'RecordedRun'
                    ? Option.some(id)
                    : Option.none<string>(),
                ),
                Effect.catchTag('MutationRejected', error =>
                  Effect.as(
                    Effect.logWarning(
                      `Dropped ${change._tag}, which the player scope rejects`,
                      error.reason,
                    ),
                    Option.none<string>(),
                  ),
                ),
              ),
            )
            return Option.isSome(maybeSetup)
              ? Array.last(Array.getSomes(ran))
              : Option.none<string>()
          }),
          client.transaction,
          Effect.mapError(toDatabaseError),
        )

      const maybeSync: Option.Option<Sync> = yield* Option.match(maybeSetup, {
        onNone: () => Effect.succeedNone,
        onSome: setup =>
          Effect.gen(function* () {
            const clientId = yield* randomId(9)
            const sync = yield* startSync({
              replica,
              transports: setup.transports,
              credentials: pipe(
                identity.session,
                Effect.mapBoth({
                  onSuccess: session => ({ token: session.token, clientId }),
                  onFailure: error =>
                    TransportError.make({ reason: error.failure._tag }),
                }),
              ),
              refreshCredentials: identity.invalidate,
            })
            return Option.some(sync)
          }),
      })

      const savedChanges: Stream.Stream<StoreEvent> = pipe(
        replica.remoteChanges,
        Stream.mapEffect(() =>
          pipe(
            readView(client),
            Effect.tapError(error =>
              Effect.logError('Could not read the save sync changed', error),
            ),
            Effect.orElseSucceed(() => Option.none<PlayerSave>()),
          ),
        ),
        Stream.filterMap(maybeSave =>
          Option.match(maybeSave, {
            onNone: () => Result.failVoid,
            onSome: save => Result.succeed(StoreEvent.SyncedSave({ save })),
          }),
        ),
      )

      const statusChanges: Stream.Stream<StoreEvent> = Option.match(maybeSync, {
        onNone: () =>
          Stream.make(StoreEvent.SyncStatus({ state: SyncState.LocalOnly() })),
        onSome: sync =>
          pipe(
            Stream.merge(
              Stream.map(sync.status, next => ({ status: next })),
              Stream.mapEffect(
                Stream.concat(Stream.make(undefined), replica.remoteChanges),
                () =>
                  Effect.map(sync.current, current => ({ status: current })),
              ),
            ),
            Stream.mapEffect(({ status: current }) =>
              Effect.map(readDevices(client), devices =>
                StoreEvent.SyncStatus({ state: stateOf(current, devices) }),
              ),
            ),
            Stream.changesWith((a, b) => sameSyncState(a.state, b.state)),
          ),
      })

      const redeemLinkCode = (code: string) =>
        Effect.gen(function* () {
          const linked = yield* Effect.mapError(
            identity.redeem(code),
            fromRefused,
          )
          yield* Effect.mapError(
            replica.switchScope(playerScopeId(linked.playerId)),
            toDatabaseError,
          )
          yield* Option.match(maybeSync, {
            onNone: () => Effect.void,
            onSome: sync => sync.reconnect,
          })
        })

      const maybeRoomAccess: Option.Option<RoomAccess> = yield* Option.match(
        maybeSetup,
        {
          onNone: () => Effect.succeedNone,
          onSome: setup =>
            Effect.asSome(
              makeRoomAccess({
                database,
                identity,
                transports: setup.transports,
              }),
            ),
        },
      )

      const scopeChanges: Stream.Stream<StoreEvent> = Stream.map(
        replica.status,
        next => StoreEvent.ScopeStatus({ status: scopeStatusOf(next) }),
      )

      return {
        persistence: status.persistence,
        load: readView(client).pipe(Effect.mapError(toDatabaseError)),
        write,
        awaitSettled: id =>
          pipe(
            replica.awaitSettled(id),
            Effect.mapBoth({
              onSuccess: runSettledOf,
              onFailure: toDatabaseError,
            }),
          ),
        events: Stream.mergeAll([savedChanges, statusChanges, scopeChanges], {
          concurrency: 'unbounded',
        }),
        requestLinkCode: Effect.mapBoth(identity.createLinkCode, {
          onSuccess: response => response.code,
          onFailure: fromRefused,
        }),
        redeemLinkCode,
        maybeRoomAccess,
        queueSummary: body => queueRow(client, SUMMARY_QUEUE, body),
        takeQueuedSummary: takeRow(client, SUMMARY_QUEUE),
        clearQueuedSummaries: clearRows(client, SUMMARY_QUEUE),
        isRecordUnlocked: Effect.mapBoth(readMeta(client, RECORD_UNLOCK_KEY), {
          onSuccess: Option.exists(({ value }) => value === RECORD_UNLOCKED),
          onFailure: toDatabaseError,
        }),
        queueRecording: body => queueRow(client, RECORDING_QUEUE, body),
        takeQueuedRecording: takeRow(client, RECORDING_QUEUE),
        clearQueuedRecordings: clearRows(client, RECORDING_QUEUE),
      }
    }),
)

// BROWSER

const browserSetup = (origin: string): Effect.Effect<SyncSetup> =>
  Effect.map(
    Effect.promise(() => import('@munch/sync-engine/browser')),
    browser => ({
      identityApi: browser.httpIdentityApi(origin),
      transports: [
        browser.webSocketTransport(origin),
        browser.httpTransport(origin),
      ],
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

// OPEN ONCE

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

// NOTE: the same scheduling Foldkit gives its own fibers. Effect's default
// yields with setTimeout, which the browser clamps to at least 4 ms, and the
// open yields often enough that the clamps added up to a tenth of a second.
const OPEN_SCHEDULER = new Scheduler.MixedScheduler('async', runNextMicrotask)

const opens = new Map<
  typeof OPEN,
  Promise<Exit.Exit<PlayerDatabase, PlayerDatabaseError>>
>()

// NOTE: the page's one open of the player database. src/platform/storeEarly.ts starts
// it before the game's modules run, and the PlayerStore awaits the same
// promise, so the database opens alongside the game's first render instead
// of after it. The database lasts as long as the page, so its scope is never
// closed.
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
