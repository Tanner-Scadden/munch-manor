import { Function } from 'effect'

import * as DetMath from '../../shared/detMath'
import { isStanding, seatStateAt } from '../party/party'
import type { World } from '../schema/world'
import type { PlayerSlot } from '../schema/worldSchema'

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
