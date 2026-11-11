import { Array, Function, Option } from 'effect'

import { type Box, type Level, levelOf } from '../level/arena'
import { CELLAR_ROOM_ID } from '../level/plan'
import type { World } from '../schema/world'
import { Phase, type Vector } from '../schema/worldSchema'
import { TOOL_RULES, isToolActive } from '../stations/toolRules'
import { isInsideBox } from '../step/geometry'

// The cellar's dark, made to matter (docs/ROOM_RESEARCH.md, "Decided" 5):
// the bare bulb's chain is a room tool. A yank (a still player under it,
// src/world/stations/stations.ts) lights the whole cellar for a while.
// While it is dark in a wave, zombies in the cellar walk a little faster
// (src/world/zombies/zombieMotion.ts), and the cellar's dare thing glints,
// and can be found, only in the light (src/world/dare/dare.ts). The client
// lifts its dark mask while the bulb is lit (src/render/cellarDark.ts).

const cellarBoxes = new WeakMap<Level, Option.Option<Box>>()

// NOTE: the cellar's box, open or shut. A level keeps it.
export const cellarBoxOf = (level: Level): Option.Option<Box> => {
  const cached = cellarBoxes.get(level)
  if (cached !== undefined) {
    return cached
  }
  const box = Option.map(
    Array.findFirst(level.rooms, ({ id }) => id === CELLAR_ROOM_ID),
    room => room.box,
  )
  cellarBoxes.set(level, box)
  return box
}

export const isCellarLit = (world: World): boolean =>
  isToolActive(world, 'Bulb')

// NOTE: where the dark speeds zombies up this frame: the cellar's box, in a
// wave with the bulb out.
export const darkBoxOf = (world: World): Option.Option<Box> =>
  Phase.isAnyOf(['Wave'])(world.phase) && !isCellarLit(world)
    ? cellarBoxOf(levelOf(world))
    : Option.none()

export const darkPaceAt: {
  (dark: Option.Option<Box>): (point: Vector) => number
  (point: Vector, dark: Option.Option<Box>): number
} = Function.dual(2, (point: Vector, dark: Option.Option<Box>): number =>
  // NOTE: read per zombie per frame, so no closure.
  Option.isSome(dark) && isInsideBox(point, dark.value)
    ? TOOL_RULES.Bulb.darkPace
    : 1,
)

// NOTE: a point the dark hides: in the cellar while the bulb is out. The
// cellar's dare thing there neither glints nor can be found.
export const isHiddenInDark: {
  (point: Vector): (world: World) => boolean
  (world: World, point: Vector): boolean
} = Function.dual(
  2,
  (world: World, point: Vector): boolean =>
    !isCellarLit(world) &&
    Option.exists(cellarBoxOf(levelOf(world)), box => isInsideBox(point, box)),
)
