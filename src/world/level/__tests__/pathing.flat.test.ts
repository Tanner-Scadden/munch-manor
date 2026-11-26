import { Array, Option } from 'effect'
import { describe, expect, test } from 'vitest'

import { EVERY_LEVEL } from '#test/model.fixture.ts'
import { CLEARANCES } from '#test/testing.ts'
import type { Level } from '#world/level/arena.ts'
import { flowFieldsToward } from '#world/level/pathing.ts'
import { tileCenter, tileOfIndex } from '#world/level/tileGrid.ts'

import {
  TOLLS,
  TOLL_SETS,
  mismatchedOrigins,
  oracleSpread,
  readAll,
} from './pathing.flat.fixture.ts'

const SAMPLED: ReadonlyArray<Level> = [
  ...Array.take(EVERY_LEVEL, 2),
  ...Array.take(Array.drop(EVERY_LEVEL, 3), 1),
]

describe('the flat flow field answers as the search it replaced did', () => {
  test.each(Array.map(SAMPLED, level => [level.key, level] as const))(
    '%s: from every 241st tile, both clearances, with and without tolls',
    (_, level) => {
      for (const clearance of CLEARANCES) {
        for (const [, tolls] of TOLL_SETS) {
          expect(mismatchedOrigins(level, 241, clearance, tolls)).toEqual([])
        }
      }
    },
  )

  test.each(Array.map(EVERY_LEVEL, level => [level.key, level] as const))(
    '%s: from several players at once',
    (_, level) => {
      const places = Array.map([3, 150, 400, 700, 150], index =>
        tileCenter(tileOfIndex(level, index % level.tileCount)),
      )
      const fields = flowFieldsToward(
        level,
        [places[0]!, ...places.slice(1)],
        TOLLS,
      )
      const origins = Array.dedupe(
        Array.map(places, place =>
          Option.getOrThrow(
            Array.findFirstIndex(
              Array.makeBy(level.tileCount, index =>
                tileCenter(tileOfIndex(level, index)),
              ),
              center => center.x === place.x && center.y === place.y,
            ),
          ),
        ),
      )
      expect(fields.Narrow.moreOrigins).toEqual(origins.slice(1))
      for (const clearance of CLEARANCES) {
        expect(readAll(level, fields[clearance].distances)).toEqual(
          oracleSpread(level, origins, clearance, TOLLS),
        )
      }
    },
  )
})
