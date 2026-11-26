import { Array } from 'effect'
import { describe, expect, test } from 'vitest'

import {
  bendWeightOf,
  chandelierSwayAt,
  fernBandOf,
  windClockOf,
  windOffsetAt,
} from '../wind'

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

  test('bends a fern from its pot: higher bands sway more, the pot not at all', () => {
    const plant = { left: 0, top: 0, right: 12, bottom: 16 }
    expect(fernBandOf({ rect: { x: 0, y: 0, width: 1 }, plant })).toBe('0:0')
    expect(fernBandOf({ rect: { x: 5, y: 3, width: 2 }, plant })).toBe('1:1')
    expect(fernBandOf({ rect: { x: 11, y: 12, width: 1 }, plant })).toBe('2:6')
    expect(fernBandOf({ rect: { x: 5, y: 14, width: 2 }, plant })).toBe('pot')

    const weights = Array.map(Array.range(0, 6), band =>
      bendWeightOf({ band: `0:${band}`, top: band * 2, height: 2 }),
    )
    Array.forEach(
      Array.zip(weights, Array.drop(weights, 1)),
      ([upper, lower]) => {
        expect(upper).toBeGreaterThan(lower)
      },
    )
    expect(Array.headNonEmpty(weights)).toBeLessThanOrEqual(1)
    expect(Array.lastNonEmpty(weights)).toBeGreaterThan(0)
    expect(bendWeightOf({ band: '1:0', top: 0, height: 2 })).toBeLessThan(
      Array.headNonEmpty(weights),
    )
    expect(bendWeightOf({ band: 'pot', top: 13, height: 3 })).toBe(0)
  })
})
