// The flat flow field's tests' shared setup: the search it replaced, kept as
// the oracle, and the check that a field matches it. pathing.flat.test.ts
// runs it on a few levels, and the two pathing.flat.*.sim.test.ts files on
// every one, a clearance each.

import { Array, Equivalence, Function, Result } from 'effect'
import { describe, expect, test } from 'vitest'

import { EVERY_LEVEL } from '../../../test/model.fixture'
import type { Toll } from '../../schema/worldSchema'
import { type Level, TILE_OUTSIDE, hasTileFlag } from '../arena'
import {
  type Clearance,
  UNREACHED_DISTANCE,
  distanceAt,
  flowFieldToward,
  isFieldTile,
} from '../pathing'
import { tileCenter, tileIndex, tileOfIndex } from '../tileGrid'
import { isOpenBlock, isWalkableTile } from '../tileQueries'

// NOTE: the search the flat one replaced, kept as the oracle: neighbors in
// arrays of arrays, buckets in a Map, one ring settled after another. The
// yard is one way, as in pathing.ts: a yard tile never hands its distance
// to a house tile, since no zombie steps from the house out into the yard.
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
    isFieldTile(level, column, row) &&
    isFieldTile(level, column + step[0], row + step[1]) &&
    isOpen(level, clearance, column, row, step) &&
    (!hasTileFlag(level, index, TILE_OUTSIDE) ||
      hasTileFlag(
        level,
        tileIndex(level, column + step[0], row + step[1]),
        TILE_OUTSIDE,
      ))
      ? Result.succeed(tileIndex(level, column + step[0], row + step[1]))
      : Result.failVoid,
  )
}

export const oracleSpread: {
  (
    origins: ReadonlyArray<number>,
    clearance: Clearance,
    tolls: ReadonlyArray<Toll>,
  ): (level: Level) => ReadonlyArray<number>
  (
    level: Level,
    origins: ReadonlyArray<number>,
    clearance: Clearance,
    tolls: ReadonlyArray<Toll>,
  ): ReadonlyArray<number>
} = Function.dual(
  4,
  (
    level: Level,
    origins: ReadonlyArray<number>,
    clearance: Clearance,
    tolls: ReadonlyArray<Toll>,
  ): ReadonlyArray<number> => {
    const tollMap = new Map(
      Array.map(tolls, ({ index, cost }) => [index, cost]),
    )
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
  },
)

export const readAll: {
  (distances: Int32Array): (level: Level) => ReadonlyArray<number>
  (level: Level, distances: Int32Array): ReadonlyArray<number>
} = Function.dual(
  2,
  (level: Level, distances: Int32Array): ReadonlyArray<number> =>
    Array.makeBy(level.tileCount, index => distanceAt(distances, index)),
)

export const TOLLS: ReadonlyArray<Toll> = [
  { index: 300, cost: 25 },
  { index: 301, cost: 25 },
  { index: 410, cost: 6 },
  { index: 410, cost: 9 },
  { index: -4, cost: 6 },
]

export const TOLL_SETS = [
  ['no tolls', []],
  ['tolls', TOLLS],
] as const satisfies ReadonlyArray<readonly [string, ReadonlyArray<Toll>]>

const SAME_DISTANCES = Array.makeEquivalence(Equivalence.strictEqual<number>())

// NOTE: the origins, every `stride`th tile, whose flat field differs from
// the oracle's: a field that starts on another tile, or any distance that
// differs. A test expects none.
export const mismatchedOrigins: {
  (
    stride: number,
    clearance: Clearance,
    tolls: ReadonlyArray<Toll>,
  ): (level: Level) => ReadonlyArray<number>
  (
    level: Level,
    stride: number,
    clearance: Clearance,
    tolls: ReadonlyArray<Toll>,
  ): ReadonlyArray<number>
} = Function.dual(
  4,
  (
    level: Level,
    stride: number,
    clearance: Clearance,
    tolls: ReadonlyArray<Toll>,
  ): ReadonlyArray<number> =>
    Array.filter(
      Array.makeBy(Math.ceil(level.tileCount / stride), step => step * stride),
      origin => {
        const target = tileCenter(tileOfIndex(level, origin))
        const field = flowFieldToward(level, target, clearance, tolls)
        return (
          field.originIndex !== origin ||
          !SAME_DISTANCES(
            readAll(level, field.distances),
            oracleSpread(level, [origin], clearance, tolls),
          )
        )
      },
    ),
)

// NOTE: every level, each house with its exits shut and open, from every
// seventh tile, for one clearance. A full house takes about 9 s over both
// clearances and both toll sets, so each pair is its own test, well inside
// the timeout on a busy CI runner, and the files run in the full tier only.
export const checkEveryLevel = (clearance: Clearance): void => {
  const cases = Array.flatMap(EVERY_LEVEL, level =>
    Array.map(
      TOLL_SETS,
      ([name, tolls]) => [level.key, name, level, tolls] as const,
    ),
  )
  describe(`the flat flow field answers as the search it replaced did, ${clearance}`, () => {
    test.each(cases)(
      '%s: from every seventh tile, %s',
      (_key, _name, level, tolls) => {
        expect(mismatchedOrigins(level, 7, clearance, tolls)).toEqual([])
      },
    )
  })
}
