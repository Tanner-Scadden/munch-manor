import { Array, Function } from 'effect'

import type { Level } from '#world/level/arena.ts'
import { KITCHEN_ROOM_ID } from '#world/level/plan.ts'
import { isInYardAt } from '#world/level/tileQueries.ts'
import type { Vector } from '#world/schema/worldSchema.ts'

export const KITCHEN_KEY_SCALE = 1.25

export const isInKitchenAt: {
  (point: Vector): (level: Level) => boolean
  (level: Level, point: Vector): boolean
} = Function.dual(
  2,
  (level: Level, point: Vector): boolean =>
    Array.some(
      level.rooms,
      ({ id, box, isOpen }) =>
        id === KITCHEN_ROOM_ID &&
        isOpen &&
        point.x >= box.left &&
        point.x < box.right &&
        point.y >= box.top &&
        point.y < box.bottom,
    ) && !isInYardAt(level, point),
)

export const kitchenKeyScale: {
  (point: Vector): (level: Level) => number
  (level: Level, point: Vector): number
} = Function.dual(2, (level: Level, point: Vector): number =>
  isInKitchenAt(level, point) ? KITCHEN_KEY_SCALE : 1,
)
