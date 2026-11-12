import { Function, Option } from 'effect'

import { TILE_SIZE } from '../../shared/constants'
import { type Level, levelOf } from '../level/arena'
import { boxCenter } from '../level/tileGrid'
import { isSolidAt, tileCoordinate } from '../level/tileQueries'
import type { World } from '../schema/world'
import type { Vector } from '../schema/worldSchema'
import { knockDownWhere } from '../stations/knockDown'
import { stationBoxOf } from '../stations/stationSpots'
import { TOOL_RULES, isToolActive, toolActiveMs } from '../stations/toolRules'
import { bodyRadiusOf, isFree, isGrounded } from '../zombies/zombies'
import { cellarBoxOf } from './bulb'

// The cellar's barrels (docs/ROOM_RESEARCH.md, "The cellar: ROLL THE
// BARREL"), a room tool. Worked (a still player at the barrel block's west
// face, src/world/stations/stations.ts), one barrel rolls west down the
// corridor like a bowling ball, knocking over every zombie on its feet that
// it meets: hurt, knocked on along the lane, and dazed. It breaks on the
// far wall in a splash of old wine. It rolls through players without a
// bump. Where it is is read off its station's clock, so it needs no field of
// its own on the wire.

const RULES = TOOL_RULES.Barrels

const WEST: Vector = { x: -1, y: 0 }

// NOTE: the lane: where the barrel sets off (the station's middle, on the
// line between the corridor's two rows), and where it breaks (the first
// solid tile west in either row, or the cellar's west wall).
export type Lane = Readonly<{ startX: number; endX: number; y: number }>

const lanes = new WeakMap<Level, Option.Option<Lane>>()

const laneIn = (level: Level): Option.Option<Lane> =>
  Option.flatMap(stationBoxOf(level, 'Barrels'), box =>
    Option.map(cellarBoxOf(level), cellar => {
      const y = box.top
      const startX = boxCenter(box).x
      const westmost = tileCoordinate(cellar.left)
      const isBlocked = (column: number): boolean =>
        column <= westmost ||
        isSolidAt(level, { x: column * TILE_SIZE + 1, y: y - 1 }) ||
        isSolidAt(level, { x: column * TILE_SIZE + 1, y: y + 1 })
      const findWall = (column: number): number =>
        isBlocked(column) ? column : findWall(column - 1)
      return {
        startX,
        endX:
          (findWall(tileCoordinate(startX) - 1) + 1) * TILE_SIZE +
          RULES.radiusPx,
        y,
      }
    }),
  )

// NOTE: a level keeps its lane.
const laneOf = (level: Level): Option.Option<Lane> => {
  const cached = lanes.get(level)
  if (cached !== undefined) {
    return cached
  }
  const lane = laneIn(level)
  lanes.set(level, lane)
  return lane
}

const xAt = (lane: Lane, rolledMs: number): number =>
  Math.max(lane.endX, lane.startX - (RULES.rollSpeed * rolledMs) / 1000)

// NOTE: the barrel while its tool is active: where it is, and whether it
// still rolls or lies broken at the lane's end.
export type Barrel = Readonly<{ x: number; y: number; isBroken: boolean }>

export const barrelOf = (world: World): Option.Option<Barrel> =>
  isToolActive(world, 'Barrels')
    ? Option.map(laneOf(levelOf(world)), lane => {
        const x = xAt(lane, toolActiveMs(world, 'Barrels'))
        return { x, y: lane.y, isBroken: x <= lane.endX }
      })
    : Option.none()

// NOTE: one tick of a rolling barrel: every zombie on its feet that the
// barrel swept past this tick is bowled over.
export const rollBarrel: {
  (deltaMs: number): (world: World) => World
  (world: World, deltaMs: number): World
} = Function.dual(2, (world: World, deltaMs: number): World => {
  if (!isToolActive(world, 'Barrels')) {
    return world
  }
  return Option.match(laneOf(levelOf(world)), {
    onNone: () => world,
    onSome: lane => {
      const rolledMs = toolActiveMs(world, 'Barrels')
      const from = xAt(lane, Math.max(0, rolledMs - deltaMs))
      const to = xAt(lane, rolledMs)
      if (from <= lane.endX && to <= lane.endX) {
        return world
      }
      return knockDownWhere(world, zombie => {
        const reach = RULES.radiusPx + bodyRadiusOf(zombie)
        return isGrounded(zombie) &&
          isFree(zombie) &&
          zombie.kind !== 'Boss' &&
          Math.abs(zombie.y - lane.y) < reach &&
          zombie.x > to - reach &&
          zombie.x < from + reach
          ? Option.some({
              damage: RULES.damage,
              direction: WEST,
              knockbackSpeed: RULES.knockback,
              dazeMs: RULES.dazeMs,
            })
          : Option.none()
      })
    },
  })
})
