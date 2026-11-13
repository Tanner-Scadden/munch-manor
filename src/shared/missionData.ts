import { Array, Function, Option, Record, Schema } from 'effect'

import { DayStamp } from './dayStamp'

// Daily missions' data (docs/PROGRESSION_PLAN.md, pillar C): the pool's ids,
// each mission's size, goal, and kind, the Bones they pay, and the saved
// record of a player's day. The player scope (src/platform/playerScope.ts)
// applies the same rules here as the client does, so a sync Worker and a
// device agree on what a claim pays. Names a player reads are in
// src/world/names.ts (MISSION_NAMES); rolling and counting are the client's
// (src/features/missions/).

// THE POOL

// NOTE: every mission any day can roll. The list only grows at its end: a
// saved progress names an id, and a device that does not know an id keeps
// it untouched. Leaving early (pillar A, build order step 4) joined last,
// a Medium: out the kitchen's back door once (src/world/kitchen/backDoor.ts).
export const MissionId = Schema.Literals([
  'HotfootKills',
  'PullFridge',
  'RunWithBot',
  'PlayHandyman',
  'ReviveFriend',
  'FindDareThings',
  'OpenCellar',
  'WorkRoomTools',
  'OpenCase',
  'ChandelierCrush',
  'BarnBusterKills',
  'GunToDeluxe',
  'EscapeDoubleDare',
  'SplatZombies',
  'LeaveEarly',
])
export type MissionId = typeof MissionId.Type

// NOTE: a mission's size sets its Bones, and each day rolls one of each.
export const MissionSize = Schema.Literals(['Small', 'Medium', 'Large'])
export type MissionSize = typeof MissionSize.Type

export const MISSION_SIZES: Array.NonEmptyReadonlyArray<MissionSize> = [
  'Small',
  'Medium',
  'Large',
]

// NOTE: the owner's four kinds (docs/PROGRESSION_PLAN.md, "Settled in Q&A"
// 3), for the card's icon frame.
type MissionKind = 'Kills' | 'Dare' | 'House' | 'Crew'

// NOTE: who can roll a mission: everyone, a player who has played an
// online co-op run, or one who owns the Handyman.
type MissionGate = 'Anyone' | 'PlayedCoop' | 'OwnsHandyman'

export type MissionRule = Readonly<{
  size: MissionSize
  goal: number
  kind: MissionKind
  gate: MissionGate
}>

// NOTE: goals sized so each is doable in one to three runs: a Small in
// one, a Medium in one or two, a Large in two or three.
export const MISSION_RULES: Readonly<Record<MissionId, MissionRule>> = {
  HotfootKills: { size: 'Small', goal: 15, kind: 'Kills', gate: 'Anyone' },
  PullFridge: { size: 'Small', goal: 1, kind: 'House', gate: 'Anyone' },
  RunWithBot: { size: 'Small', goal: 1, kind: 'Crew', gate: 'Anyone' },
  PlayHandyman: {
    size: 'Small',
    goal: 1,
    kind: 'Crew',
    gate: 'OwnsHandyman',
  },
  ReviveFriend: { size: 'Small', goal: 1, kind: 'Crew', gate: 'PlayedCoop' },
  FindDareThings: { size: 'Medium', goal: 2, kind: 'Dare', gate: 'Anyone' },
  OpenCellar: { size: 'Medium', goal: 1, kind: 'Dare', gate: 'Anyone' },
  WorkRoomTools: { size: 'Medium', goal: 3, kind: 'House', gate: 'Anyone' },
  OpenCase: { size: 'Medium', goal: 1, kind: 'House', gate: 'Anyone' },
  ChandelierCrush: { size: 'Medium', goal: 1, kind: 'House', gate: 'Anyone' },
  BarnBusterKills: { size: 'Large', goal: 40, kind: 'Kills', gate: 'Anyone' },
  GunToDeluxe: { size: 'Large', goal: 1, kind: 'Kills', gate: 'Anyone' },
  EscapeDoubleDare: { size: 'Large', goal: 1, kind: 'Dare', gate: 'Anyone' },
  SplatZombies: { size: 'Large', goal: 150, kind: 'Kills', gate: 'Anyone' },
  LeaveEarly: { size: 'Medium', goal: 1, kind: 'Dare', gate: 'Anyone' },
}

// NOTE: how many zombies one chandelier drop must crush for ChandelierCrush.
export const CHANDELIER_CRUSH_GOAL = 3

const MISSION_BONES: Readonly<Record<MissionSize, number>> = {
  Small: 10,
  Medium: 15,
  Large: 20,
}

// NOTE: all three of a day's missions done pays this once, and stamps the
// day for the Proof Shelf (pillar B).
export const ALL_THREE_BONES = 25

const MISSIONS_A_DAY = 3

const maybeMissionId = Schema.decodeUnknownOption(MissionId)

// NOTE: a saved id this build knows, so a newer device's mission is kept
// and never read.
export const knownMissionOf = (id: string): Option.Option<MissionId> =>
  maybeMissionId(id)

export const bonesOfMission = (id: string): number =>
  Option.match(knownMissionOf(id), {
    onNone: () => 0,
    onSome: mission => MISSION_BONES[MISSION_RULES[mission].size],
  })

const goalOfId = (id: string): number =>
  Option.match(knownMissionOf(id), {
    onNone: () => 0,
    onSome: mission => MISSION_RULES[mission].goal,
  })

// SAVED

// NOTE: save version 23 added a player's daily missions: the day the
// progress is for, the day's three as first rolled (frozen, so a gate the
// player passes later that day changes nothing until tomorrow), each
// mission's count toward its goal and the claimed ones that day, the slot
// rerolled that day and what it became, every day
// all three were done (kept for the Proof Shelf), and whether the player has
// played an online co-op run. Ids are strings, so a device that does not
// know one keeps it. No streak: a missed day costs nothing.
export const MissionReroll = Schema.Struct({
  slot: Schema.Finite,
  mission: Schema.String,
})
export type MissionReroll = typeof MissionReroll.Type

export const SavedMissions = Schema.Struct({
  day: Schema.NullOr(DayStamp),
  rolled: Schema.Array(Schema.String),
  progress: Schema.Record(Schema.String, Schema.Finite),
  claimed: Schema.Array(Schema.String),
  reroll: Schema.NullOr(MissionReroll),
  stampedDays: Schema.Array(DayStamp),
  hasPlayedCoop: Schema.Boolean,
})
export type SavedMissions = typeof SavedMissions.Type

export const noMissions: SavedMissions = {
  day: null,
  rolled: [],
  progress: {},
  claimed: [],
  reroll: null,
  stampedDays: [],
  hasPlayedCoop: false,
}

// NOTE: the record as of `day`: a later day starts its progress, claims,
// and reroll afresh; the same day is kept. An earlier day is never asked
// for (onDay is only called with a day at least the saved one).
export const onDay: {
  (day: DayStamp): (saved: SavedMissions) => SavedMissions
  (saved: SavedMissions, day: DayStamp): SavedMissions
} = Function.dual(2, (saved: SavedMissions, day: DayStamp): SavedMissions =>
  saved.day === day
    ? saved
    : { ...saved, day, rolled: [], progress: {}, claimed: [], reroll: null },
)

const isStale = (saved: SavedMissions, day: DayStamp): boolean =>
  saved.day !== null && saved.day > day

// NOTE: counts added toward `day`'s missions, each capped at its goal. A
// count for a day older than the saved one is too late and adds nothing.
export const addProgress: {
  (
    day: DayStamp,
    added: Readonly<Record<string, number>>,
  ): (saved: SavedMissions) => SavedMissions
  (
    saved: SavedMissions,
    day: DayStamp,
    added: Readonly<Record<string, number>>,
  ): SavedMissions
} = Function.dual(
  3,
  (
    saved: SavedMissions,
    day: DayStamp,
    added: Readonly<Record<string, number>>,
  ): SavedMissions => {
    if (isStale(saved, day)) {
      return saved
    }
    const current = onDay(saved, day)
    const progress = Array.reduce(
      Record.toEntries(added),
      current.progress,
      (counts, [id, count]) => ({
        ...counts,
        [id]: Math.min(
          goalOfId(id),
          Option.getOrElse(Record.get(counts, id), () => 0) +
            Math.max(0, count),
        ),
      }),
    )
    return { ...current, progress }
  },
)

// NOTE: a mission's count toward its goal in the record, 0 untouched.
export const progressOf: {
  (id: string): (saved: SavedMissions) => number
  (saved: SavedMissions, id: string): number
} = Function.dual(2, (saved: SavedMissions, id: string): number =>
  Option.getOrElse(Record.get(saved.progress, id), () => 0),
)

// NOTE: a mission claimed on `day`, once its goal is met and only once:
// Some with the record that holds the claim, None when it pays nothing.
export const claimMission: {
  (
    day: DayStamp,
    id: string,
  ): (saved: SavedMissions) => Option.Option<SavedMissions>
  (
    saved: SavedMissions,
    day: DayStamp,
    id: string,
  ): Option.Option<SavedMissions>
} = Function.dual(
  3,
  (
    saved: SavedMissions,
    day: DayStamp,
    id: string,
  ): Option.Option<SavedMissions> =>
    saved.day !== day ||
    Array.contains(saved.claimed, id) ||
    goalOfId(id) === 0 ||
    progressOf(saved, id) < goalOfId(id)
      ? Option.none()
      : Option.some({ ...saved, claimed: Array.append(saved.claimed, id) }),
)

// NOTE: `day` stamped once all three are claimed: Some with the stamp, None
// when it is not due or already stamped.
export const stampDay: {
  (day: DayStamp): (saved: SavedMissions) => Option.Option<SavedMissions>
  (saved: SavedMissions, day: DayStamp): Option.Option<SavedMissions>
} = Function.dual(
  2,
  (saved: SavedMissions, day: DayStamp): Option.Option<SavedMissions> =>
    saved.day !== day ||
    saved.claimed.length < MISSIONS_A_DAY ||
    Array.contains(saved.stampedDays, day)
      ? Option.none()
      : Option.some({
          ...saved,
          stampedDays: Array.append(saved.stampedDays, day),
        }),
)

// NOTE: the day's one reroll, kept as the first device made it.
export const rerollOn: {
  (
    day: DayStamp,
    reroll: MissionReroll,
  ): (saved: SavedMissions) => SavedMissions
  (saved: SavedMissions, day: DayStamp, reroll: MissionReroll): SavedMissions
} = Function.dual(
  3,
  (
    saved: SavedMissions,
    day: DayStamp,
    reroll: MissionReroll,
  ): SavedMissions => {
    if (isStale(saved, day)) {
      return saved
    }
    const current = onDay(saved, day)
    return current.reroll === null ? { ...current, reroll } : current
  },
)

// NOTE: the day's three as first rolled, kept as the first device froze
// them.
export const freezeOn: {
  (
    day: DayStamp,
    rolled: ReadonlyArray<string>,
  ): (saved: SavedMissions) => SavedMissions
  (
    saved: SavedMissions,
    day: DayStamp,
    rolled: ReadonlyArray<string>,
  ): SavedMissions
} = Function.dual(
  3,
  (
    saved: SavedMissions,
    day: DayStamp,
    rolled: ReadonlyArray<string>,
  ): SavedMissions => {
    if (isStale(saved, day)) {
      return saved
    }
    const current = onDay(saved, day)
    return Array.isReadonlyArrayEmpty(current.rolled)
      ? { ...current, rolled }
      : current
  },
)

const later = (a: DayStamp | null, b: DayStamp | null): DayStamp | null =>
  a === null ? b : b === null ? a : a >= b ? a : b

// NOTE: two records of the same player merged (a synced save over the
// Model's): the later day's, the three as the reached record froze them
// (the store's, where the first device's stands) or else as kept, the
// larger count of each, the claims and stamps of both, the first reroll,
// and co-op once played.
export const mergeMissions: {
  (reached: SavedMissions): (kept: SavedMissions) => SavedMissions
  (kept: SavedMissions, reached: SavedMissions): SavedMissions
} = Function.dual(
  2,
  (kept: SavedMissions, reached: SavedMissions): SavedMissions => {
    const day = later(kept.day, reached.day)
    const sameDay = (saved: SavedMissions): SavedMissions =>
      saved.day === day ? saved : { ...noMissions, day }
    const a = sameDay(kept)
    const b = sameDay(reached)
    return {
      day,
      rolled: Array.isReadonlyArrayNonEmpty(b.rolled) ? b.rolled : a.rolled,
      progress: Record.union(a.progress, b.progress, Math.max),
      claimed: Array.union(a.claimed, b.claimed),
      reroll: a.reroll ?? b.reroll,
      stampedDays: Array.union(kept.stampedDays, reached.stampedDays),
      hasPlayedCoop: kept.hasPlayedCoop || reached.hasPlayedCoop,
    }
  },
)
