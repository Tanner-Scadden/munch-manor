import { Array, Function, Option } from 'effect'

import {
  BULLET_STEP_PX,
  LINE_OF_SIGHT_STEP_PX,
  TILE_SIZE,
  ZOMBIE_SPAWN_MARGIN,
} from '../../shared/constants'
import * as DetMath from '../../shared/detMath'
import type { DoorId, Vector } from '../schema/entitySchema'
import { clamp } from '../step/geometry'
import {
  type Door,
  type Level,
  TILE_DOOR,
  TILE_OPEN_BLOCK,
  TILE_OUTSIDE,
  TILE_SOLID,
  TILE_SOUP,
  hasTileFlag,
} from './arena'
import { isInsideRoom, tileIndex } from './tileGrid'

export const isWalkableTile: {
  (column: number, row: number): (level: Level) => boolean
  (level: Level, column: number, row: number): boolean
} = Function.dual(
  3,
  (level: Level, column: number, row: number): boolean =>
    isInsideRoom(level, column, row) &&
    !hasTileFlag(level, tileIndex(level, column, row), TILE_SOLID),
)

const isSolidTile = (level: Level, column: number, row: number): boolean =>
  isInsideRoom(level, column, row) &&
  hasTileFlag(level, tileIndex(level, column, row), TILE_SOLID)

export const isOpenBlock: {
  (column: number, row: number): (level: Level) => boolean
  (level: Level, column: number, row: number): boolean
} = Function.dual(
  3,
  (level: Level, column: number, row: number): boolean =>
    isInsideRoom(level, column, row) &&
    hasTileFlag(level, tileIndex(level, column, row), TILE_OPEN_BLOCK),
)

export const tileCoordinate = (position: number): number =>
  Math.floor(position / TILE_SIZE)

export const isSolidAt: {
  (arg1: Vector): (level: Level) => boolean
  (level: Level, arg1: Vector): boolean
} = Function.dual(2, (level: Level, { x, y }: Vector): boolean =>
  isSolidTile(level, tileCoordinate(x), tileCoordinate(y)),
)

const isOutsideTile = (level: Level, column: number, row: number): boolean =>
  hasTileFlag(level, tileIndex(level, column, row), TILE_OUTSIDE)

export const isInsideRoomAt: {
  (arg1: Vector): (level: Level) => boolean
  (level: Level, arg1: Vector): boolean
} = Function.dual(2, (level: Level, { x, y }: Vector): boolean =>
  isInsideRoomPoint(level, x, y),
)

export const isInYardAt: {
  (arg1: Vector): (level: Level) => boolean
  (level: Level, arg1: Vector): boolean
} = Function.dual(2, (level: Level, { x, y }: Vector): boolean => {
  const column = tileCoordinate(x)
  const row = tileCoordinate(y)
  return isInsideRoom(level, column, row) && isOutsideTile(level, column, row)
})

export const isOnSoupAt: {
  (arg1: Vector): (level: Level) => boolean
  (level: Level, arg1: Vector): boolean
} = Function.dual(2, (level: Level, { x, y }: Vector): boolean => {
  const column = tileCoordinate(x)
  const row = tileCoordinate(y)
  return (
    isInsideRoom(level, column, row) &&
    hasTileFlag(level, tileIndex(level, column, row), TILE_SOUP)
  )
})

export const tileIndexAt: {
  (arg1: Vector): (level: Level) => number
  (level: Level, arg1: Vector): number
} = Function.dual(2, (level: Level, { x, y }: Vector): number =>
  tileIndex(
    level,
    clamp(
      tileCoordinate(x),
      level.leftColumn,
      level.leftColumn + level.columns - 1,
    ),
    clamp(tileCoordinate(y), level.topRow, level.topRow + level.rows - 1),
  ),
)

export const isDoorTile: {
  (column: number, row: number): (level: Level) => boolean
  (level: Level, column: number, row: number): boolean
} = Function.dual(
  3,
  (level: Level, column: number, row: number): boolean =>
    isInsideRoom(level, column, row) &&
    hasTileFlag(level, tileIndex(level, column, row), TILE_DOOR),
)

export const doorSpawnPoint: {
  (id: DoorId, offset: number): (level: Level) => Vector
  (level: Level, id: DoorId, offset: number): Vector
} = Function.dual(3, (level: Level, id: DoorId, offset: number): Vector => {
  const { edge, outward } = level.doors[id]
  return {
    x: edge.x + outward.x * ZOMBIE_SPAWN_MARGIN - outward.y * offset,
    y: edge.y + outward.y * ZOMBIE_SPAWN_MARGIN + outward.x * offset,
  }
})

const distanceSquared = (first: Vector, second: Vector): number => {
  const dx = first.x - second.x
  const dy = first.y - second.y
  return dx * dx + dy * dy
}

export const nearestDoor: {
  (position: Vector): (level: Level) => Door
  (level: Level, position: Vector): Door
} = Function.dual(2, (level: Level, position: Vector): Door =>
  Array.reduce(
    Array.map(level.doorIds, id => level.doors[id]),
    level.doors[
      Option.getOrElse(Array.head(level.doorIds), (): DoorId => 'North')
    ],
    (nearest, door) =>
      distanceSquared(door.center, position) <
      distanceSquared(nearest.center, position)
        ? door
        : nearest,
  ),
)

const stepsAlong = (from: Vector, to: Vector, stepPx: number): number =>
  Math.max(1, Math.ceil(DetMath.hypot(to.x - from.x, to.y - from.y) / stepPx))

const isSolidPoint = (level: Level, x: number, y: number): boolean =>
  isSolidTile(level, tileCoordinate(x), tileCoordinate(y))

const isInsideRoomPoint = (level: Level, x: number, y: number): boolean => {
  const column = tileCoordinate(x)
  const row = tileCoordinate(y)
  return isInsideRoom(level, column, row) && !isOutsideTile(level, column, row)
}

export const findStrike: {
  (from: Vector, to: Vector): (level: Level) => Option.Option<Vector>
  (level: Level, from: Vector, to: Vector): Option.Option<Vector>
} = Function.dual(
  3,
  (level: Level, from: Vector, to: Vector): Option.Option<Vector> => {
    const steps = stepsAlong(from, to, BULLET_STEP_PX)
    const dx = to.x - from.x
    const dy = to.y - from.y
    for (let index = 0; index <= steps; index++) {
      if (
        isSolidPoint(
          level,
          from.x + (dx * index) / steps,
          from.y + (dy * index) / steps,
        )
      ) {
        const before = Math.max(0, index - 1)
        return Option.some({
          x: from.x + (dx * before) / steps,
          y: from.y + (dy * before) / steps,
        })
      }
    }
    return Option.none()
  },
)

export const findReach: {
  (from: Vector, to: Vector): (level: Level) => Vector
  (level: Level, from: Vector, to: Vector): Vector
} = Function.dual(3, (level: Level, from: Vector, to: Vector): Vector => {
  const steps = stepsAlong(from, to, BULLET_STEP_PX)
  const dx = to.x - from.x
  const dy = to.y - from.y
  for (let index = 0; index <= steps; index++) {
    const x = from.x + (dx * index) / steps
    const y = from.y + (dy * index) / steps
    if (isSolidPoint(level, x, y) || !isInsideRoomPoint(level, x, y)) {
      const before = Math.max(0, index - 1)
      return {
        x: from.x + (dx * before) / steps,
        y: from.y + (dy * before) / steps,
      }
    }
  }
  return to
})

const isAnySolidIn = (
  level: Level,
  firstColumn: number,
  firstRow: number,
  lastColumn: number,
  lastRow: number,
): boolean => {
  const width = level.columns + 1
  const left = Math.max(0, firstColumn - level.leftColumn)
  const top = Math.max(0, firstRow - level.topRow)
  const right = Math.min(level.columns, lastColumn - level.leftColumn + 1)
  const bottom = Math.min(level.rows, lastRow - level.topRow + 1)
  if (left >= right || top >= bottom) {
    return false
  }
  const sums = level.solidSums
  return (
    (sums[bottom * width + right] ?? 0) -
      (sums[top * width + right] ?? 0) -
      (sums[bottom * width + left] ?? 0) +
      (sums[top * width + left] ?? 0) >
    0
  )
}

const isLaneClear = (
  level: Level,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): boolean => {
  const fromColumn = tileCoordinate(fromX)
  const fromRow = tileCoordinate(fromY)
  const toColumn = tileCoordinate(toX)
  const toRow = tileCoordinate(toY)
  if (
    !isAnySolidIn(
      level,
      Math.min(fromColumn, toColumn) - 1,
      Math.min(fromRow, toRow) - 1,
      Math.max(fromColumn, toColumn) + 1,
      Math.max(fromRow, toRow) + 1,
    )
  ) {
    return true
  }
  const steps = Math.max(
    1,
    Math.ceil(DetMath.hypot(toX - fromX, toY - fromY) / LINE_OF_SIGHT_STEP_PX),
  )
  const dx = toX - fromX
  const dy = toY - fromY
  const { leftColumn, topRow, columns, rows, tileFlags } = level
  let lastColumn = Number.NaN
  let lastRow = Number.NaN
  for (let index = 0; index <= steps; index++) {
    const column = tileCoordinate(fromX + (dx * index) / steps) - leftColumn
    const row = tileCoordinate(fromY + (dy * index) / steps) - topRow
    if (column !== lastColumn || row !== lastRow) {
      if (
        column >= 0 &&
        column < columns &&
        row >= 0 &&
        row < rows &&
        ((tileFlags[row * columns + column] ?? 0) & TILE_SOLID) !== 0
      ) {
        return false
      }
      lastColumn = column
      lastRow = row
    }
  }
  return true
}

export const hasLineOfSight: {
  (from: Vector, to: Vector): (level: Level) => boolean
  (level: Level, from: Vector, to: Vector): boolean
} = Function.dual(3, (level: Level, from: Vector, to: Vector): boolean =>
  isLaneClear(level, from.x, from.y, to.x, to.y),
)

export const hasClearPath: {
  (from: Vector, to: Vector, halfWidth: number): (level: Level) => boolean
  (level: Level, from: Vector, to: Vector, halfWidth: number): boolean
} = Function.dual(
  4,
  (level: Level, from: Vector, to: Vector, halfWidth: number): boolean => {
    const length = DetMath.hypot(to.x - from.x, to.y - from.y)
    if (length <= 0) {
      return !isSolidAt(level, from)
    }

    const sideX = (-(to.y - from.y) / length) * halfWidth
    const sideY = ((to.x - from.x) / length) * halfWidth
    return (
      isLaneClear(level, from.x, from.y, to.x, to.y) &&
      isLaneClear(
        level,
        from.x + sideX,
        from.y + sideY,
        to.x + sideX,
        to.y + sideY,
      ) &&
      isLaneClear(
        level,
        from.x - sideX,
        from.y - sideY,
        to.x - sideX,
        to.y - sideY,
      )
    )
  },
)
