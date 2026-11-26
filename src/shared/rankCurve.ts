import { Array, Function, Option } from 'effect'

const OLD_FIRST_COST = 100
const OLD_COST_STEP = 25

const oldCostOf = (rank: number): number =>
  OLD_FIRST_COST + OLD_COST_STEP * (rank - 1)

const EARLY_COSTS: ReadonlyArray<number> = [
  50, 70, 90, 110, 130, 150, 170, 190, 210, 240, 275, 310, 345, 380, 415, 450,
  485, 520,
]

const MERGED_RANK = EARLY_COSTS.length + 1

export const costOfRank = (rank: number): number =>
  Option.getOrElse(Array.get(EARLY_COSTS, rank - 1), () => oldCostOf(rank))

const oldPointsFor = (rank: number): number => {
  const climbed = Math.max(0, rank - 1)
  return (
    OLD_FIRST_COST * climbed + (OLD_COST_STEP * climbed * (climbed - 1)) / 2
  )
}

const SAVED_POINTS =
  oldPointsFor(MERGED_RANK) -
  Array.reduce(EARLY_COSTS, 0, (sum, cost) => sum + cost)

export const pointsForRank = (rank: number): number =>
  rank >= MERGED_RANK
    ? oldPointsFor(rank) - SAVED_POINTS
    : Array.reduce(
        Array.take(EARLY_COSTS, Math.max(0, rank - 1)),
        0,
        (sum, cost) => sum + cost,
      )

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
  return Array.reduce(Array.range(2, MERGED_RANK - 1), 1, (reached, rank) =>
    pointsForRank(rank) <= safe ? rank : reached,
  )
}

const FIRST_PURSE_RANK = 21
const LAST_LOOK_RANK = 40
const LOOK_EVERY = 5
const SMALLEST_PURSE = 15
const BIGGEST_PURSE = 40
const PURSE_RANK_OFFSET = FIRST_PURSE_RANK - SMALLEST_PURSE
const GIFT_GAP_RANK = 22

const isPurseRank = (rank: number): boolean =>
  Number.isInteger(rank) &&
  rank >= FIRST_PURSE_RANK &&
  rank !== GIFT_GAP_RANK &&
  !(rank <= LAST_LOOK_RANK && rank % LOOK_EVERY === 0)

export const purseBonesAt = (rank: number): Option.Option<number> =>
  isPurseRank(rank)
    ? Option.some(
        Math.min(
          BIGGEST_PURSE,
          Math.max(SMALLEST_PURSE, rank - PURSE_RANK_OFFSET),
        ),
      )
    : Option.none()

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
