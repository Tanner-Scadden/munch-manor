import { Array, Option } from 'effect'
import { describe, expect, test } from 'vitest'

import { FIXED_STEP_MS } from '../../shared/constants'
import { OPEN_GATE, gateFrame } from '../frameGate'

// NOTE: the frames a display of `hz` sends over one second, and the time
// each carries.
const sentOver = (hz: number): ReadonlyArray<number> => {
  const deltaMs = 1000 / hz
  const sent: Array<number> = []
  Array.reduce(Array.range(1, hz), OPEN_GATE, gate => {
    const gated = gateFrame(gate, deltaMs)
    Option.map(gated.sendMs, ms => sent.push(ms))
    return gated.gate
  })
  return sent
}

describe('the frame gate', () => {
  test('a 60 Hz screen sends every frame, each a tick', () => {
    const sent = sentOver(60)
    expect(sent).toHaveLength(60)
    Array.forEach(sent, ms => expect(ms).toBeCloseTo(FIXED_STEP_MS))
  })

  test.each([90, 120, 144, 165, 240])(
    'a %i Hz screen sends about 60 frames a second, never more',
    hz => {
      const sent = sentOver(hz)
      expect(sent.length).toBeLessThanOrEqual(61)
      expect(sent.length).toBeGreaterThanOrEqual(58)
    },
  )

  test('a 120 Hz screen sends every other frame with both their time', () => {
    const sent = sentOver(120)
    expect(sent).toHaveLength(60)
    Array.forEach(sent, ms => expect(ms).toBeCloseTo(FIXED_STEP_MS))
  })

  test('no time is lost: what it sends adds up to what it was given', () => {
    const sent = sentOver(90)
    const total = Array.reduce(sent, 0, (sum, ms) => sum + ms)
    expect(total).toBeGreaterThan(1000 - FIXED_STEP_MS)
    expect(total).toBeLessThanOrEqual(1000 + 1e-6)
  })

  test('a 60 Hz frame a little early still goes', () => {
    expect(
      Option.isSome(gateFrame(OPEN_GATE, FIXED_STEP_MS - 0.4).sendMs),
    ).toBe(true)
  })

  test('a long frame after a hidden tab goes at once', () => {
    expect(gateFrame(OPEN_GATE, 4000).sendMs).toStrictEqual(Option.some(4000))
  })
})
