import { describe, expect, test } from 'vitest'

import { decodeJson, encodeJson } from '../json'
import {
  type RunResult,
  RunResults,
  type ShopVisit,
  type WaveRun,
  WaveRuns,
} from './bot/results'
import { tallyShopVisits } from './summary'

// NOTE: simulate.ts's workers write their results as JSON and the main
// process decodes them, so a batch split over workers must read exactly as
// one played in a single process.
const encodeRuns = encodeJson(RunResults)
const decodeRuns = decodeJson(RunResults)

const noHurt: RunResult['hurtBy'] = {
  Shambler: 0,
  Runner: 0,
  Tank: 0,
  Exploder: 0,
  Thrower: 0,
  Crawler: 0,
  Boss: 0,
}

const runWith = (
  seed: number,
  shopVisits: ReadonlyArray<ShopVisit>,
): RunResult => ({
  seed,
  cleared: 4,
  victory: false,
  runMs: 240_000,
  moneyAfterWave: [37, 139, 305, 558],
  hurtBy: { ...noHurt, Runner: 3 },
  maxAlive: 12,
  pistolTier: 0,
  spareTier: 1,
  upgradeSpend: 80,
  minHp: 0,
  waves: [],
  shopVisits,
  gnomesPlaced: 1,
  dropped: { Damage: 2 },
  grabbed: {},
  boostedMs: 0,
  waveMs: 200_000,
  timelines: [],
  boss: [],
  newKinds: {
    throws: 0,
    shields: 0,
    throwHits: 0,
    grabs: 0,
    surfaced: 0,
    frenzies: 3,
    wipes: 2,
    wipeBonus: 10,
    heartsWhileClung: 0,
  },
  kitchenWave: 0,
  fridge: {
    pulls: 0,
    firstPullWave: 0,
    prizes: {},
    lids: 0,
    pops: 0,
    swings: 0,
    clangs: 0,
    sprays: 0,
    shatters: 0,
    endedWith: 'None',
    taken: 0,
    stabs: 0,
    stabHits: 0,
    counterBuys: 0,
  },
})

// NOTE: the second run skips the shop before wave 3 and dies with no killer.
const RUNS: ReadonlyArray<RunResult> = [
  {
    ...runWith(1, [
      { wave: 2, money: 37, bought: ['Shotgun'] },
      { wave: 3, money: 104, bought: ['Smg', 'Heart'] },
      { wave: 4, money: 170, bought: ['SmgRounds'] },
    ]),
    killedBy: 'Runner',
  },
  runWith(8, [
    { wave: 2, money: 40, bought: [] },
    { wave: 4, money: 220, bought: ['SmgRounds', 'Barricade'] },
  ]),
]

describe('worker results', () => {
  test('a batch of runs reads back exactly as it was written', () => {
    expect(decodeRuns(encodeRuns(RUNS))).toStrictEqual(RUNS)
  })

  test('a skipped shop visit is not counted after the round trip', () => {
    const decoded = decodeRuns(encodeRuns(RUNS))
    ;[2, 3, 4, 5].forEach(wave => {
      expect(tallyShopVisits(decoded, wave)).toStrictEqual(
        tallyShopVisits(RUNS, wave),
      )
    })
    expect(tallyShopVisits(decoded, 3)).toStrictEqual({
      money: [104],
      visits: 1,
      bought: [
        ['Smg', 1],
        ['Heart', 1],
      ],
    })
  })

  test('a wave run with no killer reads back exactly', () => {
    const runs: ReadonlyArray<WaveRun> = [
      {
        wave: 4,
        snapshotSeed: 1,
        waveSeed: 1_000_004,
        outcome: 'Cleared',
        heartsLost: 1,
        lengthMs: 56_000,
        emptyMs: 2600,
        quietMs: 0,
        longestQuietMs: 0,
        pressureMs: 200,
        peakAlive: 12,
        hurtBy: noHurt,
      },
    ]
    expect(decodeJson(WaveRuns)(encodeJson(WaveRuns)(runs))).toStrictEqual(runs)
  })
})
