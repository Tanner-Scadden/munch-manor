import { Array, Function } from 'effect'

import type { Level } from '../level/arena'
import { KITCHEN_ROOM_ID } from '../level/plan'
import { isInYardAt } from '../level/tileQueries'
import type { Vector } from '../schema/worldSchema'

// Kitchen key odds: kill pay once paid a quarter more on a kitchen tile
// (owner, 2026-11-02), so the room was worth the walk. With money gone
// (docs/ESCAPE_PLAN.md, layer 7) a zombie killed on a kitchen tile drops
// keys a quarter more often instead (src/world/keys/keys.ts), and the
// key's sparkle reads the same rule, so they always agree.

export const KITCHEN_KEY_SCALE = 1.25

// NOTE: on a kitchen tile: inside the kitchen's room while its exit is
// open, and not out in the yard beside it.
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

// NOTE: how much likelier a kill at `point` drops a key.
export const kitchenKeyScale: {
  (point: Vector): (level: Level) => number
  (level: Level, point: Vector): number
} = Function.dual(2, (level: Level, point: Vector): number =>
  isInKitchenAt(level, point) ? KITCHEN_KEY_SCALE : 1,
)
