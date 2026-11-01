import { describe, expect, it } from 'vitest'

import {
  type RunPayInput,
  VETERAN_CAP_POINTS,
  badgeTierOf,
  bonesBalanceOf,
  bonesForPoints,
  costOfRank,
  grantedVeteran,
  noRank,
  pointsForRank,
  pointsForRun,
  rankOf,
  rankProgressOf,
  veteranPointsOf,
} from './rank'

const run = (change: Partial<RunPayInput>): RunPayInput => ({
  difficulty: 'Normal',
  wavesCleared: 0,
  bossesFelled: 0,
  isCampaignWin: false,
  awards: 0,
  revives: 0,
  isGuided: false,
  ...change,
})

describe('points for a run', () => {
  it('pays 60 points and 6 Bones for a Normal death on wave 7', () => {
    const points = pointsForRun(run({ wavesCleared: 6 }))
    expect(points).toBe(60)
    expect(bonesForPoints(points)).toBe(6)
  })

  it('pays 250 points and 25 Bones for a Normal campaign win', () => {
    const points = pointsForRun(
      run({ wavesCleared: 10, bossesFelled: 1, isCampaignWin: true }),
    )
    expect(points).toBe(250)
    expect(bonesForPoints(points)).toBe(25)
  })

  it('multiplies by the difficulty and rounds down', () => {
    const base = { wavesCleared: 6 }
    expect(pointsForRun(run({ ...base, difficulty: 'Easy' }))).toBe(45)
    expect(pointsForRun(run({ ...base, difficulty: 'Hard' }))).toBe(90)
    expect(pointsForRun(run({ ...base, difficulty: 'Nightmare' }))).toBe(120)
    expect(pointsForRun(run({ wavesCleared: 1, difficulty: 'Easy' }))).toBe(7)
  })

  it('adds co-op awards and revives after the multiplier', () => {
    expect(
      pointsForRun(
        run({ wavesCleared: 6, difficulty: 'Hard', awards: 2, revives: 3 }),
      ),
    ).toBe(90 + 20 + 15)
  })

  it('pays a felled boss once, not per kill', () => {
    expect(pointsForRun(run({ bossesFelled: 3 }))).toBe(50)
  })

  it('pays nothing for a guided run', () => {
    expect(
      pointsForRun(run({ wavesCleared: 6, revives: 2, isGuided: true })),
    ).toBe(0)
  })
})

describe('ranks', () => {
  it('starts rank 1 at 0, rank 2 at 100, rank 3 at 225', () => {
    expect(pointsForRank(1)).toBe(0)
    expect(pointsForRank(2)).toBe(100)
    expect(pointsForRank(3)).toBe(225)
    expect(costOfRank(1)).toBe(100)
    expect(costOfRank(2)).toBe(125)
  })

  it('makes rank 10 at 1800 points', () => {
    expect(pointsForRank(10)).toBe(1800)
    expect(rankOf(1799)).toBe(9)
    expect(rankOf(1800)).toBe(10)
  })

  it('reads the rank at and around every boundary, up to rank 200', () => {
    for (let rank = 1; rank <= 200; rank++) {
      expect(rankOf(pointsForRank(rank))).toBe(rank)
      expect(rankOf(pointsForRank(rank + 1) - 1)).toBe(rank)
    }
  })

  it('reads the bar within the rank', () => {
    expect(rankProgressOf(0)).toEqual({
      rank: 1,
      into: 0,
      cost: 100,
      fraction: 0,
    })
    expect(rankProgressOf(162)).toMatchObject({ rank: 2, into: 62, cost: 125 })
    expect(rankProgressOf(162).fraction).toBeCloseTo(0.496)
  })
})

describe('badges', () => {
  it('changes every 10 ranks, ending in the drumstick', () => {
    expect(badgeTierOf(1)).toBe('Wood')
    expect(badgeTierOf(10)).toBe('Wood')
    expect(badgeTierOf(11)).toBe('Tin')
    expect(badgeTierOf(21)).toBe('Bronze')
    expect(badgeTierOf(31)).toBe('Silver')
    expect(badgeTierOf(41)).toBe('Gold')
    expect(badgeTierOf(51)).toBe('Skull')
    expect(badgeTierOf(500)).toBe('Skull')
  })
})

describe('the veteran grant', () => {
  it('is a point per kill, capped at rank 10', () => {
    expect(veteranPointsOf(0)).toBe(0)
    expect(veteranPointsOf(420)).toBe(420)
    expect(veteranPointsOf(99999)).toBe(VETERAN_CAP_POINTS)
    expect(VETERAN_CAP_POINTS).toBe(1800)
  })

  it('grants once, with Bones', () => {
    const granted = grantedVeteran(noRank, 455)
    expect(granted).toMatchObject({
      veteranPoints: 455,
      veteranBones: 45,
      isVeteranGranted: true,
    })
    expect(grantedVeteran(granted, 9000)).toBe(granted)
  })

  it('counts the balance as earned plus granted less spent, never below 0', () => {
    expect(
      bonesBalanceOf({
        ...noRank,
        earnedBones: 5,
        veteranBones: 4,
        spentBones: 3,
      }),
    ).toBe(6)
    expect(bonesBalanceOf({ ...noRank, spentBones: 3 })).toBe(0)
  })
})
