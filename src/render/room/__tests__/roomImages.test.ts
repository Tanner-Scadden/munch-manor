import { Array, Option, Result } from 'effect'
import { describe, expect, test } from 'vitest'

import type * as Draw from '#render/draw.ts'
import { everyRoomImage, roomShapes } from '#render/room/room.ts'
import { MANOR, levelFor, openExit } from '#world/level/arena.ts'
import { type LevelSpec, MANOR_SPEC } from '#world/level/plan.ts'

const HOUSE: LevelSpec = {
  id: 'TestImages',
  rooms: [
    {
      id: 'Hall',
      tiles: [
        '####NN####',
        '#........#',
        '#........#',
        'K........J',
        'K........J',
        '#........#',
        '#........#',
        '######SS##',
      ],
      origin: { column: 0, row: 0 },
      maybeExit: Option.none(),
      renames: {},
    },
    {
      id: 'Study',
      tiles: [
        '########',
        '#......#',
        '#......#',
        '#......K',
        '#......K',
        '#......#',
        '#......#',
        '########',
      ],
      origin: { column: -8, row: 0 },
      maybeExit: Option.some('Study'),
      renames: {},
    },
    {
      id: 'Den',
      tiles: [
        '########',
        '#......#',
        '#......#',
        'J......#',
        'J......#',
        '#......#',
        '#......#',
        '########',
      ],
      origin: { column: 10, row: 0 },
      maybeExit: Option.some('Den'),
      renames: {},
    },
  ],
  exits: [
    { id: 'Study', symbol: 'K', doors: [], opener: 'Boards', requires: [] },
    { id: 'Den', symbol: 'J', doors: [], opener: 'Boards', requires: [] },
  ],
  drops: [],
  start: { x: 50, y: 40 },
}

const imagesOf = (
  shapes: ReadonlyArray<Draw.Shape>,
): ReadonlyArray<Draw.Image> =>
  Array.filterMap(shapes, shape =>
    shape._tag === 'Image' ? Result.succeed(shape) : Result.failVoid,
  )

const imageAtX = (
  shapes: ReadonlyArray<Draw.Shape>,
  x: number,
): Option.Option<Draw.Image> =>
  Array.findFirst(imagesOf(shapes), image => image.x === x)

describe('room images', () => {
  test('the manor is one image a room, five rooms in each state', () => {
    expect(imagesOf(roomShapes(MANOR))).toHaveLength(5)
    expect(imagesOf(roomShapes(openExit(MANOR, 'Kitchen')))).toHaveLength(5)
    expect(imagesOf(everyRoomImage(MANOR_SPEC))).toHaveLength(
      12 + 2 + 2 + 5 + 2,
    )
  })

  test("in the manor, an exit far from a room never changes the room's image", () => {
    const kitchenOpen = roomShapes(openExit(MANOR, 'Kitchen'))
    const westOpen = roomShapes(openExit(MANOR, 'West'))
    const shut = roomShapes(MANOR)
    const imageAt = (
      shapes: ReadonlyArray<Draw.Shape>,
      x: number,
      y: number,
    ): Option.Option<Draw.Image> =>
      Array.findFirst(imagesOf(shapes), image => image.x === x && image.y === y)
    expect(imageAt(kitchenOpen, -320, 40)).toEqual(imageAt(shut, -320, 40))
    expect(imageAt(westOpen, 0, -150)).toEqual(imageAt(shut, 0, -150))
    expect(imageAt(westOpen, 0, 0)).not.toEqual(imageAt(shut, 0, 0))
  })

  test('the fallen chandelier draws on the same room images', () => {
    const fallen = levelFor(MANOR_SPEC, [], ['Chandelier'])
    expect(fallen).not.toBe(MANOR)
    expect(roomShapes(fallen)).toEqual(roomShapes(MANOR))
  })

  test("each room's image sits on its own block, west of the start too", () => {
    const shapes = roomShapes(levelFor(HOUSE))
    const xs = Array.map(imagesOf(shapes), ({ x }) => x)
    expect(xs).toEqual([0, -80, 100])
    Array.forEach(imagesOf(shapes), image => {
      expect(image.width).toBe(image.x === 0 ? 100 : 80)
      expect(image.height).toBe(80)
    })
  })

  test("an exit far from a room never changes the room's image", () => {
    const shut = roomShapes(levelFor(HOUSE))
    const denOpen = roomShapes(levelFor(HOUSE, ['Den']))
    expect(imageAtX(denOpen, -80)).toEqual(imageAtX(shut, -80))
    expect(imageAtX(denOpen, 100)).not.toEqual(imageAtX(shut, 100))
    expect(imageAtX(denOpen, 0)).not.toEqual(imageAtX(shut, 0))
  })

  test('images grow with the rooms and their own exits', () => {
    expect(imagesOf(everyRoomImage(HOUSE))).toHaveLength(4 + 2 + 2)
  })
})
