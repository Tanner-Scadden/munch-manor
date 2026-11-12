import { Array, Option } from 'effect'
import { describe, expect, test } from 'vitest'

import { TILE_SIZE } from '../../../shared/constants'
import { type Level, levelFor, roomAt } from '../arena'
import {
  CELLAR_ROOM_ID,
  EAST_EXIT,
  FAR_EXIT,
  LIBRARY_ROOM_ID,
  MANOR_SPEC,
  PARLOUR_ROOM_ID,
  SECRET_SYMBOL,
  SLOTS,
  manorSpecFor,
  roomSpotsOf,
} from '../plan'
import { DOOR_SYMBOLS, tilesWithSymbol } from '../tileGrid'
import { doorSpawnPoint, isInsideRoomAt, isWalkableTile } from '../tileQueries'
import { EVERY_EXIT } from './exits.fixture'

// The house's slots (docs/ROOM_DRAFTS.md): the parlour west of the dining
// room, the library east of it, and the cellar beyond the library, each on
// the slot's footprint, with slot-relative doors and exits.

const WHOLE_HOUSE = levelFor(MANOR_SPEC, EVERY_EXIT)

const boxOf = (level: Level, id: string) =>
  Option.map(
    Array.findFirst(level.rooms, room => room.id === id),
    ({ box }) => box,
  )

describe('the whole house', () => {
  test('puts each room on its slot, every slot 32 by 18 tiles', () => {
    expect(Array.map(WHOLE_HOUSE.rooms, ({ id }) => id)).toEqual([
      'Dining',
      'Kitchen',
      PARLOUR_ROOM_ID,
      LIBRARY_ROOM_ID,
      CELLAR_ROOM_ID,
    ])
    expect(boxOf(WHOLE_HOUSE, LIBRARY_ROOM_ID)).toEqual(
      Option.some({ left: 360, top: 0, right: 680, bottom: 180 }),
    )
    expect(boxOf(WHOLE_HOUSE, CELLAR_ROOM_ID)).toEqual(
      Option.some({ left: 680, top: 0, right: 1000, bottom: 180 }),
    )
    Array.forEach([SLOTS.West, SLOTS.East, SLOTS.Far], ({ origin }) => {
      const room = roomAt(WHOLE_HOUSE, {
        x: (origin.column + 16) * TILE_SIZE,
        y: (origin.row + 9) * TILE_SIZE,
      })
      expect(room.box.right - room.box.left).toBe(32 * TILE_SIZE)
      expect(room.box.bottom - room.box.top).toBe(18 * TILE_SIZE)
    })
    expect(WHOLE_HOUSE.bounds).toEqual({
      left: -320,
      top: -150,
      right: 1000,
      bottom: 220,
    })
  })

  test('opens every spawn door, two to each slot room', () => {
    expect(WHOLE_HOUSE.doorIds).toEqual([
      'North',
      'West',
      'East',
      'South',
      'Back',
      'Window',
      'WestTop',
      'WestBottom',
      'EastTop',
      'EastBottom',
      'FarTop',
      'FarBottom',
    ])
  })

  test('never spawns through a shared wall: every door opens onto the yard', () => {
    const indoors = Array.filter(WHOLE_HOUSE.doorIds, door =>
      isInsideRoomAt(WHOLE_HOUSE, doorSpawnPoint(WHOLE_HOUSE, door, 0)),
    )
    expect(indoors).toEqual([])
  })

  test('keeps a slot room port that faces outside, and the shelves no library swings, as wall', () => {
    // NOTE: the parlour's west port and the cellar's east port.
    Array.forEach([8, 9], row => {
      expect(isWalkableTile(WHOLE_HOUSE, -32, row + 4)).toBe(false)
      expect(isWalkableTile(WHOLE_HOUSE, 99, row)).toBe(false)
    })
    // NOTE: the library's east shelf and the cellar's west wall behind it.
    Array.forEach([13, 14], row => {
      expect(isWalkableTile(WHOLE_HOUSE, 67, row)).toBe(false)
      expect(isWalkableTile(WHOLE_HOUSE, 68, row)).toBe(false)
    })
  })

  test('opens the far boards through the library into the cellar', () => {
    const library = levelFor(MANOR_SPEC, [EAST_EXIT])
    const cellar = levelFor(MANOR_SPEC, [EAST_EXIT, FAR_EXIT])
    Array.forEach([8, 9], row => {
      expect(isWalkableTile(library, 67, row)).toBe(false)
      expect(isWalkableTile(cellar, 67, row)).toBe(true)
      expect(isWalkableTile(cellar, 68, row)).toBe(true)
    })
    expect(roomAt(cellar, { x: 760, y: 125 }).id).toBe(CELLAR_ROOM_ID)
    expect(library.bounds.right).toBe(680)
    expect(cellar.bounds.right).toBe(1000)
  })
})

describe('another arrangement', () => {
  // NOTE: what layer 11 will roll: the library west swings its east shelf
  // into the dining room's west wall; in the far slot, its west shelf into
  // the east room.
  test('swings the library shelf toward the room it is entered from', () => {
    const libraryWest = manorSpecFor({
      West: LIBRARY_ROOM_ID,
      East: PARLOUR_ROOM_ID,
      Far: CELLAR_ROOM_ID,
    })
    const libraryFar = manorSpecFor({
      West: PARLOUR_ROOM_ID,
      East: CELLAR_ROOM_ID,
      Far: LIBRARY_ROOM_ID,
    })
    expect(tilesWithSymbol(levelFor(libraryWest), SECRET_SYMBOL)).toEqual([
      { column: -1, row: 17 },
      { column: 0, row: 17 },
      { column: -1, row: 18 },
      { column: 0, row: 18 },
    ])
    expect(tilesWithSymbol(levelFor(libraryFar), SECRET_SYMBOL)).toEqual([
      { column: 67, row: 13 },
      { column: 68, row: 13 },
      { column: 67, row: 14 },
      { column: 68, row: 14 },
    ])
    const opened = levelFor(libraryWest, EVERY_EXIT)
    expect(isWalkableTile(opened, -1, 17)).toBe(true)
    expect(isWalkableTile(opened, 0, 18)).toBe(true)
  })

  test('keeps every slot room door on its slot', () => {
    const swapped = levelFor(
      manorSpecFor({
        West: CELLAR_ROOM_ID,
        East: LIBRARY_ROOM_ID,
        Far: PARLOUR_ROOM_ID,
      }),
      EVERY_EXIT,
    )
    expect(swapped.doorIds).toEqual(WHOLE_HOUSE.doorIds)
    expect(tilesWithSymbol(swapped, DOOR_SYMBOLS.WestTop)).toEqual([
      { column: -27, row: 4 },
      { column: -26, row: 4 },
      { column: -27, row: 5 },
      { column: -26, row: 5 },
    ])
  })
})

describe('the house spots', () => {
  test("lists each room's drafted hiding spots, cases, and trap crates", () => {
    const spots = roomSpotsOf(MANOR_SPEC)
    const of = (id: string) =>
      Option.getOrThrow(Array.findFirst(spots, ({ room }) => room === id))
    const library = of(LIBRARY_ROOM_ID)
    expect(Array.map(library.hiding, ({ mark }) => mark)).toEqual([
      '1',
      '2',
      '3',
      '4',
    ])
    expect(library.hiding[0]?.tile).toEqual({ column: 64, row: 5 })
    expect(library.cases).toEqual([
      [
        { column: 41, row: 16 },
        { column: 42, row: 16 },
      ],
      [
        { column: 63, row: 16 },
        { column: 64, row: 16 },
      ],
    ])
    expect(library.trapCrates).toHaveLength(1)
    const cellar = of(CELLAR_ROOM_ID)
    expect(cellar.hiding).toHaveLength(4)
    expect(cellar.cases).toHaveLength(2)
    expect(cellar.trapCrates).toEqual([
      [
        { column: 80, row: 16 },
        { column: 81, row: 16 },
      ],
    ])
    expect(of('Dining').hiding).toHaveLength(4)
    expect(of(PARLOUR_ROOM_ID).cases).toHaveLength(2)
  })
})
