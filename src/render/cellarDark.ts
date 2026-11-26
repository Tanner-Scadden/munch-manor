import { Array, Option, pipe } from 'effect'

import { isCellarLit } from '../world/cellar/bulb'
import { type Room, levelOf } from '../world/level/arena'
import { CELLAR_ROOM_ID } from '../world/level/plan'
import { focusOf } from '../world/party/party'
import type { World } from '../world/schema/world'
import type { Vector, Zombie } from '../world/schema/worldSchema'

const BEAM = { lengthPx: 120, halfAngle: Math.PI / 7 } as const
const DIM = 0.8

export const beamReach = ({
  facing,
  dx,
  dy,
}: Readonly<{ facing: Vector; dx: number; dy: number }>): number => {
  const distance = Math.hypot(dx, dy)
  if (distance === 0) {
    return 0
  }
  const turn = Math.atan2(dy, dx) - Math.atan2(facing.y, facing.x)
  const off = Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn)))
  return Math.max(distance / BEAM.lengthPx, off / BEAM.halfAngle)
}

const DARK_SIGHT = { clearPx: 20, seenPx: 30 } as const

const isInside = ({ box }: Room, { x, y }: Vector): boolean =>
  x >= box.left && x < box.right && y >= box.top && y < box.bottom

const nearFade = (viewer: Vector, zombie: Vector): number =>
  Math.min(
    1,
    Math.max(
      0,
      (DARK_SIGHT.seenPx -
        Math.hypot(zombie.x - viewer.x, zombie.y - viewer.y)) /
        (DARK_SIGHT.seenPx - DARK_SIGHT.clearPx),
    ),
  )

const beamFade = (facing: Vector, dx: number, dy: number): number =>
  Math.min(1, Math.max(0, (1 - beamReach({ facing, dx, dy })) / (1 - DIM)))

const cellarOf = (world: World): Option.Option<Room> =>
  Array.findFirst(
    levelOf(world).rooms,
    ({ id, isOpen }) => id === CELLAR_ROOM_ID && isOpen,
  )

export type CellarDark = Readonly<{
  fadeOf: (zombie: Zombie) => number
}>

export const cellarDarkOf = (world: World): Option.Option<CellarDark> =>
  pipe(
    cellarOf(world),
    Option.filter(() => !isCellarLit(world)),
    Option.map(cellar => {
      const viewer = focusOf(world).player
      return {
        fadeOf: (zombie: Zombie): number =>
          isInside(cellar, zombie)
            ? Math.max(
                nearFade(viewer, zombie),
                beamFade(
                  viewer.facing,
                  zombie.x - viewer.x,
                  zombie.y - viewer.y,
                ),
              )
            : 1,
      }
    }),
  )
