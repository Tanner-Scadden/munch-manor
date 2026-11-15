import { Array } from 'effect'
import { describe, expect, test } from 'vitest'

import { EVERY_LEVEL } from '../../../test/model.fixture'
import { isNearView, viewBoxOf } from '../cull'
import { fillSpecOf } from '../lightSpecs'

// What the camera sees of the house (src/render/iso/cull.ts): what lies far
// off screen is left out of the frame, its shadows too, and what lies on the
// view or just past it never is.

// NOTE: a view on its own canvas, a game pixel to a pixel.
const ON_ITS_CANVAS = { scale: 1, left: 0, top: 0 }

const VIEW = viewBoxOf({
  x: 100,
  y: 50,
  width: 400,
  height: 220,
  ...ON_ITS_CANVAS,
})

describe('the view', () => {
  test('keeps what lies on it or just past its edges', () => {
    expect(
      isNearView({ left: 120, top: 60, right: 140, bottom: 90 }, VIEW),
    ).toBe(true)
    expect(
      isNearView({ left: 520, top: 60, right: 540, bottom: 90 }, VIEW),
    ).toBe(true)
    expect(
      isNearView({ left: 120, top: 290, right: 140, bottom: 300 }, VIEW),
    ).toBe(true)
  })

  test('leaves out what lies far off it', () => {
    expect(
      isNearView({ left: 700, top: 60, right: 740, bottom: 90 }, VIEW),
    ).toBe(false)
    expect(
      isNearView({ left: 120, top: -200, right: 140, bottom: -150 }, VIEW),
    ).toBe(false)
  })

  test("keeps a room's light while any of its room is on the view", () => {
    Array.forEach(
      Array.flatMap(EVERY_LEVEL, ({ rooms }) => rooms),
      room => {
        const { pool } = fillSpecOf(room)
        const { left, top, right, bottom } = room.box
        expect([pool.left <= left, pool.top <= top]).toEqual([true, true])
        expect([pool.right >= right, pool.bottom >= bottom]).toEqual([
          true,
          true,
        ])
        const corner = viewBoxOf({
          x: right - 1,
          y: bottom - 1,
          width: 400,
          height: 220,
          ...ON_ITS_CANVAS,
        })
        expect(isNearView(pool, corner)).toBe(true)
      },
    )
  })
})
