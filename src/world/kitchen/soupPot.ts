import { Function, Option } from 'effect'

import { levelOf } from '../level/arena'
import { boxCenter } from '../level/tileGrid'
import type { World } from '../schema/world'
import type { Vector } from '../schema/worldSchema'
import { stationBoxOf } from '../stations/stationSpots'
import { TOOL_RULES, isToolActive } from '../stations/toolRules'

// The kitchen's soup pot (docs/ROOM_RESEARCH.md, "The kitchen: HEAT AND
// SLIP"), a room tool. Worked (a still player at the pot below the ovens,
// src/world/stations/stations.ts), it tips over: a fresh puddle of soup
// spills in front of it for a while, and a zombie that steps in from dry
// floor slips on it as on the kitchen's old soup (src/world/kitchen/
// kitchen.ts): skids on and lies dazed a moment. Skid them into the ovens'
// flames. Big Lugs, Ankle Biters, and Uncle Chunk keep their feet, as on
// any soup. The puddle is read off its station's clock.

const RULES = TOOL_RULES.SoupPot

// NOTE: the puddle while the pot's tool is active: its middle and size.
export type Puddle = Readonly<{ x: number; y: number; radius: number }>

export const puddleOf = (world: World): Option.Option<Puddle> =>
  isToolActive(world, 'SoupPot')
    ? Option.map(stationBoxOf(levelOf(world), 'SoupPot'), box => {
        const { x, y } = boxCenter(box)
        return { x, y: y + RULES.spillDownPx, radius: RULES.radiusPx }
      })
    : Option.none()

export const isInPuddle: {
  (puddle: Option.Option<Puddle>): (point: Vector) => boolean
  (point: Vector, puddle: Option.Option<Puddle>): boolean
} = Function.dual(2, (point: Vector, puddle: Option.Option<Puddle>): boolean =>
  Option.exists(
    puddle,
    ({ x, y, radius }) => Math.hypot(point.x - x, point.y - y) < radius,
  ),
)
