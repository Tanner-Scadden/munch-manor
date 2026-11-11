import { Option } from 'effect'

import { describe, expect, test } from '@effect/vitest'

import {
  LANDSCAPE_SIZE,
  clientToView,
  portraitHeightFor,
  stagePlacement,
} from '../screen'

const surface = (width: number, height: number, pixelRatio?: number) => ({
  left: 0,
  top: 0,
  width,
  height,
  ...(pixelRatio === undefined ? {} : { pixelRatio }),
})

const devicePixelsPerPixel = (
  width: number,
  height: number,
  pixelRatio: number,
  screen = LANDSCAPE_SIZE,
): number =>
  stagePlacement(surface(width, height, pixelRatio), screen).scale * pixelRatio

describe('the stage on whole device pixels', () => {
  test('a phone gets a whole number of device pixels per screen pixel', () => {
    expect(devicePixelsPerPixel(844, 390, 3)).toBe(6)
    expect(devicePixelsPerPixel(800, 360, 2.625)).toBeCloseTo(5, 9)
    const upright = surface(390, 844, 3)
    const screen = { width: 180, height: portraitHeightFor(upright) }
    expect(stagePlacement(upright, screen).scale * 3).toBe(6)
  })

  test('its edges land on whole device pixels', () => {
    const { left, top } = stagePlacement(surface(360, 800, 2.625), {
      width: 180,
      height: 400,
    })
    expect((left * 2.625) % 1).toBeCloseTo(0, 9)
    expect((top * 2.625) % 1).toBeCloseTo(0, 9)
  })

  test('an exact fit keeps its size', () => {
    expect(stagePlacement(surface(1280, 720, 1), LANDSCAPE_SIZE)).toEqual({
      scale: 4,
      left: 0,
      top: 0,
    })
  })

  test('a big loss keeps the fractional fit', () => {
    expect(stagePlacement(surface(608, 342, 1), LANDSCAPE_SIZE).scale).toBe(1.9)
  })

  test('with no pixel ratio the stage fits as before', () => {
    expect(stagePlacement(surface(844, 390), LANDSCAPE_SIZE).scale).toBe(
      390 / 180,
    )
  })

  test('the pointer maps through the snapped stage', () => {
    const phone = surface(844, 390, 3)
    const { left, top, scale } = stagePlacement(phone, LANDSCAPE_SIZE)
    expect(
      clientToView(phone, { x: left + 100 * scale, y: top + 50 * scale }),
    ).toEqual(Option.some({ x: 100, y: 50 }))
  })
})
