// The in-process determinism check, run by `bun run test:full` and CI: the
// same script played twice in one engine must give the same gameplay hash on
// every frame.
// The second run sees a different Math.random and a clock a day later, so
// an update that reads either diverges here at once. Iteration order of a
// Map or Set built from data that differs run to run, or a Model mutated in
// place, shows up too. The heavy cross-engine check is crossEngine.ts.

import { Array, Option } from 'effect'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { focusOf } from '../../src/world/party/party'
import { firstDifference, firstDivergentCheckpoint } from './diff'
import { gameplayOf, hashedFieldsOf } from './fields'
import { makeGameplayHasher } from './hash'
import { type RunOptions, runScript } from './run'
import { playFrame, startedRun } from './script'

const CAMPAIGN: RunOptions = {
  seed: 7,
  frames: 1800,
  mode: 'Campaign',
  pattern: 'Fixed60',
  every: 1,
  cached: true,
}

const DAY_MS = 24 * 60 * 60 * 1000

// NOTE: a wall clock far from any real one, in May 2030.
const SKEWED_NOW_MS = 1_905_000_000_000

// A second run in a world whose clock and Math.random differ from the first.
const inSkewedWorld = <A>(run: () => A): A => {
  const performanceNow = performance.now()
  const randoms = [0.91, 0.13, 0.57, 0.38, 0.74]
  vi.spyOn(Date, 'now').mockImplementation(() => SKEWED_NOW_MS)
  vi.spyOn(performance, 'now').mockImplementation(() => performanceNow + DAY_MS)
  vi.spyOn(Math, 'random').mockImplementation(() => {
    const next = randoms.shift() ?? 0.5
    randoms.push(next)
    return next
  })
  return run()
}

afterEach(() => {
  vi.restoreAllMocks()
})

const expectSameRuns = (options: RunOptions) => {
  const first = runScript(options)
  const second = inSkewedWorld(() => runScript(options))
  expect(first.frames).toBeGreaterThan(0)
  expect(firstDivergentCheckpoint(first.checkpoints, second.checkpoints)).toBe(
    undefined,
  )
  expect(second.endPhase).toBe(first.endPhase)
}

describe('determinism in one engine', () => {
  test('two campaign runs hash the same on every frame', () => {
    expectSameRuns(CAMPAIGN)
  })

  test('two endless runs with mixed frame lengths hash the same', () => {
    expectSameRuns({
      ...CAMPAIGN,
      seed: 3,
      frames: 900,
      mode: 'Endless',
      pattern: 'Mixed',
    })
  })

  test('the whole Model, client fields too, ends the same', () => {
    const hasher = makeGameplayHasher({ cached: false })
    const play = () =>
      Array.reduce(
        globalThis.Array.from({ length: 600 }, (_, frame) => frame),
        startedRun(11, 'Campaign'),
        (model, frame) => playFrame(model, frame, 'Fixed60'),
      )
    const first = play()
    const second = inSkewedWorld(play)
    expect(firstDifference(gameplayOf(first), gameplayOf(second))).toBe(
      undefined,
    )
    expect(hasher.hashValue(second)).toBe(hasher.hashValue(first))
  })

  test('the cached hash matches a full walk, so update never mutates', () => {
    const cached = makeGameplayHasher({ cached: true })
    const full = makeGameplayHasher({ cached: false })
    const mismatches: Array<number> = []
    Array.reduce(
      globalThis.Array.from({ length: 600 }, (_, frame) => frame),
      startedRun(5, 'Campaign'),
      (model, frame) => {
        const next = playFrame(model, frame, 'Fixed60')
        if (cached.hashModel(next) !== full.hashModel(next)) {
          mismatches.push(frame)
        }
        return next
      },
    )
    expect(mismatches).toEqual([])
  })
})

describe('the gameplay hash', () => {
  const { hashValue, hashModel } = makeGameplayHasher({ cached: false })

  test('ignores the order an object was built in', () => {
    expect(hashValue({ x: 1, y: 2 })).toBe(hashValue({ y: 2, x: 1 }))
    expect(hashValue({ x: 1, gone: undefined })).toBe(hashValue({ x: 1 }))
  })

  test('tells apart values that JSON would merge', () => {
    expect(hashValue(0)).not.toBe(hashValue(-0))
    expect(hashValue(0.1 + 0.2)).not.toBe(hashValue(0.3))
    expect(hashValue(Number.NaN)).toBe(hashValue(0 / 0))
    expect(hashValue([1, 2])).not.toBe(hashValue([2, 1]))
    expect(hashValue('1')).not.toBe(hashValue(1))
    expect(hashValue(Option.some(1))).not.toBe(hashValue(Option.none()))
    expect(hashValue(Option.none())).not.toBe(hashValue({}))
    expect(
      hashValue(
        new Map([
          ['a', 1],
          ['b', 2],
        ]),
      ),
    ).not.toBe(
      hashValue(
        new Map([
          ['b', 2],
          ['a', 1],
        ]),
      ),
    )
  })

  test('changes when one gameplay number moves by one ulp', () => {
    const model = startedRun(1, 'Campaign')
    const nudged = {
      ...model,
      player: {
        ...focusOf(model).player,
        x: focusOf(model).player.x * (1 + Number.EPSILON),
      },
    }
    expect(nudged.player.x).not.toBe(focusOf(model).player.x)
    expect(hashModel(nudged)).not.toBe(hashModel(model))
  })

  test('skips client fields such as the home menu', () => {
    const model = startedRun(1, 'Campaign')
    expect(hashedFieldsOf(model)).not.toContain('home')
    expect(hashedFieldsOf(model)).toContain('zombies')
    expect(hashModel({ ...model, screenMs: model.screenMs + 1 })).toBe(
      hashModel(model),
    )
  })
})
