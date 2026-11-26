import { Array, Function, pipe } from 'effect'

import type { Model } from '../../app/model'
import { placeAt } from '../../art/sprite'
import { type Camera, worldToView } from '../../render/camera'
import type * as Draw from '../../render/draw'
import { EDGE_BADGE_PX, edgeBadgeOf } from '../../render/edgeBadge'
import { clearWindowOf } from '../../render/hudLayout'
import type { Screen } from '../../render/screen'
import { ZombieAction } from '../../world/schema/worldSchema'
import { clamp } from '../../world/step/geometry'
import { isLastZombie } from '../../world/zombies/lastZombie'

const EDGE_GAP = 3
const BLINK_MS = 160

const RAGE_BADGES: readonly [
  ReadonlyArray<Draw.Shape>,
  ReadonlyArray<Draw.Shape>,
] = [edgeBadgeOf('#e8343a'), edgeBadgeOf('#ff9a8a')]

export const stragglerEdgeShapes: {
  (screen: Screen, camera: Camera): (model: Model) => ReadonlyArray<Draw.Shape>
  (model: Model, screen: Screen, camera: Camera): ReadonlyArray<Draw.Shape>
} = Function.dual(
  3,
  (model: Model, screen: Screen, camera: Camera): ReadonlyArray<Draw.Shape> => {
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
