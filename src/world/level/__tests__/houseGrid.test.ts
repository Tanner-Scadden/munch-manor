import { Array, Option } from 'effect'
import { describe, expect, test } from 'vitest'

import { cameraFor } from '../../../render/camera'
import { TILE_SIZE } from '../../../shared/constants'
import {
  TILE_OUTSIDE,
  doorSpawnPoint,
  hasTileFlag,
  isInsideRoomAt,
  isWalkableTile,
  levelFor,
  roomAt,
  symbolAt,
  tileIndex,
  tileOfIndex,
} from '../arena'
import { UNREACHED_DISTANCE, distanceAt, flowFieldToward } from '../pathing'
import { type LevelSpec } from '../plan'

// NOTE: a made-up house on the plan: a hall at the origin, and a study west
// of it, at negative columns, behind a boarded exit in the wall they share.
// The study's spawn door is drawn as a neutral `n` that its placement renames
// to the back door's symbol, as a rolled room's doors will be named by slot.
// The hall's front door, `M`, is never a spawn door. Row 0 west of the hall
// is covered by no room, so it is yard.
const HALL_TILES: ReadonlyArray<string> = [
  '####NN####',
  '#........#',
  '#........#',
  'K........#',
  'K........#',
  '#........#',
  '#........#',
  '#MM###SS##',
]

const STUDY_TILES: ReadonlyArray<string> = [
  '###nn###',
  '#......#',
  '#......K',
  '#......K',
  '#......#',
  '#......#',
  '########',
]

const HOUSE: LevelSpec = {
  id: 'TestHouse',
  rooms: [
    {
      id: 'Hall',
      tiles: HALL_TILES,
      origin: { column: 0, row: 0 },
      maybeExit: Option.none(),
      renames: {},
    },
    {
      id: 'Study',
      tiles: STUDY_TILES,
      origin: { column: -8, row: 1 },
      maybeExit: Option.some('Kitchen'),
      renames: { n: 'D' },
    },
  ],
  exits: [
    {
      id: 'Kitchen',
      symbol: 'K',
      doors: ['Back'],
      opener: 'Boards',
      requires: [],
    },
  ],
  drops: [],
  start: { x: 50, y: 40 },
}

const shut = levelFor(HOUSE)
const open = levelFor(HOUSE, ['Kitchen'])

const HALL_MIDDLE = { x: 50, y: 40 }
const STUDY_MIDDLE = { x: -40, y: 50 }

describe('a house on a grid of rooms', () => {
  test('the map is the block the rooms cover, west of the start too', () => {
    expect(open.leftColumn).toBe(-8)
    expect(open.topRow).toBe(0)
    expect(open.columns).toBe(18)
    expect(open.rows).toBe(8)
    expect(open.left).toBe(-80)
    expect(open.width).toBe(180)
    expect(open.tileCount).toBe(18 * 8)
    expect(open.start).toEqual(HOUSE.start)
    expect(symbolAt(open, -8, 0)).toEqual(Option.some(','))
    expect(symbolAt(open, -5, 1)).toEqual(Option.some('D'))
    expect(symbolAt(open, -9, 1)).toEqual(Option.none())
    expect(symbolAt(open, 4, 0)).toEqual(Option.some('N'))
  })

  test('tile indices round trip at negative columns', () => {
    Array.forEach(Array.range(0, open.tileCount - 1), index => {
      const { column, row } = tileOfIndex(open, index)
      expect(tileIndex(open, column, row)).toBe(index)
    })
    expect(tileOfIndex(open, 0)).toEqual({ column: -8, row: 0 })
  })

  test('the camera stays in the hall until the study opens', () => {
    expect(shut.bounds).toEqual({ left: 0, top: 0, right: 100, bottom: 80 })
    expect(open.bounds).toEqual({ left: -80, top: 0, right: 100, bottom: 80 })
    expect(roomAt(open, STUDY_MIDDLE).id).toBe('Study')
    expect(roomAt(shut, STUDY_MIDDLE).id).toBe('Hall')
    const window = { width: 60, height: 40 }
    expect(cameraFor(shut, STUDY_MIDDLE, window).x).toBe(0)
    expect(cameraFor(open, STUDY_MIDDLE, window).x).toBe(-70)
    expect(cameraFor(open, { x: -200, y: 40 }, window).x).toBe(-80)
  })

  test('a shut room is yard, and an open one is the house', () => {
    const study = tileIndex(shut, -4, 4)
    expect(hasTileFlag(shut, study, TILE_OUTSIDE)).toBe(true)
    expect(isInsideRoomAt(shut, STUDY_MIDDLE)).toBe(false)
    expect(hasTileFlag(open, study, TILE_OUTSIDE)).toBe(false)
    expect(isInsideRoomAt(open, STUDY_MIDDLE)).toBe(true)
    expect(isWalkableTile(shut, 0, 3)).toBe(false)
    expect(isWalkableTile(open, 0, 3)).toBe(true)
    expect(isWalkableTile(open, -1, 3)).toBe(true)
  })

  test("the study's renamed door spawns once it is open", () => {
    expect(shut.doorIds).toEqual(['North', 'South'])
    expect(open.doorIds).toEqual(['North', 'South', 'Back'])
    expect(open.doors.Back.center).toEqual({ x: -40, y: 15 })
    expect(open.doors.Back.edge).toEqual({ x: -40, y: 10 })
    expect(doorSpawnPoint(open, 'Back', 0).y).toBeLessThan(10)
    expect(open.thresholds.Back.tiles).toEqual([
      { column: -5, row: 1 },
      { column: -4, row: 1 },
    ])
  })

  test('the front door is a door no zombie spawns at, and locked', () => {
    expect(open.doorIds).not.toContain('Front')
    expect(open.doors.Front.center).toEqual({ x: 20, y: 75 })
    expect(open.doors.Front.outward).toEqual({ x: 0, y: 1 })
    expect(isWalkableTile(open, 1, 7)).toBe(false)
    expect(isWalkableTile(open, 2, 7)).toBe(false)
  })

  test('zombies path across the shared wall once the exit opens', () => {
    const studyTile = tileIndex(open, -6, 5)
    const shutField = flowFieldToward(shut, HALL_MIDDLE, 'Narrow', [])
    expect(distanceAt(shutField.distances, tileIndex(shut, -6, 5))).toBe(
      UNREACHED_DISTANCE,
    )
    const openField = flowFieldToward(open, HALL_MIDDLE, 'Narrow', [])
    const across = distanceAt(openField.distances, studyTile)
    expect(across).toBeLessThan(UNREACHED_DISTANCE)
    expect(across).toBeGreaterThanOrEqual(
      Math.round((HALL_MIDDLE.x - (-6 * TILE_SIZE + 5)) / TILE_SIZE),
    )
    const wideField = flowFieldToward(open, HALL_MIDDLE, 'Wide', [])
    expect(distanceAt(wideField.distances, studyTile)).toBeLessThan(
      UNREACHED_DISTANCE,
    )
  })
})
