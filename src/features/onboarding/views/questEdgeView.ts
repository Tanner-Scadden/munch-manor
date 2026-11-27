import { Function, Option, pipe } from 'effect'

import type { Model } from '#app/model.ts'
import {
  maybePadlockPointer,
  maybeQuestMark,
} from '#features/onboarding/firstBreakQuest.ts'
import { maybeKitchenMark } from '#features/onboarding/kitchenTour.ts'
import type { Camera } from '#render/camera/camera.ts'
import type { Screen } from '#render/camera/screen.ts'
import type * as Draw from '#render/draw.ts'
import { edgeArrowShapes } from '#render/hud/pointerArrow.ts'
import type { Vector } from '#world/schema/entitySchema.ts'

export const maybeTourMark = (model: Model): Option.Option<Vector> =>
  pipe(
    maybeQuestMark(model),
    Option.orElse(() => maybeKitchenMark(model)),
    Option.orElse(() => maybePadlockPointer(model)),
  )

export const questEdgeShapes: {
  (screen: Screen, camera: Camera): (model: Model) => ReadonlyArray<Draw.Shape>
  (model: Model, screen: Screen, camera: Camera): ReadonlyArray<Draw.Shape>
} = Function.dual(
  3,
  (model: Model, screen: Screen, camera: Camera): ReadonlyArray<Draw.Shape> =>
    Option.match(maybeTourMark(model), {
      onNone: () => [],
      onSome: mark =>
        edgeArrowShapes({
          mark,
          liftPx: 0,
          elapsedMs: model.elapsedMs,
          screen,
          camera,
        }),
    }),
)
