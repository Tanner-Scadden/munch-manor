import { Array, Option } from 'effect'
import type { Canvas } from 'foldkit'
import { given, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import {
  type LevelSpec,
  MANOR,
  PARLOUR,
  closedExits,
  doorSpawnPoint,
  isDoorTile,
  isWalkableTile,
  levelFor,
  levelOf,
  openExit,
  openExitIn,
  startingLevel,
  tileIndex,
} from './arena'
import { MAX_FRAME_DELTA_MS } from './constants'
import { update } from './main'
import { type Model, Phase, initialModel } from './model'
import {
  UNREACHED_DISTANCE,
  distanceAt,
  flowFieldToward,
} from './pathing'
import { roomShapes } from './room'
import { freshRun } from './runReset'
import { imageColors } from './testPng'
import { ticks } from './testing'

// NOTE: a made-up map with one boarded exit that holds a door shut, since
// the parlour's exit has no room behind it yet. The kitchen below the boards
// has its own door, shut until the exit opens.
const HALL: LevelSpec = {
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
  topRow: 0,
  exits: [{ id: 'Kitchen', symbol: 'K', doors: ['South'] }],
  rooms: [
    {
      id: 'TestHall',
      firstColumn: 0,
      lastColumn: 7,
      firstRow: 0,
      lastRow: 8,
      maybeExit: Option.none(),
    },
  ],
}

const BOARDS = { column: 3, row: 5 }
const KITCHEN_BOARDS = { column: 6, row: 1 }
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
  test('is where every run starts, with the way to the kitchen boarded shut', () => {
    expect(initialModel.level).toEqual(startingLevel)
    expect(levelOf(initialModel)).toBe(MANOR)
    expect(freshRun(initialModel).level).toEqual(startingLevel)
    expect(Array.map(closedExits(MANOR), ({ id }) => id)).toEqual(['Kitchen'])
    expect(MANOR.doorIds).toEqual(['North', 'West', 'East', 'South'])
    expect(
      isWalkableTile(MANOR, KITCHEN_BOARDS.column, KITCHEN_BOARDS.row),
    ).toBe(false)
    expect(drawsBoards(roomShapes(MANOR))).toBe(true)
  })

  test('keeps the parlour where it always was, with the kitchen above it', () => {
    expect(PARLOUR.doorIds).toEqual(MANOR.doorIds)
    Array.forEach(PARLOUR.doorIds, door => {
      expect(MANOR.doors[door]).toEqual(PARLOUR.doors[door])
      expect(doorSpawnPoint(MANOR, door, 3)).toEqual(
        doorSpawnPoint(PARLOUR, door, 3),
      )
    })
    expect(MANOR.bounds).toEqual(PARLOUR.bounds)
    expect(MANOR.top).toBeLessThan(0)
  })

  test('opens the kitchen exit into floor and adds the back door and window', () => {
    const opened = levelOf({ level: openExitIn(startingLevel, 'Kitchen') })
    expect(closedExits(opened)).toEqual([])
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
    expect(drawsBoards(roomShapes(opened))).toBe(false)
  })

  test('keeps its level through a wave', () => {
    const fighting: Model = modifyFields(initialModel, {
      maybeSurface: () =>
        Option.some({ left: 0, top: 0, width: 800, height: 400 }),
      phase: () => Phase.Wave({ wave: 1, elapsedMs: 0, spawns: [] }),
    })
    story(
      update,
      given(fighting),
      ...ticks(30, MAX_FRAME_DELTA_MS),
      model(current => {
        expect(levelOf(current)).toBe(MANOR)
      }),
    )
  })
})
