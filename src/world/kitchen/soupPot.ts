import { Function, Option } from 'effect'

import * as DetMath from '#shared/detMath.ts'
import { levelOf } from '#world/level/arena.ts'
import { boxCenter } from '#world/level/tileGrid.ts'
import type { World } from '#world/schema/world.ts'
import type { Vector } from '#world/schema/worldSchema.ts'
import { stationBoxOf } from '#world/stations/stationSpots.ts'
import { TOOL_RULES, isToolActive } from '#world/stations/toolRules.ts'

const RULES = TOOL_RULES.SoupPot

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
    ({ x, y, radius }) => DetMath.hypot(point.x - x, point.y - y) < radius,
  ),
)
