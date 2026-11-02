import { Array, Option, Result } from 'effect'
import { describe, expect, test } from 'vitest'

import {
  type Level,
  isOpenBlock,
  isWalkableTile,
  tileCenter,
  tileIndex,
  tileOfIndex,
} from './arena'
import {
  type Clearance,
  UNREACHED_DISTANCE,
  distanceAt,
  flowFieldToward,
  flowFieldsToward,
} from './pathing'
import { EVERY_LEVEL } from './model.fixture'
import type { Toll } from './worldSchema'

// NOTE: the search the flat one replaced, kept as the oracle: neighbors in
// arrays of arrays, buckets in a Map, one ring settled after another.
const STRAIGHT = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const

const isOpen = (
  level: Level,
  clearance: Clearance,
  column: number,
  row: number,
  [stepColumn, stepRow]: readonly [number, number],
): boolean => {
  if (clearance === 'Narrow') {
    return (
      isWalkableTile(level, column + stepColumn, row + stepRow) &&
      (stepColumn === 0 ||
        stepRow === 0 ||
        (isWalkableTile(level, column + stepColumn, row) &&
          isWalkableTile(level, column, row + stepRow)))
    )
  }
  const left = Math.min(column, column + stepColumn)
  const top = Math.min(row, row + stepRow)
  return stepRow === 0
    ? isOpenBlock(level, left, row - 1) || isOpenBlock(level, left, row)
    : isOpenBlock(level, column - 1, top) || isOpenBlock(level, column, top)
}

const neighborsOf = (
  level: Level,
  index: number,
  clearance: Clearance,
): ReadonlyArray<number> => {
  const { column, row } = tileOfIndex(level, index)
  return Array.filterMap(STRAIGHT, step =>
    isOpen(level, clearance, column, row, step)
      ? Result.succeed(tileIndex(level, column + step[0], row + step[1]))
      : Result.failVoid,
  )
}

const oracleSpread = (
  level: Level,
  origins: ReadonlyArray<number>,
  clearance: Clearance,
  tolls: ReadonlyArray<Toll>,
): ReadonlyArray<number> => {
  const tollMap = new Map(tolls.map(({ index, cost }) => [index, cost]))
  const distances = Array.makeBy(level.tileCount, () => UNREACHED_DISTANCE)
  const buckets = new Map<number, Array<number>>([[0, [...origins]]])
  let depth = 0
  while (buckets.size > 0) {
    depth = Math.min(...buckets.keys())
    const ring = buckets.get(depth) ?? []
    buckets.delete(depth)
    for (const index of ring) {
      if (distances[index] !== UNREACHED_DISTANCE) {
        continue
      }
      distances[index] = depth
      for (const neighbor of neighborsOf(
        level,
        index,
        depth === 0 ? 'Narrow' : clearance,
      )) {
        if (distances[neighbor] === UNREACHED_DISTANCE) {
          const at = depth + 1 + (tollMap.get(neighbor) ?? 0)
          buckets.set(at, [...(buckets.get(at) ?? []), neighbor])
        }
      }
    }
  }
  return distances
}

const readAll = (level: Level, distances: Int32Array): ReadonlyArray<number> =>
  Array.makeBy(level.tileCount, index => distanceAt(distances, index))

const TOLLS: ReadonlyArray<Toll> = [
  { index: 300, cost: 25 },
  { index: 301, cost: 25 },
  { index: 410, cost: 6 },
  { index: 410, cost: 9 },
  { index: -4, cost: 6 },
]

describe('the flat flow field answers as the search it replaced did', () => {
  test.each(EVERY_LEVEL.map(level => [level.key, level] as const))(
    '%s: from every seventh tile, both clearances, with and without tolls',
    (_, level) => {
      for (const clearance of ['Narrow', 'Wide'] as const) {
        for (let origin = 0; origin < level.tileCount; origin += 7) {
          const target = tileCenter(tileOfIndex(level, origin))
          for (const tolls of [[], TOLLS]) {
            const field = flowFieldToward(level, target, clearance, tolls)
            expect(field.originIndex).toBe(origin)
            expect(readAll(level, field.distances)).toEqual(
              oracleSpread(level, [origin], clearance, tolls),
            )
          }
        }
      }
    },
  )

  test.each(EVERY_LEVEL.map(level => [level.key, level] as const))(
    '%s: from several players at once',
    (_, level) => {
      const places = [3, 150, 400, 700, 150].map(index =>
        tileCenter(tileOfIndex(level, index % level.tileCount)),
      )
      const fields = flowFieldsToward(level, [places[0]!, ...places.slice(1)], TOLLS)
      const origins = Array.dedupe(
        places.map(place =>
          Option.getOrThrow(
            Array.findFirstIndex(
              Array.makeBy(level.tileCount, index => tileCenter(tileOfIndex(level, index))),
              center => center.x === place.x && center.y === place.y,
            ),
          ),
        ),
      )
      expect(fields.Narrow.moreOrigins).toEqual(origins.slice(1))
      for (const clearance of ['Narrow', 'Wide'] as const) {
        expect(readAll(level, fields[clearance].distances)).toEqual(
          oracleSpread(level, origins, clearance, TOLLS),
        )
      }
    },
  )
})
