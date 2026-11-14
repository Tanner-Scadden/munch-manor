import { Array, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, test } from '@effect/vitest'

import type { Model } from '../../app/model'
import { initialModel } from '../../app/pureApp'
import type { SurfaceRectangle } from '../../input/inputSchema'
import { screenOf, stagePlacement } from '../screen'

// Every game pixel the same whole number of device pixels (src/render/
// screen.ts): the stage is snapped to whole device pixels per screen pixel,
// and the world's zoom to whole device pixels per game pixel over it.

type Phone = Readonly<{
  name: string
  surface: SurfaceRectangle
  orientation: 'Portrait' | 'Landscape'
}>

const phone = (
  name: string,
  [width, height, pixelRatio]: readonly [number, number, number],
): Phone => ({
  name,
  surface: { left: 0, top: 0, width, height, pixelRatio },
  orientation: height > width ? 'Portrait' : 'Landscape',
})

const PHONES: ReadonlyArray<Phone> = [
  phone('iPhone 14 upright', [390, 844, 3]),
  phone('iPhone 14 on its side', [844, 390, 3]),
  phone('iPhone SE upright', [375, 667, 2]),
  phone('iPhone SE on its side', [667, 375, 2]),
  phone('Pixel upright', [360, 800, 2.625]),
  phone('Pixel on its side', [800, 360, 2.625]),
  phone('Pro Max upright', [430, 932, 3]),
]

const onTouch = ({ surface, orientation }: Phone): Model =>
  modifyFields(initialModel, {
    lastDevice: () => 'Touch',
    orientation: () => orientation,
    maybeSurface: () => Option.some(surface),
  })

const devicePixelsPerGamePixel = (model: Model, surface: SurfaceRectangle) => {
  const screen = screenOf(model)
  return (
    stagePlacement(surface, screen).scale *
    (surface.pixelRatio ?? 1) *
    screen.zoom
  )
}

describe('every game pixel on whole device pixels', () => {
  test('on every phone, either way up', () => {
    Array.forEach(PHONES, current => {
      const size = devicePixelsPerGamePixel(onTouch(current), current.surface)
      expect([current.name, size - Math.round(size)]).toEqual([
        current.name,
        expect.closeTo(0, 9),
      ])
    })
  })

  test('keeps a zoom that is already whole', () => {
    const iPhone = PHONES[1]
    expect(
      iPhone === undefined ? 0 : screenOf(onTouch(iPhone)).zoom,
    ).toBeCloseTo(4 / 3, 9)
  })

  test('takes the nearest whole size, showing a little more of the room', () => {
    const se = PHONES[2]
    expect(se === undefined ? 0 : screenOf(onTouch(se)).zoom).toBe(5 / 4)
  })

  test('leaves a keyboard and mouse at one game pixel per screen pixel', () => {
    const desktop = modifyFields(initialModel, {
      maybeSurface: () =>
        Option.some({
          left: 0,
          top: 0,
          width: 1366,
          height: 768,
          pixelRatio: 1,
        }),
    })
    expect(screenOf(desktop).zoom).toBe(1)
  })

  test('leaves the zoom as laid out with no pixel ratio', () => {
    const iPhone = PHONES[2]
    const noRatio =
      iPhone === undefined
        ? initialModel
        : modifyFields(onTouch(iPhone), {
            maybeSurface: () =>
              Option.some({ left: 0, top: 0, width: 375, height: 667 }),
          })
    expect(screenOf(noRatio).zoom).toBeCloseTo(4 / 3, 9)
  })
})
