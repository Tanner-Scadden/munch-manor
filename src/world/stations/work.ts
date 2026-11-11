import { Function } from 'effect'

import { isStanding, seatStateAt } from '../party/party'
import type { World } from '../schema/world'
import type { PlayerSlot } from '../schema/worldSchema'

// The work every set-up shares: a room tool's station
// (src/world/stations/stations.ts) and a room's find
// (src/world/dare/finds.ts). A standing player who keeps still works what
// they stand at; unworked, the work runs down at half its pace.

// NOTE: the stick's tilt under which a player still counts as standing.
const STILL_MOVE = 0.2

// NOTE: the share of the set-up pace work drains at, unworked.
export const DRAIN_SCALE = 0.5

// NOTE: a standing player keeping still, as work at a station or a find
// asks.
export const isStill: {
  (slot: PlayerSlot): (world: World) => boolean
  (world: World, slot: PlayerSlot): boolean
} = Function.dual(2, (world: World, slot: PlayerSlot): boolean => {
  const { intent, seat } = seatStateAt(world, slot)
  return (
    isStanding(seat) && Math.hypot(intent.move.x, intent.move.y) <= STILL_MOVE
  )
})
