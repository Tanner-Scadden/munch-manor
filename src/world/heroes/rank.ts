import { Array, Function } from 'effect'

import {
  type Difficulty,
  FIRST_ESCAPE_BONES,
  type SavedRank,
} from '#shared/playerData.ts'
import { costOfRank, pointsForRank, rankOf } from '#shared/rankCurve.ts'

const POINTS_PER_WAVE = 10
const POINTS_PER_DARE_ITEM = 25
const BOSS_POINTS = 50
const ESCAPE_POINTS = 100
const AWARD_POINTS = 10
const REVIVE_POINTS = 5
const POINTS_PER_BONE = 10

const READY_MS_PER_POINT = 5000

export const readyPointsFor = (remainingMs: number): number =>
  Math.max(0, Math.floor(remainingMs / READY_MS_PER_POINT))

type Fraction = Readonly<{ top: number; bottom: number }>

const MULTIPLIERS: Readonly<Record<Difficulty, Fraction>> = {
  Easy: { top: 3, bottom: 4 },
  Normal: { top: 1, bottom: 1 },
  Hard: { top: 3, bottom: 2 },
  Nightmare: { top: 2, bottom: 1 },
}

export type RunPayInput = Readonly<{
  difficulty: Difficulty
  wavesCleared: number
  bossesFelled: number
  readyPoints: number
  dareItems: number
  isEscape: boolean
  awards: number
  revives: number
  bonusPercent: number
  isGuided: boolean
}>

export const pointsForRun = (input: RunPayInput): number => {
  if (input.isGuided) {
    return 0
  }
  const multiplier = MULTIPLIERS[input.difficulty]
  const base =
    Math.max(0, input.wavesCleared) * POINTS_PER_WAVE +
    Math.max(0, input.readyPoints) +
    Math.max(0, input.dareItems) * POINTS_PER_DARE_ITEM +
    (input.bossesFelled > 0 ? BOSS_POINTS : 0) +
    (input.isEscape ? ESCAPE_POINTS : 0)
  const total =
    Math.floor((base * multiplier.top) / multiplier.bottom) +
    Math.max(0, input.awards) * AWARD_POINTS +
    Math.max(0, input.revives) * REVIVE_POINTS
  return Math.floor((total * (100 + Math.max(0, input.bonusPercent))) / 100)
}

export const bonesForPoints = (points: number): number =>
  Math.floor(Math.max(0, points) / POINTS_PER_BONE)

const BONES_FLOOR = 3

export const BONE_BONUSES = ['Floor', 'Double', 'FirstEscape'] as const
export type BoneBonus = (typeof BONE_BONUSES)[number]

export type RunBonesInput = Readonly<{
  points: number
  isEnded: boolean
  isGuided: boolean
  isFirstOfDay: boolean
  isFirstEscape: boolean
}>

export type RunBones = Readonly<{
  bones: number
  bonuses: ReadonlyArray<BoneBonus>
}>

export const bonesForRun = (input: RunBonesInput): RunBones => {
  if (input.isGuided) {
    return { bones: 0, bonuses: [] }
  }
  const earned = bonesForPoints(input.points)
  const isPaid = input.isEnded && input.points > 0
  const isFloored = isPaid && earned < BONES_FLOOR
  const isDoubled = isPaid && input.isFirstOfDay
  const isFirstEscape = input.isEnded && input.isFirstEscape
  const base = isFloored ? BONES_FLOOR : earned
  return {
    bones:
      base * (isDoubled ? 2 : 1) + (isFirstEscape ? FIRST_ESCAPE_BONES : 0),
    bonuses: Array.filter(
      BONE_BONUSES,
      bonus =>
        ({ Floor: isFloored, Double: isDoubled, FirstEscape: isFirstEscape })[
          bonus
        ],
    ),
  }
}

export { costOfRank, pointsForRank, rankOf }

export type RankProgress = Readonly<{
  rank: number
  into: number
  cost: number
  fraction: number
}>

export const rankProgressOf = (points: number): RankProgress => {
  const rank = rankOf(points)
  const into = Math.max(0, points) - pointsForRank(rank)
  const cost = costOfRank(rank)
  return { rank, into, cost, fraction: Math.min(1, into / cost) }
}

export const shownPointsOf: {
  (gained: number, t: number): (pointsBefore: number) => number
  (pointsBefore: number, gained: number, t: number): number
} = Function.dual(
  3,
  (pointsBefore: number, gained: number, t: number): number =>
    pointsBefore + Math.round(gained * Math.min(1, Math.max(0, t))),
)

export const isRankUp: {
  (gained: number): (pointsBefore: number) => boolean
  (pointsBefore: number, gained: number): boolean
} = Function.dual(
  2,
  (pointsBefore: number, gained: number): boolean =>
    rankOf(pointsBefore + gained) > rankOf(pointsBefore),
)

export type BadgeTier = 'Wood' | 'Tin' | 'Bronze' | 'Silver' | 'Gold' | 'Skull'

const BADGE_TIERS: ReadonlyArray<BadgeTier> = [
  'Wood',
  'Tin',
  'Bronze',
  'Silver',
  'Gold',
  'Skull',
]

const RANKS_PER_TIER = 10

export const badgeTierOf = (rank: number): BadgeTier =>
  BADGE_TIERS[
    Math.min(
      BADGE_TIERS.length - 1,
      Math.max(0, Math.floor((rank - 1) / RANKS_PER_TIER)),
    )
  ] ?? 'Wood'

export const VETERAN_CAP_POINTS = pointsForRank(10)

export const veteranPointsOf = (totalKills: number): number =>
  Math.min(VETERAN_CAP_POINTS, Math.max(0, Math.floor(totalKills)))

export type RankTotals = SavedRank

export const noRank: RankTotals = {
  earnedPoints: 0,
  earnedBones: 0,
  veteranPoints: 0,
  veteranBones: 0,
  isVeteranGranted: false,
  spentBones: 0,
}

export const totalPointsOf = (rank: RankTotals): number =>
  rank.earnedPoints + rank.veteranPoints

export const bonesBalanceOf = (rank: RankTotals): number =>
  Math.max(0, rank.earnedBones + rank.veteranBones - rank.spentBones)

export const grantedVeteran: {
  (totalKills: number): (rank: RankTotals) => RankTotals
  (rank: RankTotals, totalKills: number): RankTotals
} = Function.dual(2, (rank: RankTotals, totalKills: number): RankTotals => {
  if (rank.isVeteranGranted) {
    return rank
  }
  const points = veteranPointsOf(totalKills)
  return {
    ...rank,
    veteranPoints: points,
    veteranBones: bonesForPoints(points),
    isVeteranGranted: true,
  }
})
