import { Array } from 'effect'
import { describe, expect, test } from 'vitest'

import { UiStruct } from '@effect/ui'

import type { Model } from '../../../app/model'
import { atClock, quietWave } from '../../../test/model.fixture'
import { Phase } from '../../../world/schema/worldSchema'
import { didStrikeBetween, mixColor, moodOf, strikeOf } from '../mood'

const waveAt = (elapsedMs: number, intensity: number): Model =>
  UiStruct.evolve(quietWave(3), {
    phase: () => Phase.Wave({ wave: 3, elapsedMs, spawns: [] }),
    intensity: () => intensity,
  })

describe('the mood', () => {
  test('a wave turns from the calm over its first seconds', () => {
    const start = moodOf(waveAt(0, 0))
    const turned = moodOf(waveAt(10_000, 0))
    expect(start.fill).toBe(1)
    expect(turned.fill).toBeLessThan(start.fill)
    expect(turned.tintShare).toBeGreaterThan(start.tintShare)
  })

  test('a hotter wave is darker and flickers harder', () => {
    const cool = moodOf(waveAt(10_000, 0))
    const hot = moodOf(waveAt(10_000, 1))
    expect(hot.fill).toBeLessThan(cool.fill)
    expect(hot.ambient).toBeLessThan(cool.ambient)
    expect(hot.flicker).toBeGreaterThan(cool.flicker)
  })
})

describe('the lightning', () => {
  const clocks = Array.makeBy(200_000 / 10, index => index * 10)

  test('strikes in a round, a few times a minute, and only then', () => {
    const wave = waveAt(10_000, 0)
    const lit = Array.filter(clocks, ms => strikeOf(atClock(wave, ms)) > 0)
    expect(lit.length).toBeGreaterThan(0)
    const starts = Array.filter(Array.drop(clocks, 1), ms =>
      didStrikeBetween({ world: atClock(wave, ms), previousMs: ms - 10 }),
    )
    expect(starts.length).toBeGreaterThanOrEqual(6)
    expect(starts.length).toBeLessThanOrEqual(10)
    const home = UiStruct.evolve(wave, { phase: () => Phase.Ready() })
    expect(Array.every(clocks, ms => strikeOf(atClock(home, ms)) === 0)).toBe(
      true,
    )
  })

  test('is the same for the same clock', () => {
    const wave = waveAt(10_000, 0)
    expect(Array.map(clocks, ms => strikeOf(atClock(wave, ms)))).toEqual(
      Array.map(clocks, ms => strikeOf(atClock(wave, ms))),
    )
  })
})

test('a color mixes channel by channel', () => {
  expect(mixColor({ from: 0x000000, to: 0xff8040, share: 0.5 })).toBe(0x804020)
  expect(mixColor({ from: 0x123456, to: 0xffffff, share: 0 })).toBe(0x123456)
})
