import { Array, Option } from 'effect'
import { expect, test } from 'vitest'

import { roomBoxOf } from '#render/room/room.ts'
import { windowPanesOf } from '#render/room/windows.ts'
import { TILE_SIZE } from '#shared/constants.ts'
import { levelFor } from '#world/level/arena.ts'
import {
  ARRANGEMENTS,
  EAST_EXIT,
  FAR_EXIT,
  LIBRARY_ROOM_ID,
  WEST_EXIT,
  manorSpecFor,
} from '#world/level/plan.ts'
import { isWalkableTile, tileCoordinate } from '#world/level/tileQueries.ts'

test.each(Array.map(ARRANGEMENTS, arrangement => [arrangement]))(
  'the rose window lights the library wherever it stands: %o',
  arrangement => {
    const level = levelFor(manorSpecFor(arrangement), [
      WEST_EXIT,
      EAST_EXIT,
      FAR_EXIT,
    ])
    const library = Option.getOrThrow(roomBoxOf(level, LIBRARY_ROOM_ID))
    const roses = Array.filter(
      windowPanesOf(level),
      ({ kind }) => kind === 'Rose',
    )
    expect(Array.map(roses, ({ roomId }) => roomId)).toEqual([LIBRARY_ROOM_ID])
    Array.forEach(roses, ({ glass, thrown }) => {
      expect(glass.x).toBeGreaterThanOrEqual(library.x)
      expect(glass.x + glass.width).toBeLessThanOrEqual(
        library.x + library.width,
      )
      expect(glass.y).toBeGreaterThanOrEqual(library.y)
      expect(glass.y + glass.height).toBeLessThanOrEqual(
        library.y + 2 * TILE_SIZE,
      )
      const columns = Array.range(
        tileCoordinate(thrown.x),
        tileCoordinate(thrown.x + thrown.width - 1),
      )
      const rows = Array.range(
        tileCoordinate(thrown.y),
        tileCoordinate(thrown.y + thrown.height - 1),
      )
      Array.forEach(rows, row =>
        Array.forEach(columns, column =>
          expect(isWalkableTile(level, column, row)).toBe(true),
        ),
      )
    })
  },
)
