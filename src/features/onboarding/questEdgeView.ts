import { Function, Option, pipe } from 'effect'

import type { Model } from '#app/model.ts'
import type { Camera } from '#render/camera.ts'
import type * as Draw from '#render/draw.ts'
import { edgeArrowShapes } from '#render/pointerArrow.ts'
import type { Screen } from '#render/screen.ts'
import type { Vector } from '#world/schema/entitySchema.ts'

import { maybePadlockPointer, maybeQuestMark } from './firstBreakQuest.ts'
import { maybeKitchenMark } from './kitchenTour.ts'

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
