import { Function } from 'effect'

import { COLLISION_STEP_PX } from '#shared/constants.ts'
import * as DetMath from '#shared/detMath.ts'
import {
  type Level,
  TILE_PLAYER_SOLID,
  TILE_SOLID,
} from '#world/level/arena.ts'
import { type Box, tileBox } from '#world/level/tileGrid.ts'
import { tileCoordinate } from '#world/level/tileQueries.ts'
import type { Vector } from '#world/schema/entitySchema.ts'

import { clamp, vectorLength } from './geometry.ts'

const pushOutOfBox = (position: Vector, radius: number, box: Box): Vector => {
  const { left, top, right, bottom } = box
  const deltaX = position.x - clamp(position.x, left, right)
  const deltaY = position.y - clamp(position.y, top, bottom)
  const distance = DetMath.hypot(deltaX, deltaY)

  if (distance >= radius) {
    return position
  } else if (distance > 0) {
    const push = (radius - distance) / distance
    return { x: position.x + deltaX * push, y: position.y + deltaY * push }
  }

  const toLeft = position.x - left
  const toRight = right - position.x
  const toTop = position.y - top
  const toBottom = bottom - position.y
  const nearest = Math.min(toLeft, toRight, toTop, toBottom)
  if (nearest === toLeft) {
    return { x: left - radius, y: position.y }
  } else if (nearest === toRight) {
    return { x: right + radius, y: position.y }
  } else if (nearest === toTop) {
    return { x: position.x, y: top - radius }
  } else {
    return { x: position.x, y: bottom + radius }
  }
}

type Walker = 'Zombie' | 'Player'

const solidFlagFor = (walker: Walker): number =>
  walker === 'Player' ? TILE_PLAYER_SOLID : TILE_SOLID

const resolveCircleIn = (
  level: Level,
  position: Vector,
  radius: number,
  blockers: ReadonlyArray<Box> = [],
  walker: Walker = 'Zombie',
): Vector => {
  const flag = solidFlagFor(walker)
  const firstColumn = tileCoordinate(position.x - radius)
  const lastColumn = tileCoordinate(position.x + radius)
  const lastRow = tileCoordinate(position.y + radius)
  const { leftColumn, topRow, columns, rows, tileFlags } = level
  let resolved = position
  for (let row = tileCoordinate(position.y - radius); row <= lastRow; row++) {
    const mapRow = row - topRow
    if (mapRow < 0 || mapRow >= rows) {
      continue
    }
    for (let column = firstColumn; column <= lastColumn; column++) {
      const mapColumn = column - leftColumn
      if (
        mapColumn >= 0 &&
        mapColumn < columns &&
        ((tileFlags[mapRow * columns + mapColumn] ?? 0) & flag) !== 0
      ) {
        resolved = pushOutOfBox(resolved, radius, tileBox({ column, row }))
      }
    }
  }
  for (const box of blockers) {
    resolved = pushOutOfBox(resolved, radius, box)
  }
  return resolved
}

const moveCircleIn = (
  level: Level,
  position: Vector,
  delta: Vector,
  radius: number,
  blockers: ReadonlyArray<Box> = [],
  walker: Walker = 'Zombie',
): Vector => {
  const steps = Math.max(1, Math.ceil(vectorLength(delta) / COLLISION_STEP_PX))
  const factor = 1 / steps
  const stepX = delta.x * factor
  const stepY = delta.y * factor
  let moved = position
  for (let index = 0; index < steps; index++) {
    moved = resolveCircleIn(
      level,
      { x: moved.x + stepX, y: moved.y + stepY },
      radius,
      blockers,
      walker,
    )
  }
  return moved
}

type CircleRest = [blockers?: ReadonlyArray<Box>, walker?: Walker]

export const resolveCircle: {
  (
    position: Vector,
    radius: number,
    ...rest: CircleRest
  ): (level: Level) => Vector
  (level: Level, position: Vector, radius: number, ...rest: CircleRest): Vector
} = Function.dual(
  (args: IArguments): boolean => typeof args[2] === 'number',
  resolveCircleIn,
)

export const moveCircle: {
  (
    position: Vector,
    delta: Vector,
    radius: number,
    ...rest: CircleRest
  ): (level: Level) => Vector
  (
    level: Level,
    position: Vector,
    delta: Vector,
    radius: number,
    ...rest: CircleRest
  ): Vector
} = Function.dual(
  (args: IArguments): boolean => typeof args[3] === 'number',
  moveCircleIn,
)
