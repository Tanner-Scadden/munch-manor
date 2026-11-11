import { Array, Function, Option } from 'effect'

import { type Box, type Level, boxCenter, levelOf } from '../level/arena'
import { PARLOUR_ROOM_ID } from '../level/plan'
import type { World } from '../schema/world'
import type { Vector, Zombie, ZombieKind } from '../schema/worldSchema'
import { TOOL_RULES, isToolActive } from '../stations/toolRules'
import { isInsideBox } from '../step/geometry'

// The parlour's room tool (docs/ROOM_RESEARCH.md, "The parlour: THE
// GRAMOPHONE"): a gramophone on the dance floor's edge. Worked (a still
// player beside it, src/world/stations/stations.ts), it plays a scratchy
// waltz for a while, and the parlour's Groaners and Kaboomers stop chasing:
// each turns slow circles at a share of its pace, drifting in toward the
// middle of the dance floor, a crowd to mow down. Hotfoots, Big Lugs, Big
// Leaguers, Ankle Biters, and Uncle Chunk have no ear for it. A dancer you
// walk into still bites: it is a lure, not a shield. Its numbers are in
// TOOL_RULES.

const RULES = TOOL_RULES.Gramophone

const DANCERS: ReadonlyArray<ZombieKind> = ['Shambler', 'Exploder']

// NOTE: the floor the waltz plays over: the parlour's box, its middle, and
// how long it has played.
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

// NOTE: the dance floor while the gramophone plays, once a frame.
export const danceFloorOf = (world: World): Option.Option<DanceFloor> =>
  isToolActive(world, 'Gramophone')
    ? Option.map(parlourBoxOf(levelOf(world)), box => ({
        box,
        center: boxCenter(box),
        playedMs: RULES.cooldownMs - world.stations.Gramophone.cooldownMs,
      }))
    : Option.none()

// NOTE: a Groaner or Kaboomer in the parlour hears the waltz.
export const isDancing: {
  (floor: DanceFloor): (zombie: Zombie) => boolean
  (zombie: Zombie, floor: DanceFloor): boolean
} = Function.dual(
  2,
  (zombie: Zombie, floor: DanceFloor): boolean =>
    Array.contains(DANCERS, zombie.kind) && isInsideBox(zombie, floor.box),
)

// NOTE: a dancer's step: a slow circle, each its own way round the clock
// (by its id), plus a drift toward the floor's middle while it is out past
// the floor's edge.
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
    const distance = Math.hypot(deltaX, deltaY)
    const drift =
      distance > RULES.floorPx ? (speed * RULES.driftScale) / distance : 0
    return {
      x: Math.cos(angle) * sway + deltaX * drift,
      y: Math.sin(angle) * sway + deltaY * drift,
    }
  },
)
