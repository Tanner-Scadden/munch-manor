import { Array, Effect, Function, Option, Record, Schema, pipe } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'

import {
  type ApplyContext,
  MutationRejected,
  defineMutation,
  defineScope,
  scopeId,
} from '@munch/sync-engine'

import { DayStamp } from '../shared/dayStamp'
import { SavedJournal, addToJournal } from '../shared/journalData'
import { StoredAppearance } from '../shared/lookCodes'
import { SavedMissions } from '../shared/missionData'
import {
  Appearance,
  COSMETIC_PRICES,
  Calling,
  CursorSetting,
  Difficulty,
  FIRST_ESCAPE_BONES,
  HomeScreenTip,
  MusicSetting,
  PlayerName,
  PlayerSave,
  RecordRunsSetting,
  RecordUnlock,
  RotationSetting,
  RumbleSetting,
  RunEnding,
  SEEN_BASELINE,
  type SavedBestRun,
  SavedBestsByDifficulty,
  SavedCard,
  type SavedDifficultyBests,
  SavedHome,
  SavedNightmare,
  SavedOnboarding,
  SavedPowerUps,
  type SavedRunRecord,
  SavedRunRecords,
  SavedSeenUnlocks,
  SavedSettings,
  ShakeSetting,
  ShareStatsSetting,
  SoundSetting,
  isBetterRun,
} from '../shared/playerData'
import { ProofEntry } from '../shared/proofData'
import { purseBonesAt, rankOf } from '../shared/rankCurve'
import { ClimbedDareLadder, DareMarksJson } from './dareMarkScope'
import {
  GUN_KILLS_TABLE,
  GainedMastery,
  HERO_MASTERY_TABLE,
  seedMasteryRows,
} from './masteryScope'
import {
  ClaimedMission,
  ProgressedMissions,
  RerolledMission,
  RolledMissions,
  StampedMissionDay,
} from './missionScope'
import { PLAYER_MIGRATIONS } from './playerMigrations'
import { Count, PLAYER_SCOPE_KIND, toRejected } from './playerScopeParts'
import { PROOF_TABLE, seedProofRows, shelveRow } from './proofScope'

export const playerScopeId = (playerId: string): string =>
  scopeId(PLAYER_SCOPE_KIND, playerId)

const EscapedOn = Schema.Array(Difficulty)

const PurseRanks = Schema.Array(Schema.Finite)

export const PlayerRow = Schema.Struct({
  sound: SoundSetting,
  music: MusicSetting,
  shake: ShakeSetting,
  share_stats: ShareStatsSetting,
  appearance: Schema.fromJsonString(StoredAppearance),
  difficulty: Difficulty,
  difficulty_card: SavedCard,
  nightmare: SavedNightmare,
  onboarding: Schema.fromJsonString(SavedOnboarding),
  home_screen_tip: HomeScreenTip,
  runs_played: Schema.Finite,
  total_kills: Schema.Finite,
  difficulty_bests: Schema.fromJsonString(SavedBestsByDifficulty),
  home: Schema.fromJsonString(SavedHome),
  seen_power_ups: Schema.fromJsonString(SavedPowerUps),
  seen_unlocks: Schema.fromJsonString(SavedSeenUnlocks),
  cursor: CursorSetting,
  rotation: RotationSetting,
  rumble: RumbleSetting,
  record_runs: RecordRunsSetting,
  record_unlock: RecordUnlock,
  name: PlayerName,
  calling: Calling,
  run_records: Schema.fromJsonString(SavedRunRecords),
  rank_points: Schema.Finite,
  rank_bones: Schema.Finite,
  veteran_points: Schema.Finite,
  veteran_bones: Schema.Finite,
  veteran_granted: Schema.Finite,
  spent_bones: Schema.Finite,
  doubled_day: Schema.NullOr(DayStamp),
  escaped_on: Schema.fromJsonString(EscapedOn),
  purses: Schema.fromJsonString(PurseRanks),
  last_run: RunEnding,
  missions: Schema.fromJsonString(SavedMissions),
  journal: Schema.fromJsonString(SavedJournal),
  dare_marks: DareMarksJson,
})
export type PlayerRow = typeof PlayerRow.Type

export const KillsRow = Schema.Struct({
  kind: Schema.String,
  kills: Schema.Finite,
})
export type KillsRow = typeof KillsRow.Type

export const PLAYER_COLUMNS = Array.make(
  'sound',
  'music',
  'shake',
  'share_stats',
  'appearance',
  'difficulty',
  'difficulty_card',
  'nightmare',
  'onboarding',
  'home_screen_tip',
  'runs_played',
  'total_kills',
  'difficulty_bests',
  'home',
  'seen_power_ups',
  'seen_unlocks',
  'cursor',
  'rotation',
  'rumble',
  'record_runs',
  'record_unlock',
  'name',
  'calling',
  'run_records',
  'rank_points',
  'rank_bones',
  'veteran_points',
  'veteran_bones',
  'veteran_granted',
  'spent_bones',
  'doubled_day',
  'escaped_on',
  'purses',
  'last_run',
  'missions',
  'journal',
  'dare_marks',
)

export const rowOfSave = (save: PlayerSave): PlayerRow => ({
  sound: save.settings.sound,
  music: save.settings.music,
  shake: save.settings.shake,
  share_stats: save.settings.shareStats,
  appearance: save.appearance,
  difficulty: save.difficulty.chosen,
  difficulty_card: save.difficulty.card,
  nightmare: save.difficulty.nightmare,
  onboarding: save.onboarding,
  home_screen_tip: save.homeScreenTip,
  runs_played: save.bests.runsPlayed,
  total_kills: save.bests.totalKills,
  difficulty_bests: save.bests.byDifficulty,
  home: save.home,
  seen_power_ups: save.seenPowerUps,
  seen_unlocks: save.seenUnlocks,
  cursor: save.settings.cursor,
  rotation: save.rotation,
  rumble: save.rumble,
  record_runs: save.recordRuns,
  record_unlock: save.recordUnlock,
  name: save.name,
  calling: save.calling,
  run_records: save.records,
  rank_points: save.rank.earnedPoints,
  rank_bones: save.rank.earnedBones,
  veteran_points: save.rank.veteranPoints,
  veteran_bones: save.rank.veteranBones,
  veteran_granted: save.rank.isVeteranGranted ? 1 : 0,
  spent_bones: save.rank.spentBones,
  doubled_day: save.bonuses.doubledDay,
  escaped_on: save.bonuses.escapedOn,
  purses: save.bonuses.purses,
  last_run: save.lastRun,
  missions: save.missions,
  journal: save.journal,
  dare_marks: save.dareMarks,
})

export const BoughtRow = Schema.Struct({ id: Schema.String })
export type BoughtRow = typeof BoughtRow.Type

export const boughtRowsOfSave = (save: PlayerSave): ReadonlyArray<BoughtRow> =>
  Array.map(save.boughtCosmetics, id => ({ id }))

export const killsRowsOfSave = (save: PlayerSave): ReadonlyArray<KillsRow> =>
  Array.map(Record.toEntries(save.bests.killsByKind), ([kind, kills]) => ({
    kind,
    kills,
  }))

const encodeRow = Schema.encodeEffect(PlayerRow)

const hasPlayer = (
  context: ApplyContext,
): Effect.Effect<boolean, SqlError.SqlError, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows =
      yield* sql`SELECT 1 AS here FROM ${context.table('player')} WHERE id = 1`
    return Array.isReadonlyArrayNonEmpty(rows)
  })

const updatePlayer = (
  context: ApplyContext,
  columns: Readonly<Record<string, string | number>>,
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`UPDATE ${context.table('player')} SET ${sql.update(columns)} WHERE id = 1`
  })

export const SeededPlayer = defineMutation({
  name: 'SeededPlayer',
  version: 25,
  args: Schema.Struct({ save: PlayerSave }),
  scopes: [PLAYER_SCOPE_KIND],
  writer: 'Owner',
  apply: ({ save }, context) =>
    Effect.gen(function* () {
      if (yield* hasPlayer(context)) {
        return
      }
      const sql = yield* SqlClient.SqlClient
      const encoded = yield* Effect.mapError(
        encodeRow(rowOfSave(save)),
        toRejected,
      )
      yield* sql`INSERT INTO ${context.table('player')} ${sql.insert({ id: 1, ...encoded })}`
      yield* sql`DELETE FROM ${context.table('kills_by_kind')}`
      yield* Array.match(killsRowsOfSave(save), {
        onEmpty: () => Effect.void,
        onNonEmpty: rows =>
          Effect.asVoid(
            sql`INSERT INTO ${context.table('kills_by_kind')} ${sql.insert(rows)}`,
          ),
      })
      yield* sql`DELETE FROM ${context.table('bought_cosmetics')}`
      yield* Array.match(boughtRowsOfSave(save), {
        onEmpty: () => Effect.void,
        onNonEmpty: rows =>
          Effect.asVoid(
            sql`INSERT INTO ${context.table('bought_cosmetics')} ${sql.insert(rows)}`,
          ),
      })
      yield* seedProofRows(context, save.proof)
      yield* seedMasteryRows(context, save.mastery)
    }),
})

export const ChangedSettings = defineMutation({
  name: 'ChangedSettings',
  version: 2,
  args: Schema.Struct({ settings: SavedSettings }),
  scopes: [PLAYER_SCOPE_KIND],
  writer: 'Owner',
  apply: ({ settings }, context) =>
    updatePlayer(context, {
      sound: settings.sound,
      music: settings.music,
      shake: settings.shake,
      share_stats: settings.shareStats,
      cursor: settings.cursor,
    }),
})

export const ChangedAppearance = defineMutation({
  name: 'ChangedAppearance',
  version: 6,
  args: Schema.Struct({ appearance: Appearance }),
  scopes: [PLAYER_SCOPE_KIND],
  writer: 'Owner',
  apply: ({ appearance }, context) =>
    Effect.flatMap(
      Effect.mapError(
        Schema.encodeEffect(Schema.fromJsonString(Appearance))(appearance),
        toRejected,
      ),
      json => updatePlayer(context, { appearance: json }),
    ),
})

const NightmareRow = Schema.Struct({ nightmare: SavedNightmare })

export const ChangedDifficulty = defineMutation({
  name: 'ChangedDifficulty',
  version: 1,
  args: Schema.Struct({ chosen: Difficulty, card: SavedCard }),
  scopes: [PLAYER_SCOPE_KIND],
  writer: 'Owner',
  apply: ({ chosen, card }, context) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      if (chosen === 'Nightmare') {
        const rows =
          yield* sql`SELECT nightmare FROM ${context.table('player')} WHERE id = 1`
        const lock = pipe(
          Array.head(rows),
          Option.flatMap(Schema.decodeUnknownOption(NightmareRow)),
          Option.map(row => row.nightmare),
        )
        if (Option.contains(lock, 'Locked')) {
          return yield* MutationRejected.make({
            reason: 'Nightmare is still locked',
          })
        }
      }
      yield* updatePlayer(context, {
        difficulty: chosen,
        difficulty_card: card,
      })
    }),
})

export const UnlockedNightmare = defineMutation({
  name: 'UnlockedNightmare',
  version: 1,
  args: Schema.Struct({}),
  scopes: [PLAYER_SCOPE_KIND],
  writer: 'Owner',
  apply: (_, context) => updatePlayer(context, { nightmare: 'Unlocked' }),
})

export const ChangedOnboarding = defineMutation({
  name: 'ChangedOnboarding',
  version: 2,
  args: Schema.Struct({
    onboarding: SavedOnboarding,
    homeScreenTip: HomeScreenTip,
  }),
  scopes: [PLAYER_SCOPE_KIND],
  writer: 'Owner',
  apply: ({ onboarding, homeScreenTip }, context) =>
    Effect.flatMap(
      Effect.mapError(
        Schema.encodeEffect(Schema.fromJsonString(SavedOnboarding))(onboarding),
        toRejected,
      ),
      json =>
        updatePlayer(context, {
          onboarding: json,
          home_screen_tip: homeScreenTip,
        }),
    ),
})

export const ChangedHome = defineMutation({
  name: 'ChangedHome',
  version: 1,
  args: Schema.Struct({ home: SavedHome }),
  scopes: [PLAYER_SCOPE_KIND],
  writer: 'Owner',
  apply: ({ home }, context) =>
    Effect.flatMap(
      Effect.mapError(
        Schema.encodeEffect(Schema.fromJsonString(SavedHome))(home),
        toRejected,
      ),
      json => updatePlayer(context, { home: json }),
    ),
})

export const ChangedRotation = defineMutation({
  name: 'ChangedRotation',
  version: 1,
  args: Schema.Struct({ rotation: RotationSetting }),
  scopes: [PLAYER_SCOPE_KIND],
  writer: 'Owner',
  apply: ({ rotation }, context) => updatePlayer(context, { rotation }),
})

export const ChangedRumble = defineMutation({
  name: 'ChangedRumble',
  version: 1,
  args: Schema.Struct({ rumble: RumbleSetting }),
  scopes: [PLAYER_SCOPE_KIND],
  writer: 'Owner',
  apply: ({ rumble }, context) => updatePlayer(context, { rumble }),
})

export const ChangedRecordRuns = defineMutation({
  name: 'ChangedRecordRuns',
  version: 1,
  args: Schema.Struct({ recordRuns: RecordRunsSetting }),
  scopes: [PLAYER_SCOPE_KIND],
  writer: 'Owner',
  apply: ({ recordRuns }, context) =>
    updatePlayer(context, { record_runs: recordRuns }),
})

export const UnlockedRecording = defineMutation({
  name: 'UnlockedRecording',
  version: 1,
  args: Schema.Struct({}),
  scopes: [PLAYER_SCOPE_KIND],
  writer: 'Owner',
  apply: (_, context) => updatePlayer(context, { record_unlock: 'Unlocked' }),
})

export const EndedRun = defineMutation({
  name: 'EndedRun',
  version: 1,
  args: Schema.Struct({ lastRun: RunEnding }),
  scopes: [PLAYER_SCOPE_KIND],
  writer: 'Owner',
  apply: ({ lastRun }, context) => updatePlayer(context, { last_run: lastRun }),
})

export const ChangedCalling = defineMutation({
  name: 'ChangedCalling',
  version: 1,
  args: Schema.Struct({ calling: Calling }),
  scopes: [PLAYER_SCOPE_KIND],
  writer: 'Owner',
  apply: ({ calling }, context) => updatePlayer(context, { calling }),
})

export const ChangedName = defineMutation({
  name: 'ChangedName',
  version: 1,
  args: Schema.Struct({ name: PlayerName }),
  scopes: [PLAYER_SCOPE_KIND],
  writer: 'Owner',
  apply: ({ name }, context) => updatePlayer(context, { name }),
})

const PowerUpsRow = Schema.Struct({
  seen_power_ups: Schema.fromJsonString(SavedPowerUps),
})

const encodePowerUps = Schema.encodeEffect(Schema.fromJsonString(SavedPowerUps))

export const SawPowerUps = defineMutation({
  name: 'SawPowerUps',
  version: 1,
  args: Schema.Struct({ kinds: SavedPowerUps }),
  scopes: [PLAYER_SCOPE_KIND],
  writer: 'Owner',
  apply: ({ kinds }, context) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows =
        yield* sql`SELECT seen_power_ups FROM ${context.table('player')} WHERE id = 1`
      const maybeSeen = pipe(
        Array.head(rows),
        Option.flatMap(Schema.decodeUnknownOption(PowerUpsRow)),
        Option.map(row => row.seen_power_ups),
      )
      if (Option.isNone(maybeSeen)) {
        return
      }
      const json = yield* Effect.mapError(
        encodePowerUps(Array.union(maybeSeen.value, kinds)),
        toRejected,
      )
      yield* updatePlayer(context, { seen_power_ups: json })
    }),
})

const UnlocksRow = Schema.Struct({
  seen_unlocks: Schema.fromJsonString(SavedSeenUnlocks),
})

const encodeUnlocks = Schema.encodeEffect(
  Schema.fromJsonString(SavedSeenUnlocks),
)

export const SawUnlocks = defineMutation({
  name: 'SawUnlocks',
  version: 1,
  args: Schema.Struct({ ids: SavedSeenUnlocks }),
  scopes: [PLAYER_SCOPE_KIND],
  writer: 'Owner',
  apply: ({ ids }, context) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows =
        yield* sql`SELECT seen_unlocks FROM ${context.table('player')} WHERE id = 1`
      const maybeSeen = pipe(
        Array.head(rows),
        Option.flatMap(Schema.decodeUnknownOption(UnlocksRow)),
        Option.map(row => row.seen_unlocks),
      )
      if (Option.isNone(maybeSeen)) {
        return
      }
      const json = yield* Effect.mapError(
        encodeUnlocks(
          Array.filter(
            Array.union(maybeSeen.value, ids),
            id => id !== SEEN_BASELINE,
          ),
        ),
        toRejected,
      )
      yield* updatePlayer(context, { seen_unlocks: json })
    }),
})

export const ForgotPowerUps = defineMutation({
  name: 'ForgotPowerUps',
  version: 1,
  args: Schema.Struct({}),
  scopes: [PLAYER_SCOPE_KIND],
  writer: 'Owner',
  apply: (_, context) => updatePlayer(context, { seen_power_ups: '[]' }),
})

const MAX_RUNS_PER_RECORD = 3
const MAX_KILLS_PER_RUN = 5000

const BestsRow = Schema.Struct({
  difficulty_bests: Schema.fromJsonString(SavedBestsByDifficulty),
})

const smaller = (a: number | null, b: number | null): number | null =>
  a === null ? b : b === null ? a : Math.min(a, b)

const larger = (a: number | null, b: number | null): number | null =>
  a === null ? b : b === null ? a : Math.max(a, b)

const mergeBests = (
  kept: SavedDifficultyBests,
  reached: SavedDifficultyBests,
): SavedDifficultyBests => ({
  fastestWinMs: smaller(kept.fastestWinMs, reached.fastestWinMs),
  bestEndlessWave: larger(kept.bestEndlessWave, reached.bestEndlessWave),
})

const mergeBestsByDifficulty = (
  kept: SavedBestsByDifficulty,
  reached: SavedBestsByDifficulty,
): SavedBestsByDifficulty => ({
  Easy: mergeBests(kept.Easy, reached.Easy),
  Normal: mergeBests(kept.Normal, reached.Normal),
  Hard: mergeBests(kept.Hard, reached.Hard),
  Nightmare: mergeBests(kept.Nightmare, reached.Nightmare),
})

export const RecordedRun = defineMutation({
  name: 'RecordedRun',
  version: 1,
  args: Schema.Struct({
    runs: Count,
    totalKills: Count,
    kills: Schema.Record(Schema.String, Count),
    bests: SavedBestsByDifficulty,
  }),
  scopes: [PLAYER_SCOPE_KIND],
  writer: 'Owner',
  apply: ({ runs, totalKills, kills, bests }, context) =>
    Effect.gen(function* () {
      if (
        runs > MAX_RUNS_PER_RECORD ||
        totalKills > MAX_KILLS_PER_RUN * Math.max(runs, 1)
      ) {
        return yield* MutationRejected.make({
          reason: 'That run does not add up',
        })
      }
      const sql = yield* SqlClient.SqlClient
      const rows =
        yield* sql`SELECT difficulty_bests FROM ${context.table('player')} WHERE id = 1`
      const maybeKept = pipe(
        Array.head(rows),
        Option.flatMap(Schema.decodeUnknownOption(BestsRow)),
      )
      if (Option.isNone(maybeKept)) {
        return
      }
      const merged = yield* Effect.mapError(
        Schema.encodeEffect(Schema.fromJsonString(SavedBestsByDifficulty))(
          mergeBestsByDifficulty(maybeKept.value.difficulty_bests, bests),
        ),
        toRejected,
      )
      yield* sql`UPDATE ${context.table('player')} SET
        runs_played = runs_played + ${runs},
        total_kills = total_kills + ${totalKills},
        difficulty_bests = ${merged}
        WHERE id = 1`
      const added = Array.filter(
        Record.toEntries(kills),
        ([, count]) => count > 0,
      )
      yield* Array.match(added, {
        onEmpty: () => Effect.void,
        onNonEmpty: entries =>
          Effect.asVoid(
            sql`INSERT INTO ${context.table('kills_by_kind')} ${sql.insert(
              Array.map(entries, ([kind, count]) => ({ kind, kills: count })),
            )} ON CONFLICT (kind) DO UPDATE SET kills = kills + excluded.kills`,
          ),
      })
    }),
})

const RecordsRow = Schema.Struct({
  run_records: Schema.fromJsonString(SavedRunRecords),
})

const betterRun = (
  kept: SavedBestRun | null,
  reached: SavedBestRun | null,
): SavedBestRun | null =>
  kept === null
    ? reached
    : reached !== null && isBetterRun(reached, kept)
      ? reached
      : kept

const mergeRecord = (
  kept: SavedRunRecord,
  reached: SavedRunRecord,
): SavedRunRecord => ({
  furthestWave: larger(kept.furthestWave, reached.furthestWave),
  mostKills: larger(kept.mostKills, reached.mostKills),
  bestRun: betterRun(kept.bestRun, reached.bestRun),
})

export const mergeRunRecords: {
  (reached: SavedRunRecords): (kept: SavedRunRecords) => SavedRunRecords
  (kept: SavedRunRecords, reached: SavedRunRecords): SavedRunRecords
} = Function.dual(
  2,
  (kept: SavedRunRecords, reached: SavedRunRecords): SavedRunRecords => ({
    Easy: mergeRecord(kept.Easy, reached.Easy),
    Normal: mergeRecord(kept.Normal, reached.Normal),
    Hard: mergeRecord(kept.Hard, reached.Hard),
    Nightmare: mergeRecord(kept.Nightmare, reached.Nightmare),
  }),
)

export const ReachedRecords = defineMutation({
  name: 'ReachedRecords',
  version: 2,
  args: Schema.Struct({ records: SavedRunRecords }),
  scopes: [PLAYER_SCOPE_KIND],
  writer: 'Owner',
  apply: ({ records }, context) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows =
        yield* sql`SELECT run_records FROM ${context.table('player')} WHERE id = 1`
      const maybeKept = pipe(
        Array.head(rows),
        Option.flatMap(Schema.decodeUnknownOption(RecordsRow)),
        Option.map(row => row.run_records),
      )
      if (Option.isNone(maybeKept)) {
        return
      }
      const json = yield* Effect.mapError(
        Schema.encodeEffect(Schema.fromJsonString(SavedRunRecords))(
          mergeRunRecords(maybeKept.value, records),
        ),
        toRejected,
      )
      yield* updatePlayer(context, { run_records: json })
    }),
})

const MAX_POINTS_PER_RUN = 20000
const MAX_BONES_PER_RUN = MAX_POINTS_PER_RUN / 10

const Points = Count.check(Schema.isLessThanOrEqualTo(MAX_POINTS_PER_RUN))

const Bones = Count.check(Schema.isLessThanOrEqualTo(MAX_BONES_PER_RUN))

export const EarnedRank = defineMutation({
  name: 'EarnedRank',
  version: 1,
  args: Schema.Struct({ points: Points, bones: Bones }),
  scopes: [PLAYER_SCOPE_KIND],
  writer: 'Owner',
  apply: ({ points, bones }, context) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`UPDATE ${context.table('player')} SET
        rank_points = rank_points + ${points},
        rank_bones = rank_bones + ${bones}
        WHERE id = 1`
    }),
})

const MAX_VETERAN_POINTS = 1800

export const GrantedVeteranRank = defineMutation({
  name: 'GrantedVeteranRank',
  version: 1,
  args: Schema.Struct({
    points: Count.check(Schema.isLessThanOrEqualTo(MAX_VETERAN_POINTS)),
    bones: Count.check(Schema.isLessThanOrEqualTo(MAX_VETERAN_POINTS / 10)),
  }),
  scopes: [PLAYER_SCOPE_KIND],
  writer: 'Owner',
  apply: ({ points, bones }, context) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`UPDATE ${context.table('player')} SET
        veteran_points = MAX(veteran_points, ${points}),
        veteran_bones = MAX(veteran_bones, ${bones}),
        veteran_granted = 1
        WHERE id = 1`
    }),
})

const BalanceRow = Schema.Struct({ balance: Schema.Finite })

export const BoughtCosmetic = defineMutation({
  name: 'BoughtCosmetic',
  version: 1,
  args: Schema.Struct({ id: Schema.String }),
  scopes: [PLAYER_SCOPE_KIND],
  writer: 'Owner',
  apply: ({ id }, context) =>
    Effect.gen(function* () {
      const maybePrice = Record.get<string, number>(COSMETIC_PRICES, id)
      if (Option.isNone(maybePrice)) {
        return
      }
      const sql = yield* SqlClient.SqlClient
      const owned =
        yield* sql`SELECT 1 AS here FROM ${context.table('bought_cosmetics')} WHERE id = ${id}`
      if (Array.isReadonlyArrayNonEmpty(owned)) {
        return
      }
      const rows = yield* sql`SELECT
        rank_bones + veteran_bones - spent_bones AS balance
        FROM ${context.table('player')} WHERE id = 1`
      const maybeBalance = pipe(
        Array.head(rows),
        Option.flatMap(Schema.decodeUnknownOption(BalanceRow)),
        Option.map(row => row.balance),
      )
      if (
        Option.isNone(maybeBalance) ||
        maybeBalance.value < maybePrice.value
      ) {
        return
      }
      yield* sql`INSERT INTO ${context.table('bought_cosmetics')} (id) VALUES (${id})`
      yield* sql`UPDATE ${context.table('player')} SET
        spent_bones = spent_bones + ${maybePrice.value}
        WHERE id = 1`
    }),
})

const BonusesRow = Schema.Struct({
  doubled_day: Schema.NullOr(DayStamp),
  escaped_on: Schema.fromJsonString(EscapedOn),
})

const readBonuses = (context: ApplyContext) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows =
      yield* sql`SELECT doubled_day, escaped_on FROM ${context.table('player')} WHERE id = 1`
    return pipe(
      Array.head(rows),
      Option.flatMap(Schema.decodeUnknownOption(BonusesRow)),
    )
  })

export const DoubledFirstRun = defineMutation({
  name: 'DoubledFirstRun',
  version: 1,
  args: Schema.Struct({ day: DayStamp, bones: Bones }),
  scopes: [PLAYER_SCOPE_KIND],
  writer: 'Owner',
  apply: ({ day, bones }, context) =>
    Effect.gen(function* () {
      const maybeKept = yield* readBonuses(context)
      if (
        Option.isNone(maybeKept) ||
        (maybeKept.value.doubled_day !== null &&
          maybeKept.value.doubled_day >= day)
      ) {
        return
      }
      const sql = yield* SqlClient.SqlClient
      yield* sql`UPDATE ${context.table('player')} SET
        doubled_day = ${day},
        rank_bones = rank_bones + ${bones}
        WHERE id = 1`
    }),
})

const encodeEscapedOn = Schema.encodeEffect(Schema.fromJsonString(EscapedOn))

export const EscapedFirst = defineMutation({
  name: 'EscapedFirst',
  version: 1,
  args: Schema.Struct({ difficulty: Difficulty }),
  scopes: [PLAYER_SCOPE_KIND],
  writer: 'Owner',
  apply: ({ difficulty }, context) =>
    Effect.gen(function* () {
      const maybeKept = yield* readBonuses(context)
      if (
        Option.isNone(maybeKept) ||
        Array.contains(maybeKept.value.escaped_on, difficulty)
      ) {
        return
      }
      const json = yield* Effect.mapError(
        encodeEscapedOn(Array.append(maybeKept.value.escaped_on, difficulty)),
        toRejected,
      )
      const sql = yield* SqlClient.SqlClient
      yield* sql`UPDATE ${context.table('player')} SET
        escaped_on = ${json},
        rank_bones = rank_bones + ${FIRST_ESCAPE_BONES}
        WHERE id = 1`
    }),
})

const PurseRow = Schema.Struct({
  purses: Schema.fromJsonString(PurseRanks),
  points: Schema.Finite,
})

const encodePurses = Schema.encodeEffect(Schema.fromJsonString(PurseRanks))

export const PaidRankPurse = defineMutation({
  name: 'PaidRankPurse',
  version: 1,
  args: Schema.Struct({ rank: Count }),
  scopes: [PLAYER_SCOPE_KIND],
  writer: 'Owner',
  apply: ({ rank }, context) =>
    Effect.gen(function* () {
      const maybeBones = purseBonesAt(rank)
      if (Option.isNone(maybeBones)) {
        return
      }
      const sql = yield* SqlClient.SqlClient
      const rows =
        yield* sql`SELECT purses, rank_points + veteran_points AS points FROM ${context.table('player')} WHERE id = 1`
      const maybeKept = pipe(
        Array.head(rows),
        Option.flatMap(Schema.decodeUnknownOption(PurseRow)),
      )
      if (
        Option.isNone(maybeKept) ||
        Array.contains(maybeKept.value.purses, rank) ||
        rankOf(maybeKept.value.points) < rank
      ) {
        return
      }
      const json = yield* Effect.mapError(
        encodePurses(Array.append(maybeKept.value.purses, rank)),
        toRejected,
      )
      yield* sql`UPDATE ${context.table('player')} SET
        purses = ${json},
        rank_bones = rank_bones + ${maybeBones.value}
        WHERE id = 1`
    }),
})

export const ShelvedProof = defineMutation({
  name: 'ShelvedProof',
  version: 1,
  args: Schema.Struct({ entry: ProofEntry }),
  scopes: [PLAYER_SCOPE_KIND],
  writer: 'Owner',
  apply: ({ entry }, context) => shelveRow(context, entry),
})

const MAX_THINGS_PER_RUN = 10

const JournalRow = Schema.Struct({
  journal: Schema.fromJsonString(SavedJournal),
})

const encodeJournal = Schema.encodeEffect(Schema.fromJsonString(SavedJournal))

export const KeptJournal = defineMutation({
  name: 'KeptJournal',
  version: 1,
  args: Schema.Struct({
    added: SavedJournal.mapFields(fields => ({
      ...fields,
      thingsFound: Count.check(Schema.isLessThanOrEqualTo(MAX_THINGS_PER_RUN)),
    })),
  }),
  scopes: [PLAYER_SCOPE_KIND],
  writer: 'Owner',
  apply: ({ added }, context) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows =
        yield* sql`SELECT journal FROM ${context.table('player')} WHERE id = 1`
      const maybeKept = pipe(
        Array.head(rows),
        Option.flatMap(Schema.decodeUnknownOption(JournalRow)),
        Option.map(row => row.journal),
      )
      if (Option.isNone(maybeKept)) {
        return
      }
      const json = yield* Effect.mapError(
        encodeJournal(addToJournal(maybeKept.value, added)),
        toRejected,
      )
      yield* sql`UPDATE ${context.table('player')} SET journal = ${json} WHERE id = 1`
    }),
})

export const LinkedDevices = defineMutation({
  name: 'LinkedDevices',
  version: 1,
  args: Schema.Struct({ count: Count }),
  scopes: [PLAYER_SCOPE_KIND],
  writer: 'ServerOnly',
  apply: ({ count }, context) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`INSERT INTO ${context.table('linked_devices')} (id, count) VALUES (1, ${count})
        ON CONFLICT (id) DO UPDATE SET count = excluded.count`
    }),
})

export const PlayerScope = defineScope({
  kind: PLAYER_SCOPE_KIND,
  tables: [
    'player',
    'kills_by_kind',
    'linked_devices',
    'bought_cosmetics',
    PROOF_TABLE,
    HERO_MASTERY_TABLE,
    GUN_KILLS_TABLE,
  ],
  readers: 'Owner',
  replica: 'ReadWrite',
  mutations: [
    SeededPlayer,
    ChangedSettings,
    ChangedRotation,
    ChangedRumble,
    ChangedRecordRuns,
    UnlockedRecording,
    ChangedName,
    ChangedAppearance,
    ChangedDifficulty,
    UnlockedNightmare,
    ChangedOnboarding,
    ChangedHome,
    SawPowerUps,
    SawUnlocks,
    ForgotPowerUps,
    RecordedRun,
    ReachedRecords,
    ChangedCalling,
    EarnedRank,
    GrantedVeteranRank,
    BoughtCosmetic,
    DoubledFirstRun,
    EscapedFirst,
    PaidRankPurse,
    EndedRun,
    ProgressedMissions,
    RolledMissions,
    RerolledMission,
    ClaimedMission,
    StampedMissionDay,
    ShelvedProof,
    KeptJournal,
    GainedMastery,
    ClimbedDareLadder,
    LinkedDevices,
  ],
  migrations: PLAYER_MIGRATIONS,
})
