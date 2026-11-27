import { Function } from 'effect'

import * as DetMath from '#shared/detMath.ts'
import { isStanding, seatStateAt } from '#world/party/party.ts'
import type { World } from '#world/schema/world.ts'
import type { PlayerSlot } from '#world/schema/worldSchema.ts'

const STILL_MOVE = 0.2

export const DRAIN_SCALE = 0.5

export const isStill: {
  (slot: PlayerSlot): (world: World) => boolean
  (world: World, slot: PlayerSlot): boolean
} = Function.dual(2, (world: World, slot: PlayerSlot): boolean => {
  const { intent, seat } = seatStateAt(world, slot)
  return (
    isStanding(seat) &&
    DetMath.hypot(intent.move.x, intent.move.y) <= STILL_MOVE
  )
})
