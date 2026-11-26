import { Array } from 'effect'
import { describe, expect, test } from 'vitest'

import {
  boxFloorOf,
  isNearView,
  isOnFloorSeen,
  viewBoxOf,
  viewFloorOf,
} from '#render/iso/cull.ts'
import { fillSpecOf } from '#render/iso/lightSpecs.ts'
import { EVERY_LEVEL } from '#test/model.fixture.ts'

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

const FLOOR = viewFloorOf({
  x: 100,
  y: 50,
  width: 400,
  height: 220,
  ...ON_ITS_CANVAS,
})

describe('the floor seen', () => {
  test('takes in the floor the view shows', () => {
    expect(
      isOnFloorSeen({ left: 280, top: 140, right: 320, bottom: 160 }, FLOOR),
    ).toBe(true)
    expect(
      isOnFloorSeen({ left: 0, top: 100, right: 600, bottom: 110 }, FLOOR),
    ).toBe(true)
  })

  test('takes in the floor just south of the view, where what stands rises into it', () => {
    expect(
      isOnFloorSeen({ left: 290, top: 262, right: 310, bottom: 268 }, FLOOR),
    ).toBe(true)
  })

  test('leaves out what its box takes in but no pixel shows', () => {
    const nearCorner = { left: 40, top: 230, right: 80, bottom: 260 }
    const overTop = { left: 290, top: -20, right: 310, bottom: 10 }
    expect([isNearView(nearCorner, VIEW), isNearView(overTop, VIEW)]).toEqual([
      true,
      true,
    ])
    expect([
      isOnFloorSeen(nearCorner, FLOOR),
      isOnFloorSeen(overTop, FLOOR),
    ]).toEqual([false, false])
  })

  test('as a box, reads as the box near the view', () => {
    const boxed = boxFloorOf(VIEW)
    expect(
      Array.map(
        [
          { left: 520, top: 60, right: 540, bottom: 90 },
          { left: 700, top: 60, right: 740, bottom: 90 },
          { left: 120, top: 290, right: 140, bottom: 300 },
        ],
        box => [isOnFloorSeen(box, boxed), isNearView(box, VIEW)],
      ),
    ).toEqual([
      [true, true],
      [false, false],
      [true, true],
    ])
  })

  test("takes in a room's pool while the camera looks at any of its room", () => {
    Array.forEach(
      Array.flatMap(EVERY_LEVEL, ({ rooms }) => rooms),
      room => {
        const { pool } = fillSpecOf(room)
        const { left, top, right, bottom } = room.box
        Array.forEach(
          [
            { x: left, y: top },
            { x: right, y: top },
            { x: left, y: bottom },
            { x: right, y: bottom },
          ],
          corner => {
            const floor = viewFloorOf({
              x: corner.x - 200,
              y: corner.y - 110,
              width: 400,
              height: 220,
              ...ON_ITS_CANVAS,
            })
            expect(isOnFloorSeen(pool, floor)).toBe(true)
          },
        )
      },
    )
  })
})
