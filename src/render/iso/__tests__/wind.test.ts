import { Array } from 'effect'
import { describe, expect, test } from 'vitest'

import { chandelierSwayAt, windClockOf, windOffsetAt } from '../wind'

// The draft through the manor (src/render/iso/wind.ts): read off the World's
// clock alone, in whole pixels, posed ten times a second.

const TIMES = Array.map(Array.range(0, 400), step => step * 0.05)

describe('the wind', () => {
  test('holds each pose for a tenth of a second', () => {
    expect(windClockOf(1000)).toBe(1)
    expect(windClockOf(1099)).toBe(1)
    expect(windClockOf(1100)).toBeCloseTo(1.1)
  })

  test('moves a clump by small whole pixels, the same at the same time', () => {
    Array.forEach(TIMES, t => {
      const offset = windOffsetAt({ t, spot: { x: 40, y: 60 }, weight: 1 })
      expect(Number.isInteger(offset.x) && Number.isInteger(offset.y)).toBe(
        true,
      )
      expect(Math.abs(offset.x)).toBeLessThanOrEqual(6)
      expect(Math.abs(offset.y)).toBeLessThanOrEqual(3)
      expect(windOffsetAt({ t, spot: { x: 40, y: 60 }, weight: 1 })).toEqual(
        offset,
      )
    })
  })

  test('never moves a pot', () => {
    Array.forEach(TIMES, t => {
      expect(windOffsetAt({ t, spot: { x: 40, y: 60 }, weight: 0 })).toEqual({
        x: 0,
        y: 0,
      })
    })
  })

  test('swings the chandelier a pixel or two', () => {
    Array.forEach(TIMES, t => {
      expect(Math.abs(chandelierSwayAt(t))).toBeLessThanOrEqual(3)
    })
  })
})
