import { Array, Option, Result } from 'effect'
import type { Canvas } from 'foldkit'
import { describe, expect, test } from 'vitest'

import { MANOR, levelFor, openExit } from '../../../world/level/arena'
import { type LevelSpec, MANOR_SPEC } from '../../../world/level/plan'
import { occludersOf } from '../../occluders'
import { everyRoomImage, roomShapes } from '../room'

// NOTE: a hall with a study west of it and a den east of it, each behind its
// own boarded exit, far enough apart that neither exit reaches the other room.
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
    { id: 'Study', symbol: 'K', doors: [] },
    { id: 'Den', symbol: 'J', doors: [] },
  ],
  start: { x: 50, y: 40 },
}

const imagesOf = (
  shapes: ReadonlyArray<Canvas.Shape>,
): ReadonlyArray<Canvas.Image> =>
  Array.filterMap(shapes, shape =>
    shape._tag === 'Image' ? Result.succeed(shape) : Result.failVoid,
  )

const imageAtX = (
  shapes: ReadonlyArray<Canvas.Shape>,
  x: number,
): Option.Option<Canvas.Image> =>
  Array.findFirst(imagesOf(shapes), image => image.x === x)

describe('room images', () => {
  test('the manor is one image a room, two rooms in each state', () => {
    expect(imagesOf(roomShapes(MANOR))).toHaveLength(2)
    expect(imagesOf(roomShapes(openExit(MANOR, 'Kitchen')))).toHaveLength(2)
    expect(imagesOf(everyRoomImage(MANOR_SPEC))).toHaveLength(4)
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

  test("an occluder's crops come from the room images", () => {
    const sources = new Set(
      Array.map(imagesOf(roomShapes(MANOR)), ({ src }) => src),
    )
    Array.forEach(occludersOf(MANOR), ({ shapes }) =>
      Array.forEach(imagesOf(shapes), ({ src }) => {
        expect(sources.has(src)).toBe(true)
      }),
    )
  })
})
