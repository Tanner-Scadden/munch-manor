import { Array, Number, Option } from 'effect'
import { describe, expect, test } from 'vitest'

import { KITCHEN_EXIT, exitKeysOf } from '../../src/world/level/exits'
import { EAST_EXIT, FAR_EXIT, WEST_EXIT } from '../../src/world/level/plan'
import { DIFFICULTY_ORDER } from '../../src/world/run/difficulty'
import {
  ASSUMPTIONS,
  CATALOG,
  type Catalog,
  type FlowRules,
  type Loadout,
  STARTING_LOADOUT,
  balanceModel,
  economy,
  expectedPays,
  flowWave,
  shopVisit,
  withKills,
} from './model'
import { type GunStats, sustainedDps, timeToKill } from './modelGuns'
import {
  PEAK_RATIO_TARGET,
  PEAK_RATIO_WAVES,
  WAVE_LENGTH_TARGETS,
} from './targets'

// HAND-MADE TABLES

const TEN_A_SECOND: GunStats = {
  damage: 1,
  pellets: 1,
  fireIntervalMs: 100,
  magazine: 10,
  reloadMs: 1000,
}

const TOY_CATALOG: Catalog = {
  gunPrice: { Shotgun: 35, Smg: 100 },
  plankPrice: 20,
  plankLimit: 2,
  gnomePrice: 75,
  gnomeLimit: 2,
  kitchenPrice: 60,
}

const PLAIN_RULES: FlowRules = {
  stepMs: 100,
  aliveCap: 20,
  fadeMaxMs: 20000,
  quietHurryMs: 1_000_000,
  relaxQuietMaxMs: 1_000_000,
  trickleMax: 0,
  packWarningMs: 1000,
  bossEntranceMs: 2000,
  bossHoldMs: 5000,
  maxWaveMs: 300_000,
}

describe('the damage math', () => {
  test('sustained damage counts the reload', () => {
    expect(sustainedDps(TEN_A_SECOND, 1)).toBeCloseTo(5)
    expect(sustainedDps(TEN_A_SECOND, 0.5)).toBeCloseTo(2.5)
    expect(sustainedDps({ ...TEN_A_SECOND, pellets: 3 }, 1)).toBeCloseTo(15)
  })

  test('time to kill counts shots and reloads', () => {
    expect(timeToKill(1, TEN_A_SECOND, 1)).toBeCloseTo(0)
    expect(timeToKill(10, TEN_A_SECOND, 1)).toBeCloseTo(0.9)
    expect(timeToKill(12, TEN_A_SECOND, 1)).toBeCloseTo(2.1)
    expect(timeToKill(6, TEN_A_SECOND, 0.5)).toBeCloseTo(2.1)
  })
})

describe('the shop', () => {
  test('a first visit buys the best gun it can afford', () => {
    expect(shopVisit(TOY_CATALOG, 40, STARTING_LOADOUT, 0, 30).bought).toEqual([
      'Shotgun',
    ])
    expect(shopVisit(TOY_CATALOG, 120, STARTING_LOADOUT, 0, 30).bought).toEqual(
      ['Smg', 'Plank'],
    )
    expect(shopVisit(TOY_CATALOG, 20, STARTING_LOADOUT, 0, 30).bought).toEqual(
      [],
    )
  })

  test('a richer visit boards up and buys a gnome over the reserve', () => {
    const armed: Loadout = {
      ...STARTING_LOADOUT,
      maybeSpare: Option.some({ kind: 'Smg', tier: 0, kills: 0 }),
    }
    const visit = shopVisit(TOY_CATALOG, 200, armed, 10, 30)
    expect(visit.bought).toEqual(['Plank', 'Plank', 'Upkeep', 'Gnome'])
    expect(visit.moneyAfter).toBe(200 - 40 - 10 - 75)
    expect(visit.loadout.planks).toBe(2)
  })

  test("a wave's kills level the held gun, not the shop", () => {
    const armed: Loadout = {
      ...STARTING_LOADOUT,
      maybeSpare: Option.some({ kind: 'Smg', tier: 0, kills: 30 }),
    }
    expect(
      Option.map(withKills(armed, 15).maybeSpare, ({ tier }) => tier),
    ).toEqual(Option.some(1))
    expect(withKills(STARTING_LOADOUT, 39).pistolTier).toBe(0)
    expect(withKills(STARTING_LOADOUT, 40).pistolTier).toBe(1)
  })

  test('the money of one wave carries to the next visit', () => {
    const takes = Array.map([40, 0, 0], pay => ({ pay, kills: 0 }))
    const { visits } = economy(TOY_CATALOG, takes, {
      ...ASSUMPTIONS,
      upkeepPerVisit: 0,
    })
    expect(Array.map(visits, ({ bought }) => bought)).toEqual([
      [],
      ['Shotgun'],
      [],
    ])
    expect(
      Option.map(Array.get(visits, 2), ({ moneyOnArrival }) => moneyOnArrival),
    ).toEqual(Option.some(5))
  })
})

describe('the display cases', () => {
  test('a case gives the Chatterbox from its wave, with no keys spent', () => {
    const takes = Array.map([0, 0, 0, 0], pay => ({ pay, kills: 0 }))
    const { visits } = economy(CATALOG, takes, {
      ...ASSUMPTIONS,
      caseGunWave: 3,
    })
    expect(
      Array.map(visits, ({ loadout }) =>
        Option.map(loadout.maybeSpare, ({ kind }) => kind),
      ),
    ).toEqual([
      Option.none(),
      Option.none(),
      Option.some('Smg'),
      Option.some('Smg'),
    ])
  })
})

describe('a wave as a flow of health', () => {
  test('two zombies drain at the damage a second', () => {
    const flow = flowWave(
      [
        { atMs: 0, hp: 10, arrival: 'Pack' },
        { atMs: 0, hp: 10, arrival: 'Pack' },
      ],
      [],
      { _tag: 'Absent' },
      10,
      PLAIN_RULES,
      1000,
    )
    expect(flow.totalHp).toBe(20)
    expect(flow.lengthMs / 1000).toBeCloseTo(2.1, 1)
    expect(flow.peakIncomingHps).toBeCloseTo(20)
    expect(flow.peakAlive).toBe(2)
  })

  test('a hold waits for the room to thin, then rests', () => {
    const flow = flowWave(
      [
        { atMs: 0, hp: 5, arrival: 'Pack' },
        { atMs: 1500, hp: 5, arrival: 'Pack' },
      ],
      [{ atMs: 1000, releaseBelow: 1, relaxMs: 3000 }],
      { _tag: 'Absent' },
      10,
      PLAIN_RULES,
      1000,
    )
    expect(flow.lengthMs / 1000).toBeGreaterThan(4.8)
    expect(flow.lengthMs / 1000).toBeLessThan(5.3)
  })

  test('a quiet room hurries the next pack', () => {
    const waves = (quietHurryMs: number) =>
      flowWave(
        [
          { atMs: 0, hp: 5, arrival: 'Pack' },
          { atMs: 20000, hp: 5, arrival: 'Pack' },
        ],
        [],
        { _tag: 'Absent' },
        10,
        { ...PLAIN_RULES, quietHurryMs },
        1000,
      ).lengthMs / 1000
    expect(waves(1_000_000)).toBeGreaterThan(20)
    expect(waves(1500)).toBeLessThan(5)
  })

  test('the alive cap keeps zombies at the door', () => {
    const flow = flowWave(
      Array.makeBy(3, () => ({ atMs: 0, hp: 10, arrival: 'Pack' })),
      [],
      { _tag: 'Absent' },
      1,
      { ...PLAIN_RULES, aliveCap: 2 },
      1000,
    )
    expect(flow.peakAlive).toBe(2)
    expect(flow.totalHp).toBe(30)
  })

  test('the boss walks in once the spawns run low', () => {
    const flow = flowWave(
      [],
      [],
      { _tag: 'Waiting', waitBelow: 0, hp: 10 },
      10,
      PLAIN_RULES,
      1000,
    )
    expect(flow.totalHp).toBe(10)
    expect(flow.lengthMs / 1000).toBeGreaterThan(2.9)
    expect(flow.lengthMs / 1000).toBeLessThan(3.4)
  })
})

// GUARDRAILS

const MODEL = balanceModel()
const normal = MODEL.Normal
// NOTE: the sawtooth is held on Hard, whose scales are the waves' own feel
// for a sharp player (the AIM=sharp bot). Since 2026-10-31 Easy and Normal
// scale the same waves down for the human bot, whose misses the model's
// hit shares do not count, so their peaks read low against its damage.
const sawtooth = MODEL.Hard
const ratioOf = (wave: number): number =>
  Option.getOrElse(
    Option.map(
      Array.findFirst(sawtooth, row => row.wave === wave),
      ({ peakRatio }) => peakRatio,
    ),
    () => 0,
  )

type Standing = 'Met' | 'NotYet'

// NOTE: a guardrail the game meets today is a test, so a change that breaks
// it fails. One it does not meet yet is a todo that prints today's value,
// so the pacing pass can see how far off it is. Flip NotYet to Met once a
// change brings it in. Since the kitchen made the campaign ten waves long,
// the model has the run holding a full kit from wave 8 on, so the waves
// after it peak low against that kit and the campaign pays a little more
// than the kit costs. The bot, which the waves were tuned on, never gets
// there: these wait on a pass that plays the bot's real loadout.
const guardrail = (
  name: string,
  standing: Standing,
  now: string,
  isMet: () => boolean,
) =>
  standing === 'Met'
    ? test(`${name} (now ${now})`, () => {
        expect(isMet()).toBe(true)
      })
    : test.todo(`${name} (now ${now})`)

const inPeakRange = (ratio: number) =>
  ratio >= PEAK_RATIO_TARGET.min && ratio <= PEAK_RATIO_TARGET.max

// NOTE: waves 5 and 7 were Met until traps became found, not bought
// (docs/ESCAPE_PLAN.md, layer 6), and wave 6 until the shop went (layer 7).
// Since the balance layer (layer 17) the model takes the Chatterbox from a
// display case at the bot's median wave (ASSUMPTIONS.caseGunWave), and all
// three are back in range.
const PEAK_STANDING: Readonly<Record<number, Standing>> = {
  5: 'Met',
  6: 'Met',
  7: 'Met',
  // NOTE: wave 10 was Met until the 2026-11-01 boss change (Hard boss health
  // x2.2, attacks x0.8 apart): the model counts his health as incoming, so the
  // ratio rose past 2.5. Deliberate; the snapshots hold the real fight. In an
  // escape Uncle Chunk comes by the list, not wave 10.
  10: 'NotYet',
}

const sumOf = (values: ReadonlyArray<number>) => Number.sumAll(values)

describe('guardrails from GAME_DESIGN.md', () => {
  Array.forEach(PEAK_RATIO_WAVES, wave =>
    guardrail(
      `wave ${wave} peak incoming hp/s is ${PEAK_RATIO_TARGET.min} to ${PEAK_RATIO_TARGET.max} times the player's dps on Hard`,
      PEAK_STANDING[wave] ?? 'NotYet',
      ratioOf(wave).toFixed(2),
      () => inPeakRange(ratioOf(wave)),
    ),
  )

  guardrail(
    'waves 1 and 2 peak lower than any of the peak waves',
    'Met',
    `${Math.max(ratioOf(1), ratioOf(2)).toFixed(2)} against ${Math.min(...Array.map(PEAK_RATIO_WAVES, ratioOf)).toFixed(2)}`,
    () =>
      Math.max(ratioOf(1), ratioOf(2)) <
      Math.min(...Array.map(PEAK_RATIO_WAVES, ratioOf)),
  )

  guardrail(
    'the second half presses harder than the first on average',
    'Met',
    `${(sumOf(Array.map([1, 2, 3, 4], ratioOf)) / 4).toFixed(2)} then ${(sumOf(Array.map([5, 6, 7, 8], ratioOf)) / 4).toFixed(2)}`,
    () =>
      sumOf(Array.map([1, 2, 3, 4], ratioOf)) <
      sumOf(Array.map([5, 6, 7, 8], ratioOf)),
  )

  const drops = Array.flatMap(sawtooth.slice(1), (row, index) =>
    row.peakRatio + 0.05 < (sawtooth[index]?.peakRatio ?? 0)
      ? [`wave ${row.wave} ${row.peakRatio.toFixed(2)}`]
      : [],
  )
  guardrail(
    'the peak never drops more than 0.05 from one wave to the next',
    'NotYet',
    drops.length === 0 ? 'no drops' : Array.join(drops, ', '),
    () => drops.length === 0,
  )

  Array.forEach(DIFFICULTY_ORDER, difficulty =>
    guardrail(
      `total zombie health never falls from one wave to the next on ${difficulty}`,
      'NotYet',
      Array.join(
        Array.map(MODEL[difficulty], ({ totalHp }) => totalHp.toFixed(0)),
        ', ',
      ),
      () =>
        Array.every(
          MODEL[difficulty],
          (row, index) =>
            index === 0 ||
            row.totalHp >= (MODEL[difficulty][index - 1]?.totalHp ?? 0),
        ),
    ),
  )

  const campaignHp = Array.map(DIFFICULTY_ORDER, difficulty =>
    sumOf(Array.map(MODEL[difficulty], ({ totalHp }) => totalHp)),
  )
  const campaignPressure = Array.map(DIFFICULTY_ORDER, difficulty =>
    sumOf(Array.map(MODEL[difficulty], ({ peakRatio }) => peakRatio)),
  )
  const isRising = (values: ReadonlyArray<number>) =>
    Array.every(
      values,
      (value, index) => index === 0 || value > (values[index - 1] ?? 0),
    )
  const neverFalls = (values: ReadonlyArray<number>) =>
    Array.every(
      values,
      (value, index) => index === 0 || value >= (values[index - 1] ?? 0),
    )
  guardrail(
    'Easy < Normal < Hard < Nightmare in total campaign health',
    'Met',
    Array.join(
      Array.map(campaignHp, hp => hp.toFixed(0)),
      ' < ',
    ),
    () => isRising(campaignHp),
  )
  guardrail(
    'Easy < Normal < Hard < Nightmare in peak pressure over the campaign',
    'Met',
    Array.join(
      Array.map(campaignPressure, ratio => ratio.toFixed(2)),
      ' < ',
    ),
    () => isRising(campaignPressure),
  )
  guardrail(
    'no level is easier than the one below it on any wave',
    'Met',
    'per wave health',
    () =>
      Array.every(normal, (_, index) =>
        neverFalls(
          Array.map(
            DIFFICULTY_ORDER,
            difficulty => MODEL[difficulty][index]?.totalHp ?? 0,
          ),
        ),
      ),
  )

  const longest = Array.reduce(normal, normal[0]!, (most, row) =>
    row.lengthSeconds > most.lengthSeconds ? row : most,
  )
  Array.match(WAVE_LENGTH_TARGETS, {
    onEmpty: () => {
      test.todo(
        `no wave runs longer than its length target, once the pacing pass sets them (now the longest is wave ${longest.wave} at ${longest.lengthSeconds.toFixed(0)} s)`,
      )
    },
    onNonEmpty: targets => {
      Array.forEach(targets, ({ wave, maxSeconds }) => {
        const row = Option.getOrUndefined(
          Array.findFirst(normal, candidate => candidate.wave === wave),
        )
        test(`wave ${wave} runs at most ${maxSeconds} s (now ${row?.lengthSeconds.toFixed(0)} s)`, () => {
          expect(row?.lengthSeconds ?? Infinity).toBeLessThanOrEqual(maxSeconds)
        })
      })
    },
  })

  // NOTE: the money was the shop's; since layer 7 it is keys, spent on the
  // rooms' padlocks and the fridge, and guns come from display cases. The
  // keys of the first four waves cover every room's padlock, so the boards
  // pace the hunt by choice (rooms or the fridge), never wall it.
  const keysByWave4 = sumOf(expectedPays(ASSUMPTIONS, 4))
  const everyRoom = sumOf(
    Array.map([KITCHEN_EXIT, WEST_EXIT, EAST_EXIT, FAR_EXIT], exit =>
      exitKeysOf(exit),
    ),
  )
  guardrail(
    'the keys of waves 1 to 4 cover every room on the house',
    'Met',
    `${keysByWave4.toFixed(0)} keys against ${everyRoom}`,
    () => keysByWave4 >= everyRoom,
  )
  guardrail(
    'a display case gives a gun by the wave 4 break',
    'Met',
    Array.join(
      Array.map(normal.slice(0, 4), row =>
        Option.match(row.loadout.maybeSpare, {
          onNone: () => 'pistol',
          onSome: ({ kind }) => kind,
        }),
      ),
      ', ',
    ),
    () =>
      Array.some(normal.slice(0, 4), row =>
        Option.isSome(row.loadout.maybeSpare),
      ),
  )
})
