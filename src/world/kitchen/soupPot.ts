import { Function, Option } from 'effect'

import * as DetMath from '../../shared/detMath'
import { levelOf } from '../level/arena'
import { boxCenter } from '../level/tileGrid'
import type { World } from '../schema/world'
import type { Vector } from '../schema/worldSchema'
import { stationBoxOf } from '../stations/stationSpots'
import { TOOL_RULES, isToolActive } from '../stations/toolRules'

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
