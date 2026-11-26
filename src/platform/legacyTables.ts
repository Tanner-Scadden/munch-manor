import { Array, Effect, Option, Record, Schema, pipe } from 'effect'
import { SqlClient } from 'effect/sql'

import { SavedDareMarks } from '#shared/dareMarkData.ts'
import { DayStamp } from '#shared/dayStamp.ts'
import { SavedJournal } from '#shared/journalData.ts'
import { StoredAppearance } from '#shared/lookCodes.ts'
import { SavedMissions } from '#shared/missionData.ts'
import {
  Calling,
  CursorSetting,
  Difficulty,
  HomeScreenTip,
  MusicSetting,
  PlayerName,
  type PlayerSave,
  RecordRunsSetting,
  RecordUnlock,
  RotationSetting,
  RumbleSetting,
  RunEnding,
  SAVE_VERSION,
  SavedBestsByDifficulty,
  SavedCard,
  SavedHome,
  SavedNightmare,
  SavedOnboarding,
  SavedPowerUps,
  SavedRunRecords,
  SavedSeenUnlocks,
  ShakeSetting,
  ShareStatsSetting,
  SoundSetting,
} from '#shared/playerData.ts'
import { CrewMate, ProofEnding, type ProofEntry } from '#shared/proofData.ts'

const OldPlayerRow = Schema.Struct({
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
  escaped_on: Schema.fromJsonString(Schema.Array(Difficulty)),
  purses: Schema.fromJsonString(Schema.Array(Schema.Finite)),
  last_run: RunEnding,
  missions: Schema.fromJsonString(SavedMissions),
  journal: Schema.fromJsonString(SavedJournal),
  dare_marks: Schema.fromJsonString(SavedDareMarks),
})
type OldPlayerRow = typeof OldPlayerRow.Type

const CountRow = Schema.Struct({ name: Schema.String, count: Schema.Finite })
type CountRow = typeof CountRow.Type

const BoughtRow = Schema.Struct({ id: Schema.String })

const ProofRow = Schema.Struct({
  thing: Schema.String,
  difficulty: Schema.String,
  wave: Schema.Finite,
  hero: Schema.String,
  crew: Schema.fromJsonString(Schema.Array(CrewMate)),
  day: Schema.NullOr(DayStamp),
  ending: ProofEnding,
})
type ProofRow = typeof ProofRow.Type

const OLD_PLAYER_TABLES: ReadonlyArray<string> = [
  'player',
  'kills_by_kind',
  'linked_devices',
  'bought_cosmetics',
  'proof',
  'hero_mastery',
  'kills_by_gun',
]

const OLD_CONFIRMED_PREFIX = 'sync_confirmed_'

const OLD_DEVICE_TABLE = 'sync_device'

const OLD_SCOPE_TABLES: ReadonlyArray<string> = [
  'sync_replicas',
  'sync_outbox',
  'sync_status',
  'sync_settled',
]

const OLD_PLAYER_KIND = 'player'

const rowsOf = <A, E>(
  schema: Schema.Codec<A, unknown>,
  read: Effect.Effect<ReadonlyArray<unknown>, E>,
) =>
  pipe(
    read,
    Effect.map(rows =>
      Array.filterMap(rows, row => Schema.decodeUnknownResult(schema)(row)),
    ),
    Effect.orElseSucceed((): ReadonlyArray<A> => []),
  )

const countsOf = (rows: ReadonlyArray<CountRow>): Record<string, number> =>
  Record.fromEntries(
    Array.map(rows, ({ name, count }): readonly [string, number] => [
      name,
      count,
    ]),
  )

const proofOfRow = (row: ProofRow): ProofEntry => ({
  thing: row.thing,
  difficulty: row.difficulty,
  stamp: {
    wave: row.wave,
    hero: row.hero,
    crew: row.crew,
    day: row.day,
    ending: row.ending,
  },
})

type OldParts = Readonly<{
  kills: ReadonlyArray<CountRow>
  bought: ReadonlyArray<string>
  proof: ReadonlyArray<ProofEntry>
  heroes: ReadonlyArray<CountRow>
  guns: ReadonlyArray<CountRow>
}>

const saveOfOldRow = (row: OldPlayerRow, parts: OldParts): PlayerSave => ({
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
    killsByKind: countsOf(parts.kills),
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
  boughtCosmetics: parts.bought,
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
    purses: row.purses,
  },
  lastRun: row.last_run,
  missions: row.missions,
  journal: row.journal,
  dareMarks: row.dare_marks,
  proof: parts.proof,
  mastery: { heroes: countsOf(parts.heroes), guns: countsOf(parts.guns) },
})

export const readOldSave: Effect.Effect<
  Option.Option<PlayerSave>,
  never,
  SqlClient.SqlClient
> = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const players = yield* rowsOf(
    OldPlayerRow,
    sql`SELECT * FROM player WHERE id = 1`,
  )
  return yield* Option.match(Array.head(players), {
    onNone: () => Effect.succeedNone,
    onSome: row =>
      Effect.gen(function* () {
        const kills = yield* rowsOf(
          CountRow,
          sql`SELECT kind AS name, kills AS count FROM kills_by_kind`,
        )
        const bought = yield* rowsOf(
          BoughtRow,
          sql`SELECT id FROM bought_cosmetics`,
        )
        const proof = yield* rowsOf(
          ProofRow,
          sql`SELECT thing, difficulty, wave, hero, crew, day, ending FROM proof`,
        )
        const heroes = yield* rowsOf(
          CountRow,
          sql`SELECT hero AS name, points AS count FROM hero_mastery`,
        )
        const guns = yield* rowsOf(
          CountRow,
          sql`SELECT gun AS name, kills AS count FROM kills_by_gun`,
        )
        return Option.some(
          saveOfOldRow(row, {
            kills,
            bought: Array.map(bought, ({ id }) => id),
            proof: Array.map(proof, proofOfRow),
            heroes,
            guns,
          }),
        )
      }),
  })
})

export const dropOldTables: Effect.Effect<void, never, SqlClient.SqlClient> =
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const dropped = Array.appendAll(
      Array.flatMap(OLD_PLAYER_TABLES, table => [
        table,
        `${OLD_CONFIRMED_PREFIX}${table}`,
      ]),
      [OLD_DEVICE_TABLE],
    )
    yield* Effect.forEach(
      dropped,
      table => Effect.ignore(sql`DROP TABLE IF EXISTS ${sql(table)}`),
      { discard: true },
    )
    yield* Effect.forEach(
      OLD_SCOPE_TABLES,
      table =>
        Effect.ignore(
          sql`DELETE FROM ${sql(table)} WHERE kind = ${OLD_PLAYER_KIND}`,
        ),
      { discard: true },
    )
  })
