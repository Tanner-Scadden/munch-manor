import { Array, Function, Option, Record, Schema } from 'effect'

import { DayStamp, laterDay } from './dayStamp'

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

export const MissionSize = Schema.Literals(['Small', 'Medium', 'Large'])
export type MissionSize = typeof MissionSize.Type

export const MISSION_SIZES: Array.NonEmptyReadonlyArray<MissionSize> = [
  'Small',
  'Medium',
  'Large',
]

type MissionKind = 'Kills' | 'Dare' | 'House' | 'Crew'

type MissionGate = 'Anyone' | 'PlayedCoop' | 'OwnsHandyman'

export type MissionRule = Readonly<{
  size: MissionSize
  goal: number
  kind: MissionKind
  gate: MissionGate
}>

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

export const CHANDELIER_CRUSH_GOAL = 3

const MISSION_BONES: Readonly<Record<MissionSize, number>> = {
  Small: 10,
  Medium: 15,
  Large: 20,
}

export const ALL_THREE_BONES = 25

const MISSIONS_A_DAY = 3

const maybeMissionId = Schema.decodeUnknownOption(MissionId)

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

export const progressOf: {
  (id: string): (saved: SavedMissions) => number
  (saved: SavedMissions, id: string): number
} = Function.dual(2, (saved: SavedMissions, id: string): number =>
  Option.getOrElse(Record.get(saved.progress, id), () => 0),
)

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

export const mergeMissions: {
  (reached: SavedMissions): (kept: SavedMissions) => SavedMissions
  (kept: SavedMissions, reached: SavedMissions): SavedMissions
} = Function.dual(
  2,
  (kept: SavedMissions, reached: SavedMissions): SavedMissions => {
    const day = laterDay(kept.day, reached.day)
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
