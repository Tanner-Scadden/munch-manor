import { Array, Option } from 'effect'

import { describe, expect, test } from '@effect/vitest'

import {
  costOfRank,
  pointsForRank,
  purseBonesAt,
  purseRanksBetween,
  rankOf,
} from '../rankCurve'

// The front-loaded curve and the purses: no save's rank ever drops on the
// new curve, and each rank with no other gift pays a purse.

// NOTE: the curve before it was front-loaded, 100 points from rank 1 to 2
// and 25 more each rank, read the slow way.
const oldRankOf = (points: number): number => {
  const step = (rank: number, spent: number): number => {
    const cost = 100 + 25 * (rank - 1)
    return spent + cost > points ? rank : step(rank + 1, spent + cost)
  }
  return step(1, 0)
}

describe('the rank curve', () => {
  test('rank 10 takes about a third fewer points', () => {
    expect(pointsForRank(10)).toBe(1170)
    expect(pointsForRank(10) / 1800).toBeLessThan(0.7)
  })

  test('no rank costs more than it did', () => {
    Array.forEach(Array.range(1, 80), rank => {
      expect(costOfRank(rank)).toBeLessThanOrEqual(100 + 25 * (rank - 1))
    })
  })

  test('the curve never lowers a rank, at any points', () => {
    const lowered = Array.filter(
      Array.range(0, 60_000),
      points => rankOf(points) < oldRankOf(points),
    )
    expect(lowered).toEqual([])
  })

  test('each rank starts at its points and costs what it says', () => {
    Array.forEach(Array.range(1, 80), rank => {
      expect(rankOf(pointsForRank(rank))).toBe(rank)
      expect(rankOf(pointsForRank(rank) - 1)).toBe(Math.max(1, rank - 1))
      expect(pointsForRank(rank + 1) - pointsForRank(rank)).toBe(
        costOfRank(rank),
      )
    })
  })
})

describe('the purses', () => {
  test('fill the ranks with no other gift, growing to 40', () => {
    expect(purseRanksBetween(1, 30)).toEqual([21, 23, 24, 26, 27, 28, 29])
    expect(purseBonesAt(21)).toEqual(Option.some(15))
    expect(purseBonesAt(39)).toEqual(Option.some(33))
    expect(purseBonesAt(90)).toEqual(Option.some(40))
    expect(purseBonesAt(25)).toEqual(Option.none())
  })
})
