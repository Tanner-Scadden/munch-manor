import { Array, Function, Option } from 'effect'

import { type Level, levelOf } from '../level/arena'
import { CELLAR_ROOM_ID } from '../level/plan'
import type { Box } from '../level/tileGrid'
import type { World } from '../schema/world'
import { Phase, type Vector } from '../schema/worldSchema'
import { TOOL_RULES, isToolActive } from '../stations/toolRules'
import { isInsideBox } from '../step/geometry'

const cellarBoxes = new WeakMap<Level, Option.Option<Box>>()

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

export const darkBoxOf = (world: World): Option.Option<Box> =>
  Phase.isAnyOf(['Wave'])(world.phase) && !isCellarLit(world)
    ? cellarBoxOf(levelOf(world))
    : Option.none()

export const darkPaceAt: {
  (dark: Option.Option<Box>): (point: Vector) => number
  (point: Vector, dark: Option.Option<Box>): number
} = Function.dual(2, (point: Vector, dark: Option.Option<Box>): number =>
  Option.isSome(dark) && isInsideBox(point, dark.value)
    ? TOOL_RULES.Bulb.darkPace
    : 1,
)

export const isHiddenInDark: {
  (point: Vector): (world: World) => boolean
  (world: World, point: Vector): boolean
} = Function.dual(
  2,
  (world: World, point: Vector): boolean =>
    !isCellarLit(world) &&
    Option.exists(cellarBoxOf(levelOf(world)), box => isInsideBox(point, box)),
)
