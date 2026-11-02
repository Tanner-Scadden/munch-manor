import type { Difficulty, SavedRank } from './playerData'

// Rank and Bones (GAME_DESIGN.md, "Rank and Bones"): the pure rules. A
// finished run pays rank points; points make a rank; a tenth of a run's
// points are Bones, a currency kept for good. Nothing here reads the Model:
// src/rankRun.ts reads a run into a `RunPayInput`, and the save keeps what
// was earned (src/playerData.ts, SavedRank).

// POINTS FOR A RUN

const POINTS_PER_WAVE = 10
const BOSS_POINTS = 50
const WIN_POINTS = 100
const AWARD_POINTS = 10
const REVIVE_POINTS = 5
const POINTS_PER_BONE = 10

// NOTE: the difficulty's multiplier as a fraction, so the rounding down is
// exact integer math: Easy 3/4, Normal 1, Hard 3/2, Nightmare 2.
type Fraction = Readonly<{ top: number; bottom: number }>

const MULTIPLIERS: Readonly<Record<Difficulty, Fraction>> = {
  Easy: { top: 3, bottom: 4 },
  Normal: { top: 1, bottom: 1 },
  Hard: { top: 3, bottom: 2 },
  Nightmare: { top: 2, bottom: 1 },
}

// NOTE: what one finished run pays for. `wavesCleared` and `bossesFelled`
// are only the ones not paid yet, so a campaign win that keeps going into
// endless pays the waves it clears after that, never the campaign twice.
// `awards` and `revives` are the player's own seat in co-op, 0 alone.
// A guided run (the player never got past the practice gate) pays nothing.
export type RunPayInput = Readonly<{
  difficulty: Difficulty
  wavesCleared: number
  bossesFelled: number
  isCampaignWin: boolean
  awards: number
  revives: number
  isGuided: boolean
}>

export const pointsForRun = (input: RunPayInput): number => {
  if (input.isGuided) {
    return 0
  }
  const multiplier = MULTIPLIERS[input.difficulty]
  const base =
    Math.max(0, input.wavesCleared) * POINTS_PER_WAVE +
    (input.bossesFelled > 0 ? BOSS_POINTS : 0) +
    (input.isCampaignWin ? WIN_POINTS : 0)
  return (
    Math.floor((base * multiplier.top) / multiplier.bottom) +
    Math.max(0, input.awards) * AWARD_POINTS +
    Math.max(0, input.revives) * REVIVE_POINTS
  )
}

export const bonesForPoints = (points: number): number =>
  Math.floor(Math.max(0, points) / POINTS_PER_BONE)

// RANKS

const FIRST_RANK_COST = 100
const RANK_COST_STEP = 25

// NOTE: what going from rank `rank` to the next costs: 100, then 25 more
// each rank.
export const costOfRank = (rank: number): number =>
  FIRST_RANK_COST + RANK_COST_STEP * (rank - 1)

// NOTE: the points that make rank `rank`: rank 1 at 0, rank 2 at 100,
// rank 3 at 225, rank 10 at 1800. No top rank.
export const pointsForRank = (rank: number): number => {
  const climbed = Math.max(0, rank - 1)
  return (
    FIRST_RANK_COST * climbed + (RANK_COST_STEP * climbed * (climbed - 1)) / 2
  )
}

export const rankOf = (points: number): number => {
  const safe = Math.max(0, points)
  // NOTE: the quadratic's root, then nudged by the exact sums, so a float
  // slip at a boundary never shows.
  const guess = Math.max(
    1,
    Math.floor(
      (-62.5 + Math.sqrt(62.5 * 62.5 + 50 * (safe + 75))) / RANK_COST_STEP,
    ),
  )
  const high = pointsForRank(guess + 1) <= safe ? guess + 1 : guess
  return pointsForRank(high) > safe ? Math.max(1, high - 1) : high
}

export type RankProgress = Readonly<{
  rank: number
  // NOTE: points earned into this rank, and what the rank costs.
  into: number
  cost: number
  // NOTE: 0 to 1, for the bar.
  fraction: number
}>

export const rankProgressOf = (points: number): RankProgress => {
  const rank = rankOf(points)
  const into = Math.max(0, points) - pointsForRank(rank)
  const cost = costOfRank(rank)
  return { rank, into, cost, fraction: Math.min(1, into / cost) }
}

// THE STRIP

// NOTE: the end card's rank strip reads everything from the points it is
// showing, so a bar that fills past a rank's end turns into the next rank's
// bar, and the number and the badge change as it goes.
export const shownPointsOf = (
  pointsBefore: number,
  gained: number,
  t: number,
): number => pointsBefore + Math.round(gained * Math.min(1, Math.max(0, t)))

export const isRankUp = (pointsBefore: number, gained: number): boolean =>
  rankOf(pointsBefore + gained) > rankOf(pointsBefore)

// BADGES

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

// NOTE: the badge changes look every 10 ranks: wood for 1 to 10, tin for 11
// to 20, and so on to gold at 41 to 50, then the skull crest for good.
export const badgeTierOf = (rank: number): BadgeTier =>
  BADGE_TIERS[
    Math.min(
      BADGE_TIERS.length - 1,
      Math.max(0, Math.floor((rank - 1) / RANKS_PER_TIER)),
    )
  ] ?? 'Wood'

// THE VETERAN GRANT

// NOTE: a player who played before rank existed starts with a point for
// each kill the save holds, capped at rank 10's points, so a veteran meets
// a few callings and gifts but not all of them.
export const VETERAN_CAP_POINTS = pointsForRank(10)

export const veteranPointsOf = (totalKills: number): number =>
  Math.min(VETERAN_CAP_POINTS, Math.max(0, Math.floor(totalKills)))

// PROGRESS

// NOTE: what the save keeps of rank (SavedRank in src/playerData.ts):
// earned points and Bones only ever add (two linked devices both count); the
// veteran grant is merged as the larger and happens once; spent Bones are
// for the closet (not built yet).
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

export const grantedVeteran = (
  rank: RankTotals,
  totalKills: number,
): RankTotals => {
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
}
