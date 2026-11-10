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
    { id: 'Study', symbol: 'K', doors: [], opener: 'Boards', requires: [] },
    { id: 'Den', symbol: 'J', doors: [], opener: 'Boards', requires: [] },
  ],
  drops: [],
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
  test('the manor is one image a room, five rooms in each state', () => {
    expect(imagesOf(roomShapes(MANOR))).toHaveLength(5)
    expect(imagesOf(roomShapes(openExit(MANOR, 'Kitchen')))).toHaveLength(5)
    // NOTE: the dining room with its four exits (the secret shelf only with
    // the east boards open: 16 sets less the 4 with the shelf alone), the
    // kitchen and the parlour each with its own, the library with the east
    // boards and then the far boards and the shelf (5), and the cellar with
    // its own.
    expect(imagesOf(everyRoomImage(MANOR_SPEC))).toHaveLength(
      12 + 2 + 2 + 5 + 2,
    )
  })

  test("in the manor, an exit far from a room never changes the room's image", () => {
    const kitchenOpen = roomShapes(openExit(MANOR, 'Kitchen'))
    const westOpen = roomShapes(openExit(MANOR, 'West'))
    const shut = roomShapes(MANOR)
    // NOTE: the parlour sits at x -320, the dining room at 0, the kitchen
    // at 0 too but above it, so they are told apart by their y.
    const imageAt = (
      shapes: ReadonlyArray<Canvas.Shape>,
      x: number,
      y: number,
    ): Option.Option<Canvas.Image> =>
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
