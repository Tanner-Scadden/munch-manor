import { Array, Option } from 'effect'
import { describe, expect, test } from 'vitest'

import { TILE_SIZE } from '../../../shared/constants'
import { exitsToRoom } from '../../../test/model.fixture'
import { CLEARANCES } from '../../../test/testing'
import { secretShelfOf } from '../../library/secretShelf'
import { type Arrangement, freshLevel } from '../../schema/worldSchema'
import {
  type Level,
  levelFor,
  levelOf,
  roomAt,
  startingLevelFor,
} from '../arena'
import {
  UNREACHED_DISTANCE,
  flowFieldToward,
  playerDistancePx,
} from '../pathing'
import {
  ARRANGEMENTS,
  LIBRARY_ROOM_ID,
  SECRET_EXIT,
  SLOTS,
  SLOT_IDS,
  manorSpecFor,
} from '../plan'
import { tileCenter } from '../tileGrid'
import { doorSpawnPoint, isInsideRoomAt, isWalkableTile } from '../tileQueries'

// The rolled rooms (layer 11 of docs/ESCAPE_PLAN.md): each run rolls which
// of the parlour, library, and cellar stands in each of the house's three
// slots, from the run's seed. Every one of the six houses must build, path,
// and spawn the way the fixed one did.

const EVERY_EXIT = ['Kitchen', 'West', 'East', 'Far', SECRET_EXIT]

const nameOf = ({ West, East, Far }: Arrangement): string =>
  `${West}, ${East}, ${Far}`

const wholeHouse = (arrangement: Arrangement): Level =>
  levelFor(manorSpecFor(arrangement), EVERY_EXIT)

// NOTE: a spot on each slot room's top aisle, open in every room's map.
const aisleOf = (slot: keyof typeof SLOTS) => ({
  column: SLOTS[slot].origin.column + 6,
  row: SLOTS[slot].origin.row + 3,
})

describe('every rolled house', () => {
  test.each(ARRANGEMENTS)('%o puts each slot room on its slot', arrangement => {
    const level = wholeHouse(arrangement)
    Array.forEach(SLOT_IDS, slot => {
      const aisle = aisleOf(slot)
      expect(isWalkableTile(level, aisle.column, aisle.row)).toBe(true)
      expect(roomAt(level, tileCenter(aisle)).id).toBe(arrangement[slot])
    })
    expect(level.bounds).toEqual(wholeHouse(ARRANGEMENTS[0]).bounds)
  })

  test.each(ARRANGEMENTS)(
    '%o spawns only through the yard walls',
    arrangement => {
      const level = wholeHouse(arrangement)
      expect(
        Array.filter(level.doorIds, door =>
          isInsideRoomAt(level, doorSpawnPoint(level, door, 0)),
        ),
      ).toEqual([])
      expect(level.doorIds).toEqual(wholeHouse(ARRANGEMENTS[0]).doorIds)
    },
  )

  test.each(ARRANGEMENTS)(
    '%o paths from every door into every slot room',
    arrangement => {
      const level = wholeHouse(arrangement)
      const unreached = Array.flatMap(SLOT_IDS, slot =>
        Array.flatMap(CLEARANCES, clearance => {
          const field = flowFieldToward(
            level,
            tileCenter(aisleOf(slot)),
            clearance,
            [],
          )
          return Array.filter(
            level.doorIds,
            door =>
              playerDistancePx(level, field, doorSpawnPoint(level, door, 0)) >=
              UNREACHED_DISTANCE * TILE_SIZE,
          )
        }),
      )
      expect(unreached).toEqual([])
    },
  )

  test.each(ARRANGEMENTS)(
    "%o swings the library's shelf toward the room it is entered from",
    arrangement => {
      const slot = Option.getOrThrow(
        Array.findFirst(
          SLOT_IDS,
          each => arrangement[each] === LIBRARY_ROOM_ID,
        ),
      )
      const spec = manorSpecFor(arrangement)
      const opened = levelFor(spec, exitsToRoom(arrangement, LIBRARY_ROOM_ID))
      const shelf = Option.getOrThrow(secretShelfOf(opened))
      expect(shelf.side).toBe(SLOTS[slot].inward)
      expect(roomAt(opened, shelf.book).id).toBe(LIBRARY_ROOM_ID)
      const across = {
        column:
          shelf.side === 'West' ? shelf.tile.column - 1 : shelf.tile.column + 1,
        row: shelf.tile.row,
      }
      expect(roomAt(levelFor(spec, EVERY_EXIT), tileCenter(across)).id).toBe(
        slot === 'Far' ? arrangement.East : 'Dining',
      )
    },
  )
})

describe('the house roll', () => {
  const SEEDS = Array.range(0, 299)

  test('is the same for the same seed', () => {
    Array.forEach(SEEDS, seed => {
      expect(freshLevel(seed)).toEqual(freshLevel(seed))
    })
  })

  test('stands every one of the six houses over enough seeds, none much more than another', () => {
    const counts = Array.map(
      ARRANGEMENTS,
      arrangement =>
        Array.filter(
          SEEDS,
          seed => nameOf(freshLevel(seed).arrangement) === nameOf(arrangement),
        ).length,
    )
    Array.forEach(counts, count => {
      expect(count).toBeGreaterThan(SEEDS.length / 6 / 2)
    })
  })

  test('starts every house with its boards shut, from the dining room', () => {
    Array.forEach(SEEDS, seed => {
      const level = freshLevel(seed)
      expect(level).toEqual(startingLevelFor(level.arrangement))
      expect(levelOf({ level }).bounds).toEqual(
        levelOf({ level: startingLevelFor(ARRANGEMENTS[0]) }).bounds,
      )
    })
  })
})
