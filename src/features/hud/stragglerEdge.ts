import { Array, Function, pipe } from 'effect'
import type { Canvas } from 'foldkit'

import type { Model } from '../../app/model'
import { placeAt } from '../../art/sprite'
import { type Camera, worldToView } from '../../render/camera'
import { EDGE_BADGE_PX, edgeBadgeOf } from '../../render/edgeBadge'
import { clearWindowOf } from '../../render/hudLayout'
import type { Screen } from '../../render/screen'
import { ZombieAction } from '../../world/schema/worldSchema'
import { clamp } from '../../world/step/geometry'
import { isLastZombie } from '../../world/zombies/lastZombie'

// NOTE: the wave's last zombies, once they hurry (src/world/zombies/lastZombie.ts),
// may be rooms away. Each one out of the window gets the co-op teammate's
// edge badge in the rage's red, blinking, pinned to the window's edge toward
// it, so the player knows where to go (owner, 2026-11-10: the one exception
// to "No off-screen hints" for zombies). Read off the World alone; one still
// under the floor gets none.

const EDGE_GAP = 3
const BLINK_MS = 160

const RAGE_BADGES: readonly [
  ReadonlyArray<Canvas.Shape>,
  ReadonlyArray<Canvas.Shape>,
] = [edgeBadgeOf('#e8343a'), edgeBadgeOf('#ff9a8a')]

export const stragglerEdgeShapes: {
  (
    screen: Screen,
    camera: Camera,
  ): (model: Model) => ReadonlyArray<Canvas.Shape>
  (model: Model, screen: Screen, camera: Camera): ReadonlyArray<Canvas.Shape>
} = Function.dual(
  3,
  (model: Model, screen: Screen, camera: Camera): ReadonlyArray<Canvas.Shape> => {
    const loneMs = model.pacing.loneMs
    if (loneMs <= 0) {
      return []
    }
    const clear = clearWindowOf(screen, EDGE_GAP)
    const badge =
      RAGE_BADGES[Math.floor(model.elapsedMs / BLINK_MS) % 2 === 0 ? 0 : 1]
    return pipe(
      model.zombies,
      Array.filter(
        zombie =>
          isLastZombie(zombie, loneMs) &&
          !ZombieAction.isAnyOf(['Burrowed'])(zombie.action),
      ),
      Array.flatMap(zombie => {
        const at = worldToView(camera, zombie)
        const isInView =
          at.x >= clear.left &&
          at.x <= clear.right &&
          at.y >= clear.top &&
          at.y <= clear.bottom
        return isInView
          ? []
          : [
              placeAt(
                Math.round(
                  clamp(at.x, clear.left, clear.right - EDGE_BADGE_PX),
                ),
                Math.round(
                  clamp(at.y, clear.top, clear.bottom - EDGE_BADGE_PX),
                ),
                badge,
              ),
            ]
      }),
    )
  },
)
