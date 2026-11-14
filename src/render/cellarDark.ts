import { Array, Option, pipe } from 'effect'

import { isCellarLit } from '../world/cellar/bulb'
import { type Room, levelOf } from '../world/level/arena'
import { CELLAR_ROOM_ID } from '../world/level/plan'
import { focusOf } from '../world/party/party'
import type { World } from '../world/schema/world'
import type { Vector, Zombie } from '../world/schema/worldSchema'

// The cellar's twist (docs/ROOM_DRAFTS.md): it is dark but for each player's
// light and flashlight beam, the flash of each shot, and the one bare bulb,
// and a zombie in the dark is not drawn at all until it is close to the
// viewing player (DARK_SIGHT) or in their beam: only its footsteps give it
// away. Yanking the bulb's chain (src/world/cellar/bulb.ts) lifts the dark
// for a while. The 3D renderer lights the dark itself (src/render/iso/
// lights.ts); this is the rule for which zombies a viewer sees in it, read
// off the World each frame and never stored.

// NOTE: the flashlight's beam (owner, 2026-11-12, a friend's idea: "a beam
// of light from the flashlight ... you would have to point to the zombies to
// see and fire at them"): a cone the way the viewer faces, out to its
// length, its edge dimming past DIM of the way out.
const BEAM = { lengthPx: 120, halfAngle: Math.PI / 7 } as const
const DIM = 0.8

// NOTE: how far into the beam a point is, 0 at its root and 1 at its edge or
// its end, by whichever is further.
const beamReach = (facing: Vector, dx: number, dy: number): number => {
  const distance = Math.hypot(dx, dy)
  if (distance === 0) {
    return 0
  }
  const turn = Math.atan2(dy, dx) - Math.atan2(facing.y, facing.x)
  const off = Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn)))
  return Math.max(distance / BEAM.lengthPx, off / BEAM.halfAngle)
}

// WHAT THE VIEWER SEES

// NOTE: in the dark a viewer sees only the zombies close to them: whole
// within two tiles, fading out over the third, and nothing at all past it,
// no eyes, bar, or shadow (owner, 2026-11-11). Their footsteps are the tell.
// A zombie in the viewer's own beam shows whole, fading out over the beam's
// dim edge, so pointing the flashlight finds them (2026-11-12).
// Each player sees by their own seat (focusOf), so in co-op a mate's light
// lights the floor for you but shows you none of its zombies.
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

// NOTE: whole inside the beam's clear core, fading out across its dim edge.
const beamFade = (facing: Vector, dx: number, dy: number): number =>
  Math.min(1, Math.max(0, (1 - beamReach(facing, dx, dy)) / (1 - DIM)))

const cellarOf = (world: World): Option.Option<Room> =>
  Array.findFirst(
    levelOf(world).rooms,
    ({ id, isOpen }) => id === CELLAR_ROOM_ID && isOpen,
  )

// THE DARK

// NOTE: what the dark does to a frame: how much of each zombie shows, from 1
// (all of it) to 0 (none).
export type CellarDark = Readonly<{
  fadeOf: (zombie: Zombie) => number
}>

// NOTE: the dark is over the cellar once it is open and the bulb is out.
export const cellarDarkOf = (world: World): Option.Option<CellarDark> =>
  pipe(
    cellarOf(world),
    // NOTE: the bulb's chain lights the whole cellar a while
    // (src/world/cellar/bulb.ts): no dark at all then.
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
