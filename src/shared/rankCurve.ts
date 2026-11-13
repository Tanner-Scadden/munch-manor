import { Array, Function, Option } from 'effect'

// The rank curve and the Bones purses (GAME_DESIGN.md, "Rank and Bones"):
// what each rank costs, and the purse a rank with no other gift pays once.
// Here, apart from src/world/heroes/rank.ts, because the player scope reads
// both when it pays a purse (PaidRankPurse in src/platform/playerScope.ts),
// and the sync Worker runs that file.

// THE CURVE

// NOTE: the curve before it was front-loaded (until 2026-11-13): 100 points
// from rank 1 to 2, then 25 more each rank, rank 10 at 1,800. From rank
// 19 on the curve is this one again.
const OLD_FIRST_COST = 100
const OLD_COST_STEP = 25

const oldCostOf = (rank: number): number =>
  OLD_FIRST_COST + OLD_COST_STEP * (rank - 1)

// NOTE: front-loaded (docs/PROGRESSION_PLAN.md, pillar B): ranks 1 to 9
// cost 50, then 20 more each rank, so rank 10 is at 1,170 points, about a
// third fewer than the old 1,800. Ranks 10 to 18 climb 35 a rank from 240
// until they meet the old curve's costs at rank 19. Every rank costs at
// most what it did, so no save's rank ever drops (the test in
// src/shared/__tests__/rankCurve.test.ts checks every point).
const EARLY_COSTS: ReadonlyArray<number> = [
  50, 70, 90, 110, 130, 150, 170, 190, 210, 240, 275, 310, 345, 380, 415, 450,
  485, 520,
]

// NOTE: the first rank that costs what the old curve did.
const MERGED_RANK = EARLY_COSTS.length + 1

// NOTE: what going from rank `rank` to the next costs.
export const costOfRank = (rank: number): number =>
  Option.getOrElse(Array.get(EARLY_COSTS, rank - 1), () => oldCostOf(rank))

const oldPointsFor = (rank: number): number => {
  const climbed = Math.max(0, rank - 1)
  return (
    OLD_FIRST_COST * climbed + (OLD_COST_STEP * climbed * (climbed - 1)) / 2
  )
}

// NOTE: the points the new curve saves by rank 19 and every rank after.
const SAVED_POINTS =
  oldPointsFor(MERGED_RANK) -
  Array.reduce(EARLY_COSTS, 0, (sum, cost) => sum + cost)

// NOTE: the points that make rank `rank`: rank 1 at 0, rank 2 at 50, rank
// 10 at 1,170. No top rank.
export const pointsForRank = (rank: number): number =>
  rank >= MERGED_RANK
    ? oldPointsFor(rank) - SAVED_POINTS
    : Array.reduce(
        Array.take(EARLY_COSTS, Math.max(0, rank - 1)),
        0,
        (sum, cost) => sum + cost,
      )

// NOTE: the old curve's rank for some points: the quadratic's root, then
// nudged by the exact sums, so a float slip at a boundary never shows.
const oldRankOf = (points: number): number => {
  const guess = Math.max(
    1,
    Math.floor(
      (-62.5 + Math.sqrt(62.5 * 62.5 + 50 * (points + 75))) / OLD_COST_STEP,
    ),
  )
  const high = oldPointsFor(guess + 1) <= points ? guess + 1 : guess
  return oldPointsFor(high) > points ? Math.max(1, high - 1) : high
}

export const rankOf = (points: number): number => {
  const safe = Math.max(0, points)
  if (safe >= pointsForRank(MERGED_RANK)) {
    return oldRankOf(safe + SAVED_POINTS)
  }
  // NOTE: below rank 19 there are only 18 ranks to step through.
  return Array.reduce(Array.range(2, MERGED_RANK - 1), 1, (reached, rank) =>
    pointsForRank(rank) <= safe ? rank : reached,
  )
}

// THE PURSES

// NOTE: a purse fills each rank no gift or hero opens at: rank 21, and from
// rank 23 on every rank, but for 25, 30, 35, and 40, which give a look
// (COSMETIC_GIFT_RANKS in src/shared/playerData.ts). Below 21 every rank
// has a look or a hero already. A purse grows a Bone a rank, 15 at rank 21
// to 40 from rank 46 on.
const FIRST_PURSE_RANK = 21
const LAST_LOOK_RANK = 40
const LOOK_EVERY = 5
const SMALLEST_PURSE = 15
const BIGGEST_PURSE = 40
const PURSE_RANK_OFFSET = FIRST_PURSE_RANK - SMALLEST_PURSE
// NOTE: rank 22 gives the Slime gun skin.
const GIFT_GAP_RANK = 22

const isPurseRank = (rank: number): boolean =>
  Number.isInteger(rank) &&
  rank >= FIRST_PURSE_RANK &&
  rank !== GIFT_GAP_RANK &&
  !(rank <= LAST_LOOK_RANK && rank % LOOK_EVERY === 0)

// NOTE: the Bones a rank's purse holds, none for a rank without one.
export const purseBonesAt = (rank: number): Option.Option<number> =>
  isPurseRank(rank)
    ? Option.some(
        Math.min(
          BIGGEST_PURSE,
          Math.max(SMALLEST_PURSE, rank - PURSE_RANK_OFFSET),
        ),
      )
    : Option.none()

// NOTE: the ranks with a purse from `fromRank` (not counted) up to `toRank`.
export const purseRanksBetween: {
  (toRank: number): (fromRank: number) => ReadonlyArray<number>
  (fromRank: number, toRank: number): ReadonlyArray<number>
} = Function.dual(
  2,
  (fromRank: number, toRank: number): ReadonlyArray<number> => {
    const first = Math.max(FIRST_PURSE_RANK, fromRank + 1)
    return first > toRank
      ? []
      : Array.filter(Array.range(first, toRank), isPurseRank)
  },
)
