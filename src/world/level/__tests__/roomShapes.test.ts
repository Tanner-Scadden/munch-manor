import { Array, Option } from 'effect'
import { describe, expect, test } from 'vitest'

import { type Level, levelFor } from '#world/level/arena.ts'
import {
  UNREACHED_DISTANCE,
  distanceAt,
  flowFieldToward,
} from '#world/level/pathing.ts'
import {
  ARRANGEMENTS,
  CELLAR_ROOM_ID,
  DINING_ROOM_ID,
  LIBRARY_ROOM_ID,
  PARLOUR_ROOM_ID,
  manorSpecFor,
  roomSpotsOf,
} from '#world/level/plan.ts'
import { tileCenter } from '#world/level/tileGrid.ts'
import {
  doorSpawnPoint,
  isWalkableTile,
  tileIndexAt,
} from '#world/level/tileQueries.ts'

import { EVERY_EXIT } from './exits.fixture.ts'

const HOUSES = Array.map(ARRANGEMENTS, arrangement => {
  const spec = manorSpecFor(arrangement)
  return { arrangement, spec, level: levelFor(spec, EVERY_EXIT) }
})

const isReachedFromEveryDoor = (level: Level, column: number, row: number) => {
  const field = flowFieldToward(
    level,
    tileCenter({ column, row }),
    'Narrow',
    [],
  )
  return Array.every(
    level.doorIds,
    door =>
      distanceAt(
        field.distances,
        tileIndexAt(level, doorSpawnPoint(level, door, 0)),
      ) < UNREACHED_DISTANCE,
  )
}

type Loop = Readonly<{
  left: number
  top: number
  right: number
  bottom: number
}>

const LOOPS: Readonly<Record<string, Loop>> = {
  [DINING_ROOM_ID]: { left: 7, top: 9, right: 28, bottom: 12 },
  [PARLOUR_ROOM_ID]: { left: 4, top: 3, right: 27, bottom: 15 },
  [LIBRARY_ROOM_ID]: { left: 18, top: 10, right: 27, bottom: 13 },
  [CELLAR_ROOM_ID]: { left: 17, top: 7, right: 22, bottom: 12 },
}

const borderOf = ({ left, top, right, bottom }: Loop) => [
  ...Array.makeBy(right - left + 1, step => ({
    column: left + step,
    row: top,
  })),
  ...Array.makeBy(right - left + 1, step => ({
    column: left + step,
    row: bottom,
  })),
  ...Array.makeBy(bottom - top - 1, step => ({
    column: left,
    row: top + 1 + step,
  })),
  ...Array.makeBy(bottom - top - 1, step => ({
    column: right,
    row: top + 1 + step,
  })),
]

const insideOf = ({ left, top, right, bottom }: Loop) =>
  Array.flatMap(
    Array.makeBy(bottom - top - 1, step => top + 1 + step),
    row =>
      Array.makeBy(right - left - 1, step => ({
        column: left + 1 + step,
        row,
      })),
  )

describe('the reshaped rooms', () => {
  test('every hiding spot and case is reached from every door, in every arrangement', () => {
    Array.forEach(HOUSES, ({ spec, level }) => {
      Array.forEach(roomSpotsOf(spec), spots => {
        Array.forEach(spots.hiding, ({ mark, tile }) => {
          expect(
            isReachedFromEveryDoor(level, tile.column, tile.row),
            `${spots.room} spot ${mark}`,
          ).toBe(true)
        })
        Array.forEach(spots.cases, piece =>
          Array.forEach(piece, tile => {
            const front = Array.findFirst([tile.row - 1, tile.row + 1], row =>
              isWalkableTile(level, tile.column, row),
            )
            expect(Option.isSome(front), `${spots.room} case`).toBe(true)
            expect(
              isReachedFromEveryDoor(
                level,
                tile.column,
                Option.getOrElse(front, () => tile.row),
              ),
              `${spots.room} case`,
            ).toBe(true)
          }),
        )
      })
    })
  })

  test('each room keeps a loop of floor round its cover, in every slot', () => {
    Array.forEach(HOUSES, ({ spec, level }) => {
      Array.forEach(spec.rooms, room =>
        Option.match(Option.fromNullishOr(LOOPS[room.id]), {
          onNone: () => undefined,
          onSome: loop => {
            const at = ({ column, row }: { column: number; row: number }) =>
              isWalkableTile(
                level,
                room.origin.column + column,
                room.origin.row + row,
              )
            expect(Array.every(borderOf(loop), at), `${room.id} loop`).toBe(
              true,
            )
            expect(
              Array.some(insideOf(loop), tile => !at(tile)),
              `${room.id} cover inside its loop`,
            ).toBe(true)
          },
        }),
      )
    })
  })

  test('the parlour rings its dance floor, with a gap on each side', () => {
    const parlour = Option.getOrThrow(
      Array.findFirst(
        Array.flatMap(HOUSES, ({ spec, level }) =>
          Array.map(spec.rooms, room => ({ room, level })),
        ),
        ({ room }) => room.id === PARLOUR_ROOM_ID,
      ),
    )
    const at = (column: number, row: number) =>
      isWalkableTile(
        parlour.level,
        parlour.room.origin.column + column,
        parlour.room.origin.row + row,
      )
    expect([at(14, 4), at(15, 4), at(16, 4), at(17, 4)]).toEqual([
      false,
      true,
      true,
      false,
    ])
    expect([at(14, 13), at(15, 13), at(16, 13), at(17, 13)]).toEqual([
      false,
      true,
      true,
      false,
    ])
    expect([at(6, 7), at(6, 8), at(6, 9), at(6, 10)]).toEqual([
      false,
      true,
      true,
      false,
    ])
    expect([at(25, 7), at(25, 8), at(25, 9), at(25, 10)]).toEqual([
      false,
      true,
      true,
      false,
    ])
    expect(
      Array.every(
        Array.makeBy(16, step => 8 + step),
        column =>
          Array.every(
            Array.makeBy(6, step => 6 + step),
            row => at(column, row),
          ),
      ),
    ).toBe(true)
  })

  test('the cellar keeps a short dead end at the coal heap', () => {
    const cellar = Option.getOrThrow(
      Array.findFirst(
        Array.flatMap(HOUSES, ({ spec, level }) =>
          Array.map(spec.rooms, room => ({ room, level })),
        ),
        ({ room }) => room.id === CELLAR_ROOM_ID,
      ),
    )
    const at = (column: number, row: number) =>
      isWalkableTile(
        cellar.level,
        cellar.room.origin.column + column,
        cellar.room.origin.row + row,
      )
    expect(at(9, 2) && at(9, 3)).toBe(true)
    expect(at(10, 2) || at(10, 3)).toBe(false)
    expect(
      Array.map(
        Array.makeBy(9, step => 1 + step),
        column => at(column, 4),
      ),
    ).toEqual([true, true, false, false, false, false, false, false, false])
  })
})
