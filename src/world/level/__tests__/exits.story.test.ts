import { Array, Option } from 'effect'
import { type Canvas, Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it, test } from '@effect/vitest'

import { type Model, Phase } from '../../../app/model'
import { initialModel } from '../../../app/pureApp'
import { freshRun } from '../../../app/runReset'
import { roomShapes } from '../../../render/room/room'
import { MAX_FRAME_DELTA_MS } from '../../../shared/constants'
import { imageColors } from '../../../test/testPng'
import { APPLICATION, ticks } from '../../../test/testing'
import {
  MANOR,
  closedExits,
  isDoorTile,
  isWalkableTile,
  levelFor,
  levelOf,
  openExit,
  openExitIn,
  roomAt,
  startingLevel,
  tileIndex,
} from '../arena'
import { UNREACHED_DISTANCE, distanceAt, flowFieldToward } from '../pathing'
import { type LevelSpec } from '../plan'

// NOTE: a made-up map with one boarded exit that holds a door shut, since
// the parlour's exit has no room behind it yet. The kitchen below the boards
// has its own door, shut until the exit opens.
const HALL: LevelSpec = {
  id: 'TestHall',
  rooms: [
    {
      id: 'TestHall',
      tiles: [
        '###NN###',
        '#......#',
        '#......#',
        'W......#',
        'W......#',
        '###KK###',
        '#......#',
        '#......#',
        '###SS###',
      ],
      origin: { column: 0, row: 0 },
      maybeExit: Option.none(),
      renames: {},
    },
  ],
  exits: [{ id: 'Kitchen', symbol: 'K', doors: ['South'] }],
  drops: [],
  start: { x: 40, y: 20 },
}

const BOARDS = { column: 3, row: 5 }
const KITCHEN_BOARDS = { column: 6, row: 1 }
const WEST_BOARDS = { column: 0, row: 12 }
const HALLWAY = { x: 35, y: 25 }
const BOARD_GAP_COLOR = '#140e0b'

// NOTE: the room is baked into one image, so the boards are found among the
// image's pixels.
const drawsBoards = (shapes: ReadonlyArray<Canvas.Shape>): boolean =>
  Array.some(
    shapes,
    shape =>
      shape._tag === 'Image' &&
      Array.contains(imageColors(shape.src), BOARD_GAP_COLOR),
  )

const distanceTo = (
  distances: Int32Array,
  column: number,
  row: number,
): number => distanceAt(distances, tileIndex(levelFor(HALL), column, row))

describe('a level with a closed exit', () => {
  const hall = levelFor(HALL)

  test('keeps the boards solid and the door behind them out of the spawn doors', () => {
    expect(isWalkableTile(hall, BOARDS.column, BOARDS.row)).toBe(false)
    expect(isWalkableTile(hall, 3, 8)).toBe(false)
    expect(isDoorTile(hall, 3, 8)).toBe(false)
    expect(hall.doorIds).toEqual(['North', 'West'])
    expect(Array.map(closedExits(hall), ({ id }) => id)).toEqual(['Kitchen'])
  })

  test('leaves the room behind it out of the flow field', () => {
    const field = flowFieldToward(hall, HALLWAY, 'Narrow', [])
    expect(distanceTo(field.distances, 3, 6)).toBe(UNREACHED_DISTANCE)
  })
})

describe('opening an exit', () => {
  const hall = levelFor(HALL)
  const opened = openExit(hall, 'Kitchen')

  test('turns the boards into floor and adds the doors behind them', () => {
    expect(isWalkableTile(opened, BOARDS.column, BOARDS.row)).toBe(true)
    expect(isWalkableTile(opened, 3, 8)).toBe(true)
    expect(isDoorTile(opened, 3, 8)).toBe(true)
    expect(opened.doorIds).toEqual(['North', 'West', 'South'])
    expect(opened.thresholds.South.tiles).toEqual([
      { column: 3, row: 8 },
      { column: 4, row: 8 },
    ])
    expect(closedExits(opened)).toEqual([])
    expect(opened.openExits).toEqual(['Kitchen'])
    expect(opened.key).not.toBe(hall.key)
  })

  test('lets the flow field reach the room behind the boards', () => {
    const field = flowFieldToward(opened, HALLWAY, 'Narrow', [])
    expect(distanceTo(field.distances, 3, 6)).toBeLessThan(UNREACHED_DISTANCE)
  })

  test('builds each set of open exits once, and opening twice changes nothing', () => {
    expect(levelFor(HALL, ['Kitchen'])).toBe(opened)
    expect(levelFor(HALL, ['Kitchen', 'Kitchen'])).toBe(opened)
    expect(openExit(opened, 'Kitchen')).toBe(opened)
    expect(openExit(hall, 'Attic')).toBe(hall)
    expect(levelFor(HALL)).toBe(hall)
  })

  test('redraws the room without the boards', () => {
    expect(roomShapes(hall)).toBe(roomShapes(hall))
    expect(roomShapes(opened)).not.toBe(roomShapes(hall))
    expect(drawsBoards(roomShapes(hall))).toBe(true)
    expect(drawsBoards(roomShapes(opened))).toBe(false)
  })
})

describe('the manor', () => {
  test('is where every run starts, with the kitchen and the parlour boarded shut', () => {
    expect(initialModel.level).toEqual(startingLevel)
    expect(levelOf(initialModel)).toBe(MANOR)
    expect(freshRun(initialModel).level).toEqual(startingLevel)
    expect(Array.map(closedExits(MANOR), ({ id }) => id)).toEqual([
      'Kitchen',
      'West',
    ])
    expect(MANOR.doorIds).toEqual(['North', 'West', 'East', 'South'])
    expect(
      isWalkableTile(MANOR, KITCHEN_BOARDS.column, KITCHEN_BOARDS.row),
    ).toBe(false)
    expect(isWalkableTile(MANOR, WEST_BOARDS.column, WEST_BOARDS.row)).toBe(
      false,
    )
    expect(drawsBoards(roomShapes(MANOR))).toBe(true)
  })

  test('starts in the dining room, with the kitchen above it and the parlour west of it', () => {
    expect(MANOR.bounds).toEqual({ left: 0, top: 0, right: 360, bottom: 220 })
    expect(roomAt(MANOR, MANOR.start).id).toBe('Dining')
    expect(MANOR.start).toEqual({ x: 180, y: 145 })
    expect(MANOR.top).toBe(-150)
    expect(MANOR.left).toBe(-320)
    expect(MANOR.doors.North.center).toEqual({ x: 280, y: 10 })
    expect(MANOR.doors.West.center).toEqual({ x: 5, y: 30 })
    expect(MANOR.doors.East.center).toEqual({ x: 355, y: 190 })
    expect(MANOR.doors.South.center).toEqual({ x: 60, y: 215 })
    expect(MANOR.doorIds).not.toContain('Front')
    expect(isWalkableTile(MANOR, 17, 21)).toBe(false)
  })

  test('opens the kitchen exit into floor and adds the back door and window', () => {
    const opened = levelOf({ level: openExitIn(startingLevel, 'Kitchen') })
    expect(Array.map(closedExits(opened), ({ id }) => id)).toEqual(['West'])
    expect(opened.doorIds).toEqual([
      'North',
      'West',
      'East',
      'South',
      'Back',
      'Window',
    ])
    expect(
      isWalkableTile(opened, KITCHEN_BOARDS.column, KITCHEN_BOARDS.row),
    ).toBe(true)
    expect(opened.bounds.top).toBe(opened.top)
  })

  test('opens the west exit into the parlour, with its two doors', () => {
    const opened = levelOf({ level: openExitIn(startingLevel, 'West') })
    expect(opened.doorIds).toEqual([
      'North',
      'West',
      'East',
      'South',
      'WestTop',
      'WestBottom',
    ])
    expect(isWalkableTile(opened, WEST_BOARDS.column, WEST_BOARDS.row)).toBe(
      true,
    )
    expect(isWalkableTile(opened, -1, WEST_BOARDS.row)).toBe(true)
    expect(opened.bounds.left).toBe(opened.left)
    expect(roomAt(opened, { x: -160, y: 130 }).id).toBe('Parlour')
  })

  test('with every exit open, no boards are left to draw', () => {
    const opened = levelOf({
      level: openExitIn(openExitIn(startingLevel, 'Kitchen'), 'West'),
    })
    expect(closedExits(opened)).toEqual([])
    expect(drawsBoards(roomShapes(opened))).toBe(false)
  })

  it.effect('keeps its level through a wave', () => {
    const fighting: Model = modifyFields(initialModel, {
      maybeSurface: () =>
        Option.some({ left: 0, top: 0, width: 800, height: 400 }),
      phase: () => Phase.Wave({ wave: 1, elapsedMs: 0, spawns: [] }),
    })
    return Story.story(
      APPLICATION,
      Story.given(fighting),
      ...ticks(30, MAX_FRAME_DELTA_MS),
      Story.model(current => {
        expect(levelOf(current)).toBe(MANOR)
      }),
    )
  })
})
