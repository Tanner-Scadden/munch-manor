import { Function, Option, pipe } from 'effect'
import type { Canvas } from 'foldkit'

import type { Model } from '../../app/model'
import type { Camera } from '../../render/camera'
import { edgeArrowShapes } from '../../render/pointerArrow'
import type { Screen } from '../../render/screen'
import type { Vector } from '../../world/schema/entitySchema'
import { maybePadlockPointer, maybeQuestMark } from './firstBreakQuest'
import { maybeKitchenMark } from './kitchenTour'

// NOTE: the guided tours' next spot (the padlock's boards, the case, the
// kitchen's boards) can sit out of sight: up under the HUD's top rows or
// past the window's edge, where the arrow bobbing over it cannot be seen.
// A new player then had a lit step in the tracker and nothing to follow
// (2026-11-10 walkthrough). So a big gold arrow (src/render/pointerArrow.ts)
// waits at the window's edge, pointing the way, bobbing toward it, until
// the spot comes into sight. Outside the tours it points the same way to a
// padlock the keys can open.

// NOTE: the tours' next spot, or outside them an affordable padlock
// (maybePadlockPointer in ./firstBreakQuest).
export const maybeTourMark = (model: Model): Option.Option<Vector> =>
  pipe(
    maybeQuestMark(model),
    Option.orElse(() => maybeKitchenMark(model)),
    Option.orElse(() => maybePadlockPointer(model)),
  )

// NOTE: in the overlay canvas's pixels, from the screen camera.
export const questEdgeShapes: {
  (
    screen: Screen,
    camera: Camera,
  ): (model: Model) => ReadonlyArray<Canvas.Shape>
  (model: Model, screen: Screen, camera: Camera): ReadonlyArray<Canvas.Shape>
} = Function.dual(
  3,
  (model: Model, screen: Screen, camera: Camera): ReadonlyArray<Canvas.Shape> =>
    Option.match(maybeTourMark(model), {
      onNone: () => [],
      onSome: mark =>
        edgeArrowShapes({ mark, elapsedMs: model.elapsedMs, screen, camera }),
    }),
)
