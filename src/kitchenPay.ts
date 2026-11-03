import { Array } from 'effect'

import { type Level, isInYardAt } from './arena'
import type { Vector } from './worldSchema'

// Kitchen kill pay (owner, 2026-11-02): a zombie killed standing on a
// kitchen tile pays a quarter more, rounded, so the room is worth the walk.
// Every kill's pay reads its bounty through here (`bountyOf` in
// src/combat.ts and the bullets' pay in src/hits.ts), and the kill popup
// and its sparkle read the same rule, so they always agree.

export const KITCHEN_PAY_SCALE = 1.25

// NOTE: the kitchen's room id in the level spec (src/arena.ts), the name of
// the exit that opens it.
const KITCHEN_ROOM_ID = 'Kitchen'

// NOTE: on a kitchen tile: inside the kitchen's room while its exit is
// open, and not out in the yard beside it.
export const isInKitchenAt = (level: Level, point: Vector): boolean =>
  Array.some(
    level.rooms,
    ({ id, box, isOpen }) =>
      id === KITCHEN_ROOM_ID &&
      isOpen &&
      point.x >= box.left &&
      point.x < box.right &&
      point.y >= box.top &&
      point.y < box.bottom,
  ) && !isInYardAt(level, point)

// NOTE: what a kill at `point` pays before the killer's calling and the
// run's modifiers have their say.
export const kitchenBounty = (
  level: Level,
  point: Vector,
  bounty: number,
): number =>
  isInKitchenAt(level, point) ? Math.round(bounty * KITCHEN_PAY_SCALE) : bounty
