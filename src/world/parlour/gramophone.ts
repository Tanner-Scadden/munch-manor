import { Array, Function, Option } from 'effect'

import * as DetMath from '#shared/detMath.ts'
import { type Level, levelOf } from '#world/level/arena.ts'
import { PARLOUR_ROOM_ID } from '#world/level/plan.ts'
import { type Box, boxCenter } from '#world/level/tileGrid.ts'
import type { World } from '#world/schema/world.ts'
import type { Vector, Zombie, ZombieKind } from '#world/schema/worldSchema.ts'
import { TOOL_RULES, isToolActive } from '#world/stations/toolRules.ts'
import { isInsideBox } from '#world/step/geometry.ts'

const RULES = TOOL_RULES.Gramophone

const DANCERS: ReadonlyArray<ZombieKind> = ['Shambler', 'Exploder']

export type DanceFloor = Readonly<{
  box: Box
  center: Vector
  playedMs: number
}>

const parlourBoxes = new WeakMap<Level, Option.Option<Box>>()

const parlourBoxOf = (level: Level): Option.Option<Box> => {
  const cached = parlourBoxes.get(level)
  if (cached !== undefined) {
    return cached
  }
  const box = Option.map(
    Array.findFirst(
      level.rooms,
      ({ id, isOpen }) => id === PARLOUR_ROOM_ID && isOpen,
    ),
    room => room.box,
  )
  parlourBoxes.set(level, box)
  return box
}

export const danceFloorOf = (world: World): Option.Option<DanceFloor> =>
  isToolActive(world, 'Gramophone')
    ? Option.map(parlourBoxOf(levelOf(world)), box => ({
        box,
        center: boxCenter(box),
        playedMs: RULES.cooldownMs - world.stations.Gramophone.cooldownMs,
      }))
    : Option.none()

export const isDancing: {
  (floor: DanceFloor): (zombie: Zombie) => boolean
  (zombie: Zombie, floor: DanceFloor): boolean
} = Function.dual(
  2,
  (zombie: Zombie, floor: DanceFloor): boolean =>
    Array.contains(DANCERS, zombie.kind) && isInsideBox(zombie, floor.box),
)

export const danceVelocity: {
  (floor: DanceFloor, speed: number): (zombie: Zombie) => Vector
  (zombie: Zombie, floor: DanceFloor, speed: number): Vector
} = Function.dual(
  3,
  (zombie: Zombie, floor: DanceFloor, speed: number): Vector => {
    const angle =
      (2 * Math.PI * floor.playedMs) / RULES.turnMs + zombie.id * 1.7
    const sway = speed * RULES.danceScale
    const deltaX = floor.center.x - zombie.x
    const deltaY = floor.center.y - zombie.y
    const distance = DetMath.hypot(deltaX, deltaY)
    const drift =
      distance > RULES.floorPx ? (speed * RULES.driftScale) / distance : 0
    return {
      x: DetMath.cos(angle) * sway + deltaX * drift,
      y: DetMath.sin(angle) * sway + deltaY * drift,
    }
  },
)
