import { Function, Option } from 'effect'

import { TILE_SIZE } from '#shared/constants.ts'
import { type Level, levelOf } from '#world/level/arena.ts'
import { boxCenter } from '#world/level/tileGrid.ts'
import { isSolidAt, tileCoordinate } from '#world/level/tileQueries.ts'
import type { World } from '#world/schema/world.ts'
import type { Vector } from '#world/schema/worldSchema.ts'
import { knockDownWhere } from '#world/stations/knockDown.ts'
import { stationBoxOf } from '#world/stations/stationSpots.ts'
import {
  TOOL_RULES,
  isToolActive,
  toolActiveMs,
} from '#world/stations/toolRules.ts'
import { bodyRadiusOf, isFree, isGrounded } from '#world/zombies/zombies.ts'

import { cellarBoxOf } from './bulb.ts'

const RULES = TOOL_RULES.Barrels

const WEST: Vector = { x: -1, y: 0 }

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

export type Barrel = Readonly<{ x: number; y: number; isBroken: boolean }>

export const barrelOf = (world: World): Option.Option<Barrel> =>
  isToolActive(world, 'Barrels')
    ? Option.map(laneOf(levelOf(world)), lane => {
        const x = xAt(lane, toolActiveMs(world, 'Barrels'))
        return { x, y: lane.y, isBroken: x <= lane.endX }
      })
    : Option.none()

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
