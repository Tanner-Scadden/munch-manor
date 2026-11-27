import {
  Array,
  Effect,
  Function,
  Layer,
  Option,
  Order,
  Record,
  Schema,
  pipe,
} from 'effect'
import { type EventJournal, EventLog, EventRow } from 'effect/eventlog'
import { SqlClient } from 'effect/sql'

import {
  SavedDareMarks,
  TOP_MARK,
  mergeDareMarks,
  noDareMarks,
} from '#shared/records/dareMarkData.ts'
import { type DayStamp, laterDay } from '#shared/records/dayStamp.ts'
import {
  SavedJournal,
  addToJournal,
  noJournal,
} from '#shared/records/journalData.ts'
import {
  SavedMastery,
  addToMastery,
  noMastery,
} from '#shared/records/masteryData.ts'
import {
  ALL_THREE_BONES,
  SavedMissions,
  addProgress,
  bonesOfMission,
  freezeOn,
  mergeMissions,
  noMissions,
  onDay,
  rerollOn,
} from '#shared/records/missionData.ts'
import {
  COSMETIC_PRICES,
  FIRST_ESCAPE_BONES,
  type PlayerSave,
  RecordUnlock,
  SAVE_VERSION,
  SEEN_BASELINE,
  type SavedBestRun,
  SavedBests,
  type SavedBestsByDifficulty,
  SavedBonuses,
  SavedBoughtCosmetics,
  type SavedDifficultyBests,
  SavedNightmare,
  SavedRank,
  type SavedRunRecord,
  SavedRunRecords,
  SavedSeenUnlocks,
  isBetterRun,
  noBonuses,
  noSavedBests,
  noSavedRunRecords,
} from '#shared/records/playerData.ts'
import {
  type ProofEntry,
  type ProofStamp,
  SavedProof,
  isEarlierStamp,
  noProof,
} from '#shared/records/proofData.ts'
import { purseBonesAt } from '#shared/records/rankCurve.ts'
import { noRank } from '#world/heroes/rank.ts'

import {
  EarnedEvents,
  MissionEvents,
  PLAYER_ROW_KEY,
  PlayerRow,
  PlayerRowFields,
  type SeedSave,
  SetEvents,
} from './playerEvents.ts'

const ROW_TABLE = 'player_row'
const FACTS_TABLE = 'player_facts'
const APPLIED_TABLE = 'applied_entries'
const ONCE_TABLE = 'once_keys'

export const PROJECTION_TABLES: ReadonlyArray<string> = [
  ROW_TABLE,
  FACTS_TABLE,
  APPLIED_TABLE,
  ONCE_TABLE,
]

export const createPlayerTables = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`CREATE TABLE IF NOT EXISTS player_row (
    id TEXT PRIMARY KEY,
    row TEXT NOT NULL
  )`
  yield* sql`CREATE TABLE IF NOT EXISTS player_facts (
    name TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`
  yield* sql`CREATE TABLE IF NOT EXISTS applied_entries (
    id TEXT PRIMARY KEY
  )`
  yield* sql`CREATE TABLE IF NOT EXISTS once_keys (
    key TEXT PRIMARY KEY
  )`
})

export const dropPlayerTables = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* Effect.forEach(
    PROJECTION_TABLES,
    table => sql`DROP TABLE IF EXISTS ${sql(table)}`,
    { discard: true },
  )
})

const Unlocks = Schema.Struct({
  nightmare: SavedNightmare,
  recordUnlock: RecordUnlock,
})
type Unlocks = typeof Unlocks.Type

type Fact<A> = Readonly<{
  name: string
  json: Schema.Codec<A, string>
  empty: A
}>

const factOf = <S extends Schema.Codec<unknown>>(
  name: string,
  schema: S,
  empty: S['Type'],
): Fact<S['Type']> => ({
  name,
  json: Schema.fromJsonString(Schema.toCodecJson(schema)),
  empty,
})

const FACTS = {
  bests: factOf('bests', SavedBests, noSavedBests),
  records: factOf('records', SavedRunRecords, noSavedRunRecords),
  rank: factOf('rank', SavedRank, noRank),
  bought: factOf('bought', SavedBoughtCosmetics, []),
  bonuses: factOf('bonuses', SavedBonuses, noBonuses),
  unlocks: factOf('unlocks', Unlocks, {
    nightmare: 'Locked',
    recordUnlock: 'Locked',
  }),
  seenUnlocks: factOf('seenUnlocks', SavedSeenUnlocks, []),
  missions: factOf('missions', SavedMissions, noMissions),
  proof: factOf('proof', SavedProof, noProof),
  journal: factOf('journal', SavedJournal, noJournal),
  mastery: factOf('mastery', SavedMastery, noMastery),
  dareMarks: factOf('dareMarks', SavedDareMarks, noDareMarks),
}

const markOf = (mark: number): number =>
  Number.isInteger(mark) ? Math.min(TOP_MARK, Math.max(0, mark)) : 0

export const ValueRow = Schema.Struct({ value: Schema.String })

const readFact = <A>(fact: Fact<A>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows =
      yield* sql`SELECT value FROM ${sql(FACTS_TABLE)} WHERE name = ${fact.name}`
    return yield* pipe(
      Array.head(rows),
      Option.flatMap(Schema.decodeUnknownOption(ValueRow)),
      Option.match({
        onNone: () => Effect.succeed(fact.empty),
        onSome: ({ value }) => Schema.decodeEffect(fact.json)(value),
      }),
    )
  })

const writeFact = <A>(fact: Fact<A>, value: A) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const json = yield* Schema.encodeEffect(fact.json)(value)
    yield* sql`INSERT INTO ${sql(FACTS_TABLE)} ${sql.insert({ name: fact.name, value: json })}
      ON CONFLICT (name) DO UPDATE SET value = excluded.value`
  })

const modifyFact = <A>(fact: Fact<A>, change: (value: A) => NoInfer<A>) =>
  Effect.flatMap(readFact(fact), value => writeFact(fact, change(value)))

const isFirstTime = (table: string, column: string, key: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows =
      yield* sql`INSERT INTO ${sql(table)} ${sql.insert({ [column]: key })}
      ON CONFLICT DO NOTHING RETURNING ${sql(column)}`
    return Array.isReadonlyArrayNonEmpty(rows)
  })

const oncePerEntry = <E, R>(
  entry: EventJournal.Entry,
  effect: Effect.Effect<void, E, R>,
) =>
  Effect.flatMap(isFirstTime(APPLIED_TABLE, 'id', entry.idString), isFirst =>
    isFirst ? effect : Effect.void,
  )

const oncePerKey = <E, R>(key: string, effect: Effect.Effect<void, E, R>) =>
  Effect.flatMap(isFirstTime(ONCE_TABLE, 'key', key), isFirst =>
    isFirst ? effect : Effect.void,
  )

const sortedUnion = (
  a: ReadonlyArray<string>,
  b: ReadonlyArray<string>,
): ReadonlyArray<string> => Array.sort(Array.union(a, b), Order.String)

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

const addCounts = (
  counts: Readonly<Record<string, number>>,
  added: Readonly<Record<string, number>>,
): Record<string, number> =>
  Record.union(
    counts,
    Record.filter(added, count => count > 0),
    (a, b) => a + b,
  )

const stampKey = (stamp: ProofStamp): string =>
  `${stamp.wave}|${stamp.ending}|${stamp.hero}|${Array.join(
    Array.map(stamp.crew, mate => `${mate.name}:${mate.isBot ? 1 : 0}`),
    ',',
  )}`

const isKeptOver = (entry: ProofEntry, kept: ProofEntry): boolean =>
  isEarlierStamp(entry.stamp, kept.stamp) ||
  (!isEarlierStamp(kept.stamp, entry.stamp) &&
    stampKey(entry.stamp) < stampKey(kept.stamp))

const slotOrder = Order.mapInput(
  Order.String,
  (entry: ProofEntry) => `${entry.thing}\u0000${entry.difficulty}`,
)

const shelveFirst = (proof: SavedProof, entry: ProofEntry): SavedProof => {
  const isSameSlot = (kept: ProofEntry) =>
    kept.thing === entry.thing && kept.difficulty === entry.difficulty
  return Option.match(Array.findFirst(proof, isSameSlot), {
    onNone: () => Array.sort(Array.append(proof, entry), slotOrder),
    onSome: kept =>
      isKeptOver(entry, kept)
        ? Array.map(proof, other => (isSameSlot(other) ? entry : other))
        : proof,
  })
}

const mergeShelf = (kept: SavedProof, reached: SavedProof): SavedProof =>
  Array.reduce(reached, kept, shelveFirst)

const sortedJournal = (journal: SavedJournal): SavedJournal => ({
  milestones: Array.sort(journal.milestones, Order.String),
  roomsOpened: Array.sort(journal.roomsOpened, Order.String),
  roomsFoundIn: Array.sort(journal.roomsFoundIn, Order.String),
  heroesPlayed: Array.sort(journal.heroesPlayed, Order.String),
  thingsFound: journal.thingsFound,
})

const unlockedIf = (isOn: boolean): SavedNightmare =>
  isOn ? 'Unlocked' : 'Locked'

const isUnlocked = (a: string, b: string): SavedNightmare =>
  unlockedIf(a === 'Unlocked' || b === 'Unlocked')

const seedFacts = (save: SeedSave) =>
  Effect.all(
    [
      modifyFact(FACTS.bests, bests => ({
        runsPlayed: bests.runsPlayed + save.bests.runsPlayed,
        totalKills: bests.totalKills + save.bests.totalKills,
        killsByKind: addCounts(bests.killsByKind, save.bests.killsByKind),
        byDifficulty: mergeBestsByDifficulty(
          bests.byDifficulty,
          save.bests.byDifficulty,
        ),
      })),
      modifyFact(FACTS.records, records =>
        mergeRunRecords(records, save.records),
      ),
      modifyFact(FACTS.rank, rank => ({
        earnedPoints: rank.earnedPoints + save.rank.earnedPoints,
        earnedBones: rank.earnedBones + save.rank.earnedBones,
        veteranPoints: Math.max(rank.veteranPoints, save.rank.veteranPoints),
        veteranBones: Math.max(rank.veteranBones, save.rank.veteranBones),
        isVeteranGranted: rank.isVeteranGranted || save.rank.isVeteranGranted,
        spentBones: rank.spentBones + save.rank.spentBones,
      })),
      modifyFact(FACTS.bought, bought =>
        sortedUnion(bought, save.boughtCosmetics),
      ),
      modifyFact(FACTS.bonuses, bonuses => ({
        doubledDay: laterDay(bonuses.doubledDay, save.bonuses.doubledDay),
        escapedOn: Array.union(bonuses.escapedOn, save.bonuses.escapedOn),
        purses: Array.sort(
          Array.union(bonuses.purses, save.bonuses.purses),
          Order.Number,
        ),
      })),
      modifyFact(FACTS.unlocks, (unlocks): Unlocks => ({
        nightmare: isUnlocked(unlocks.nightmare, save.difficulty.nightmare),
        recordUnlock: isUnlocked(unlocks.recordUnlock, save.recordUnlock),
      })),
      modifyFact(FACTS.seenUnlocks, seen =>
        sortedUnion(seen, save.seenUnlocks),
      ),
      modifyFact(FACTS.missions, missions =>
        mergeMissions(missions, save.missions),
      ),
      modifyFact(FACTS.proof, proof => mergeShelf(proof, save.proof)),
      modifyFact(FACTS.journal, journal =>
        sortedJournal({
          ...addToJournal(journal, save.journal),
          thingsFound: journal.thingsFound + save.journal.thingsFound,
        }),
      ),
      modifyFact(FACTS.mastery, mastery => addToMastery(mastery, save.mastery)),
      modifyFact(FACTS.dareMarks, marks =>
        mergeDareMarks(marks, save.dareMarks),
      ),
    ],
    { discard: true },
  )

const writeRow = (row: PlayerRowFields) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const json = yield* Schema.encodeEffect(
      Schema.fromJsonString(Schema.toCodecJson(PlayerRowFields)),
    )(row)
    yield* sql`INSERT INTO ${sql(ROW_TABLE)} ${sql.insert({ id: row.id, row: json })}
      ON CONFLICT (id) DO UPDATE SET row = excluded.row`
  })

const RowRow = Schema.Struct({ row: Schema.String })

const readRow = (id: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql`SELECT row FROM ${sql(ROW_TABLE)} WHERE id = ${id}`
    return yield* pipe(
      Array.head(rows),
      Option.flatMap(Schema.decodeUnknownOption(RowRow)),
      Option.match({
        onNone: () => Effect.succeedNone,
        onSome: ({ row }) =>
          Effect.asSome(
            Schema.decodeEffect(
              Schema.fromJsonString(Schema.toCodecJson(PlayerRowFields)),
            )(row),
          ),
      }),
    )
  })

const SetHandlers = EventLog.group(SetEvents, handlers =>
  handlers
    .handle(
      'PlayerRow',
      EventRow.handler(PlayerRow, {
        set: row => Effect.orDie(writeRow(row)),
        patch: (id, fields) =>
          Effect.orDie(
            Effect.flatMap(readRow(id), maybeRow =>
              Option.match(maybeRow, {
                onNone: () => Effect.void,
                onSome: row => writeRow({ ...row, ...fields }),
              }),
            ),
          ),
        remove: id =>
          Effect.orDie(
            Effect.flatMap(
              SqlClient.SqlClient,
              sql => sql`DELETE FROM ${sql(ROW_TABLE)} WHERE id = ${id}`,
            ),
          ),
      }),
    )
    .handle('Seeded', ({ payload }) =>
      Effect.orDie(oncePerKey('seed', seedFacts(payload.save))),
    ),
)

const NONE_ADDED = 0

const EarnedHandlers = EventLog.group(EarnedEvents, handlers =>
  handlers
    .handle('RecordedRun', ({ payload, entry }) =>
      Effect.orDie(
        Effect.andThen(
          oncePerEntry(
            entry,
            modifyFact(FACTS.bests, bests => ({
              ...bests,
              runsPlayed: bests.runsPlayed + Math.max(NONE_ADDED, payload.runs),
              totalKills:
                bests.totalKills + Math.max(NONE_ADDED, payload.totalKills),
              killsByKind: addCounts(bests.killsByKind, payload.kills),
            })),
          ),
          modifyFact(FACTS.bests, bests => ({
            ...bests,
            byDifficulty: mergeBestsByDifficulty(
              bests.byDifficulty,
              payload.bests,
            ),
          })),
        ),
      ),
    )
    .handle('ReachedRecords', ({ payload }) =>
      Effect.orDie(
        modifyFact(FACTS.records, records =>
          mergeRunRecords(records, payload.records),
        ),
      ),
    )
    .handle('EarnedRank', ({ payload, entry }) =>
      Effect.orDie(
        oncePerEntry(
          entry,
          modifyFact(FACTS.rank, rank => ({
            ...rank,
            earnedPoints: rank.earnedPoints + Math.max(0, payload.points),
            earnedBones: rank.earnedBones + Math.max(0, payload.bones),
          })),
        ),
      ),
    )
    .handle('GrantedVeteranRank', ({ payload }) =>
      Effect.orDie(
        modifyFact(FACTS.rank, rank => ({
          ...rank,
          veteranPoints: Math.max(rank.veteranPoints, payload.points),
          veteranBones: Math.max(rank.veteranBones, payload.bones),
          isVeteranGranted: true,
        })),
      ),
    )
    .handle('BoughtCosmetic', ({ payload }) =>
      Effect.orDie(
        Option.match(Record.get(COSMETIC_PRICES, payload.id), {
          onNone: () => Effect.void,
          onSome: price =>
            Effect.flatMap(readFact(FACTS.bought), bought =>
              Array.contains(bought, payload.id)
                ? Effect.void
                : oncePerKey(
                    `bought:${payload.id}`,
                    Effect.andThen(
                      writeFact(
                        FACTS.bought,
                        sortedUnion(bought, [payload.id]),
                      ),
                      modifyFact(FACTS.rank, rank => ({
                        ...rank,
                        spentBones: rank.spentBones + price,
                      })),
                    ),
                  ),
            ),
        }),
      ),
    )
    .handle('DoubledFirstRun', ({ payload }) =>
      Effect.orDie(
        oncePerKey(
          `doubled:${payload.day}`,
          Effect.andThen(
            modifyFact(FACTS.bonuses, bonuses => ({
              ...bonuses,
              doubledDay: laterDay(bonuses.doubledDay, payload.day),
            })),
            modifyFact(FACTS.rank, rank => ({
              ...rank,
              earnedBones: rank.earnedBones + Math.max(0, payload.bones),
            })),
          ),
        ),
      ),
    )
    .handle('EscapedFirst', ({ payload }) =>
      Effect.orDie(
        oncePerKey(
          `escaped:${payload.difficulty}`,
          Effect.andThen(
            modifyFact(FACTS.bonuses, bonuses => ({
              ...bonuses,
              escapedOn: Array.union(bonuses.escapedOn, [payload.difficulty]),
            })),
            modifyFact(FACTS.rank, rank => ({
              ...rank,
              earnedBones: rank.earnedBones + FIRST_ESCAPE_BONES,
            })),
          ),
        ),
      ),
    )
    .handle('PaidRankPurse', ({ payload }) =>
      Effect.orDie(
        Option.match(purseBonesAt(payload.rank), {
          onNone: () => Effect.void,
          onSome: bones =>
            oncePerKey(
              `purse:${payload.rank}`,
              Effect.andThen(
                modifyFact(FACTS.bonuses, bonuses => ({
                  ...bonuses,
                  purses: Array.sort(
                    Array.union(bonuses.purses, [payload.rank]),
                    Order.Number,
                  ),
                })),
                modifyFact(FACTS.rank, rank => ({
                  ...rank,
                  earnedBones: rank.earnedBones + bones,
                })),
              ),
            ),
        }),
      ),
    )
    .handle('UnlockedNightmare', () =>
      Effect.orDie(
        modifyFact(FACTS.unlocks, (unlocks): Unlocks => ({
          ...unlocks,
          nightmare: 'Unlocked',
        })),
      ),
    )
    .handle('UnlockedRecording', () =>
      Effect.orDie(
        modifyFact(FACTS.unlocks, (unlocks): Unlocks => ({
          ...unlocks,
          recordUnlock: 'Unlocked',
        })),
      ),
    )
    .handle('SawUnlocks', ({ payload }) =>
      Effect.orDie(
        modifyFact(FACTS.seenUnlocks, seen =>
          sortedUnion(
            seen,
            Array.filter(payload.ids, id => id !== SEEN_BASELINE),
          ),
        ),
      ),
    )
    .handle('ShelvedProof', ({ payload }) =>
      Effect.orDie(
        modifyFact(FACTS.proof, proof => shelveFirst(proof, payload.entry)),
      ),
    )
    .handle('KeptJournal', ({ payload, entry }) =>
      Effect.orDie(
        oncePerEntry(
          entry,
          modifyFact(FACTS.journal, journal =>
            sortedJournal(
              addToJournal(journal, {
                ...payload.added,
                thingsFound: Math.max(0, payload.added.thingsFound),
              }),
            ),
          ),
        ),
      ),
    )
    .handle('GainedMastery', ({ payload, entry }) =>
      Effect.orDie(
        oncePerEntry(
          entry,
          modifyFact(FACTS.mastery, mastery =>
            addToMastery(mastery, {
              heroes: Record.filter(payload.added.heroes, count => count > 0),
              guns: Record.filter(payload.added.guns, count => count > 0),
            }),
          ),
        ),
      ),
    )
    .handle('ClimbedDareLadder', ({ payload }) =>
      Effect.orDie(
        modifyFact(FACTS.dareMarks, marks =>
          mergeDareMarks(marks, {
            ...noDareMarks,
            [payload.difficulty]: markOf(payload.mark),
          }),
        ),
      ),
    ),
)

const claimOn = (
  missions: SavedMissions,
  day: DayStamp,
  mission: string,
): SavedMissions =>
  missions.day !== null && missions.day > day
    ? missions
    : (current => ({
        ...current,
        claimed: Array.contains(current.claimed, mission)
          ? current.claimed
          : Array.sort(Array.append(current.claimed, mission), Order.String),
      }))(onDay(missions, day))

const MissionHandlers = EventLog.group(MissionEvents, handlers =>
  handlers
    .handle('ProgressedMissions', ({ payload, entry }) =>
      Effect.orDie(
        oncePerEntry(
          entry,
          modifyFact(FACTS.missions, missions => {
            const added = addProgress(missions, payload.day, payload.progress)
            return payload.coop ? { ...added, hasPlayedCoop: true } : added
          }),
        ),
      ),
    )
    .handle('RolledMissions', ({ payload }) =>
      Effect.orDie(
        modifyFact(FACTS.missions, missions =>
          freezeOn(missions, payload.day, payload.rolled),
        ),
      ),
    )
    .handle('RerolledMission', ({ payload }) =>
      Effect.orDie(
        modifyFact(FACTS.missions, missions =>
          rerollOn(missions, payload.day, payload.reroll),
        ),
      ),
    )
    .handle('ClaimedMission', ({ payload }) =>
      Effect.orDie(
        oncePerKey(
          `claim:${payload.day}:${payload.mission}`,
          Effect.andThen(
            modifyFact(FACTS.missions, missions =>
              claimOn(missions, payload.day, payload.mission),
            ),
            modifyFact(FACTS.rank, rank => ({
              ...rank,
              earnedBones: rank.earnedBones + bonesOfMission(payload.mission),
            })),
          ),
        ),
      ),
    )
    .handle('StampedMissionDay', ({ payload }) =>
      Effect.orDie(
        oncePerKey(
          `stamp:${payload.day}`,
          Effect.andThen(
            modifyFact(FACTS.missions, missions => ({
              ...missions,
              stampedDays: Array.sort(
                Array.union(missions.stampedDays, [payload.day]),
                Order.String,
              ),
            })),
            modifyFact(FACTS.rank, rank => ({
              ...rank,
              earnedBones: rank.earnedBones + ALL_THREE_BONES,
            })),
          ),
        ),
      ),
    ),
)

export const PlayerHandlers = Layer.mergeAll(
  SetHandlers,
  EarnedHandlers,
  MissionHandlers,
)

export const readPlayerRow = Effect.orDie(readRow(PLAYER_ROW_KEY))

export const readPlayerSave = Effect.orDie(
  Effect.gen(function* () {
    const maybeRow = yield* readRow(PLAYER_ROW_KEY)
    if (Option.isNone(maybeRow)) {
      return Option.none<PlayerSave>()
    }
    const row = maybeRow.value
    const unlocks = yield* readFact(FACTS.unlocks)
    const save: PlayerSave = {
      version: SAVE_VERSION,
      onboarding: row.onboarding,
      homeScreenTip: row.homeScreenTip,
      settings: {
        sound: row.sound,
        music: row.music,
        shake: row.shake,
        shareStats: row.shareStats,
        cursor: row.cursor,
      },
      appearance: row.appearance,
      difficulty: {
        chosen: row.chosen,
        card: row.card,
        nightmare: unlocks.nightmare,
      },
      bests: yield* readFact(FACTS.bests),
      home: row.home,
      seenPowerUps: row.seenPowerUps,
      rotation: row.rotation,
      rumble: row.rumble,
      name: row.name,
      records: yield* readFact(FACTS.records),
      rank: yield* readFact(FACTS.rank),
      calling: row.calling,
      boughtCosmetics: yield* readFact(FACTS.bought),
      seenUnlocks: yield* readFact(FACTS.seenUnlocks),
      recordRuns: row.recordRuns,
      recordUnlock: unlocks.recordUnlock,
      bonuses: yield* readFact(FACTS.bonuses),
      lastRun: row.lastRun,
      missions: yield* readFact(FACTS.missions),
      proof: yield* readFact(FACTS.proof),
      journal: yield* readFact(FACTS.journal),
      mastery: yield* readFact(FACTS.mastery),
      dareMarks: yield* readFact(FACTS.dareMarks),
    }
    return Option.some(save)
  }),
)

export type PlayerFacts = Readonly<{
  unlocked: boolean
  milestones: ReadonlyArray<string>
  marks: SavedDareMarks
}>

export const readPlayerFacts: Effect.Effect<
  PlayerFacts,
  never,
  SqlClient.SqlClient
> = Effect.orDie(
  Effect.gen(function* () {
    const unlocks = yield* readFact(FACTS.unlocks)
    const journal = yield* readFact(FACTS.journal)
    const marks = yield* readFact(FACTS.dareMarks)
    return {
      unlocked: unlocks.nightmare === 'Unlocked',
      milestones: journal.milestones,
      marks,
    }
  }),
)

export const rowOfSave: {
  (id: string): (save: PlayerSave) => PlayerRowFields
  (save: PlayerSave, id: string): PlayerRowFields
} = Function.dual(2, (save: PlayerSave, id: string): PlayerRowFields => ({
  id,
  sound: save.settings.sound,
  music: save.settings.music,
  shake: save.settings.shake,
  shareStats: save.settings.shareStats,
  cursor: save.settings.cursor,
  rotation: save.rotation,
  rumble: save.rumble,
  recordRuns: save.recordRuns,
  name: save.name,
  calling: save.calling,
  appearance: save.appearance,
  chosen: save.difficulty.chosen,
  card: save.difficulty.card,
  onboarding: save.onboarding,
  homeScreenTip: save.homeScreenTip,
  home: save.home,
  lastRun: save.lastRun,
  seenPowerUps: save.seenPowerUps,
}))
