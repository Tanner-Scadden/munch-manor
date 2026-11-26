import { Function, Option, pipe } from 'effect'

import type { Model } from '../../app/model'
import type { Camera } from '../../render/camera'
import type * as Draw from '../../render/draw'
import { edgeArrowShapes } from '../../render/pointerArrow'
import type { Screen } from '../../render/screen'
import type { Vector } from '../../world/schema/entitySchema'
import { maybePadlockPointer, maybeQuestMark } from './firstBreakQuest'
import { maybeKitchenMark } from './kitchenTour'

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
