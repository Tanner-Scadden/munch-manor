import { Array, Option, pipe } from 'effect'
import { describe, expect, test } from 'vitest'

import {
  DOOR_SYMBOLS,
  type Level,
  TILE_DOOR,
  TILE_OPEN_BLOCK,
  TILE_OUTSIDE,
  TILE_PLAYER_SOLID,
  TILE_SOLID,
  findReach,
  findStrike,
  hasClearPath,
  hasLineOfSight,
  hasTileFlag,
  isDoorTile,
  isInYardAt,
  isInsideRoom,
  isInsideRoomAt,
  isOpenBlock,
  isSolidAt,
  isWalkableTile,
  moveCircle,
  resolveCircle,
  tileIndex,
  tilesWithSymbol,
} from './arena'
import { BULLET_STEP_PX, COLLISION_STEP_PX, LINE_OF_SIGHT_STEP_PX } from './constants'
import { addVectors, scaleVector, vectorLength } from './geometry'
import { EVERY_LEVEL } from './model.fixture'
import type { Vector } from './worldSchema'

// NOTE: the array-building versions the flat loops replaced, kept here as
// the oracle: they must answer exactly as the loops do.
const pointsAlong = (from: Vector, to: Vector, stepPx: number): ReadonlyArray<Vector> => {
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / stepPx))
  return Array.makeBy(steps + 1, index => ({
    x: from.x + ((to.x - from.x) * index) / steps,
    y: from.y + ((to.y - from.y) * index) / steps,
  }))
}

const oracleStrike = (level: Level, from: Vector, to: Vector): Option.Option<Vector> => {
  const points = pointsAlong(from, to, BULLET_STEP_PX)
  return pipe(
    points,
    Array.findFirstIndex(point => isSolidAt(level, point)),
    Option.map(index => Option.getOrElse(Array.get(points, Math.max(0, index - 1)), () => from)),
  )
}

const oracleReach = (level: Level, from: Vector, to: Vector): Vector => {
  const points = pointsAlong(from, to, BULLET_STEP_PX)
  return pipe(
    points,
    Array.findFirstIndex(point => isSolidAt(level, point) || !isInsideRoomAt(level, point)),
    Option.flatMap(index => Array.get(points, Math.max(0, index - 1))),
    Option.getOrElse(() => to),
  )
}

const oracleLane = (level: Level, from: Vector, to: Vector): boolean =>
  !Array.some(pointsAlong(from, to, LINE_OF_SIGHT_STEP_PX), point => isSolidAt(level, point))

const oracleClearPath = (level: Level, from: Vector, to: Vector, halfWidth: number): boolean => {
  const length = Math.hypot(to.x - from.x, to.y - from.y)
  if (length <= 0) {
    return !isSolidAt(level, from)
  }
  const side = {
    x: (-(to.y - from.y) / length) * halfWidth,
    y: ((to.x - from.x) / length) * halfWidth,
  }
  return (
    oracleLane(level, from, to) &&
    oracleLane(level, addVectors(from, side), addVectors(to, side)) &&
    oracleLane(level, addVectors(from, scaleVector(side, -1)), addVectors(to, scaleVector(side, -1)))
  )
}

const seeded = (seed: number) => {
  let state = seed
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
}

describe('tile flags', () => {
  test.each(EVERY_LEVEL.map(level => [level.key, level] as const))('%s: every tile agrees with the others', (_, level) => {
    const disagreements: Array<string> = []
    for (let row = level.topRow - 1; row <= level.topRow + level.rows; row++) {
      for (let column = -1; column <= level.columns; column++) {
        const index = tileIndex(level, column, row)
        const inside = isInsideRoom(level, column, row)
        const solid = hasTileFlag(level, index, TILE_SOLID)
        const flagged = (flag: number) => hasTileFlag(level, index, flag)
        const block = [0, 1].every(down =>
          [0, 1].every(across => isWalkableTile(level, column + across, row + down)),
        )
        const checks: ReadonlyArray<readonly [string, boolean]> = [
          ['walkable', isWalkableTile(level, column, row) === (inside && !solid)],
          // the player is stopped by every solid tile and by the yard
          ['player solid', !inside || flagged(TILE_PLAYER_SOLID) === (solid || flagged(TILE_OUTSIDE))],
          ['open block', !inside || (isOpenBlock(level, column, row) === block && flagged(TILE_OPEN_BLOCK) === block)],
          ['door', !inside || isDoorTile(level, column, row) === flagged(TILE_DOOR)],
          ['yard', !inside || isInYardAt(level, { x: column * 10 + 5, y: row * 10 + 5 }) === flagged(TILE_OUTSIDE)],
        ]
        for (const [name, holds] of checks) {
          if (!holds) {
            disagreements.push(`${name} at ${column},${row}`)
          }
        }
      }
    }
    expect(disagreements).toEqual([])
  })

  test.each(EVERY_LEVEL.map(level => [level.key, level] as const))('%s: door tiles are the held-open doors symbols', (_, level) => {
    const symbols = level.doorIds.map(id => DOOR_SYMBOLS[id])
    const expected = symbols.flatMap(symbol => tilesWithSymbol(level, symbol)).map(({ column, row }) => tileIndex(level, column, row))
    const flagged = Array.range(0, level.tileCount - 1).filter(index => hasTileFlag(level, index, TILE_DOOR))
    expect(flagged).toEqual([...expected].sort((a, b) => a - b))
  })
})

describe('flat rays and collision answer as the array versions did', () => {
  test.each(EVERY_LEVEL.map(level => [level.key, level] as const))('%s: line of sight, clear path, strikes, reach', (_, level) => {
    const random = seeded(7)
    const point = (): Vector => ({
      x: -20 + random() * (level.width + 40),
      y: level.top - 20 + random() * (level.height + 40),
    })
    for (let probe = 0; probe < 1500; probe++) {
      const from = point()
      const to = random() < 0.5 ? point() : { x: from.x + (random() - 0.5) * 120, y: from.y + (random() - 0.5) * 120 }
      expect(hasLineOfSight(level, from, to)).toBe(oracleLane(level, from, to))
      expect(hasClearPath(level, from, to, 4)).toBe(oracleClearPath(level, from, to, 4))
      expect(findStrike(level, from, to)).toEqual(oracleStrike(level, from, to))
      expect(findReach(level, from, to)).toEqual(oracleReach(level, from, to))
    }
    expect(hasClearPath(level, { x: 30, y: 30 }, { x: 30, y: 30 }, 4)).toBe(
      oracleClearPath(level, { x: 30, y: 30 }, { x: 30, y: 30 }, 4),
    )
  })

  test.each(EVERY_LEVEL.map(level => [level.key, level] as const))('%s: moving a circle is resolving it step by step', (_, level) => {
    const random = seeded(11)
    for (let probe = 0; probe < 1500; probe++) {
      const at = { x: random() * level.width, y: level.top + random() * level.height }
      const walker = random() < 0.5 ? 'Zombie' : 'Player'
      const delta = { x: (random() - 0.5) * 8, y: (random() - 0.5) * 8 }
      const steps = Math.max(1, Math.ceil(vectorLength(delta) / COLLISION_STEP_PX))
      const part = scaleVector(delta, 1 / steps)
      const expected = Array.reduce(Array.makeBy(steps, () => part), at, (moved, step) =>
        resolveCircle(level, addVectors(moved, step), 5, [], walker),
      )
      expect(moveCircle(level, at, delta, 5, [], walker)).toEqual(expected)
    }
  })

  test('a circle in a solid tile is pushed out of it, a player out of the yard too', () => {
    const level = EVERY_LEVEL[0]!
    const wall = Array.range(0, level.tileCount - 1).find(index => hasTileFlag(level, index, TILE_SOLID))!
    const at = { x: (wall % level.columns) * 10 + 5, y: (Math.floor(wall / level.columns) + level.topRow) * 10 + 5 }
    expect(resolveCircle(level, at, 4)).not.toEqual(at)
  })
})
