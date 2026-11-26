import { Array, Function, Option, Order } from 'effect'

import type { Model } from '../../app/model'
import { runDifficultyOf } from '../../domain/onlineRun'
import type { Camera } from '../../render/camera'
import type * as Draw from '../../render/draw'
import { pointerArrowShapes } from '../../render/pointerArrow'
import type { Screen } from '../../render/screen'
import { isInOpenRoom, maybeLyingAt } from '../../world/dare/dare'
import { type DareThing, DareThingState } from '../../world/dare/dareSchema'
import { levelOf } from '../../world/level/arena'
import { focusOf } from '../../world/party/party'
import { Phase, type Vector } from '../../world/schema/worldSchema'
import { distanceBetween } from '../../world/step/geometry'
import { SHOWN_THING_TOP, isThingShownOn } from './dareView'
import { isPocketCardOut } from './pocketCard'
import { maybeHintCall } from './rattlesHint'

const FLOOR_LIFT = 6

const liftOf = (model: Model, spot: Vector): number =>
  isThingShownOn(runDifficultyOf(model)) && isInOpenRoom(levelOf(model), spot)
    ? SHOWN_THING_TOP
    : FLOOR_LIFT

const lyingSpot = (model: Model, thing: DareThing): Option.Option<Vector> =>
  DareThingState.isAnyOf(['Found'])(thing.state)
    ? Option.none()
    : maybeLyingAt(thing, levelOf(model))

const byDistanceFrom = (from: Vector): Order.Order<Vector> =>
  Order.mapInput(Order.Number, (spot: Vector) => distanceBetween(from, spot))

const minOf = (
  spots: ReadonlyArray<Vector>,
  order: Order.Order<Vector>,
): Option.Option<Vector> =>
  Array.isReadonlyArrayNonEmpty(spots)
    ? Option.some(Array.min(spots, order))
    : Option.none()

const maybeNearestThing = (model: Model): Option.Option<Vector> =>
  runDifficultyOf(model) === 'Easy' &&
  Phase.isAnyOf(['Preparation'])(model.phase)
    ? minOf(
        Array.getSomes(
          Array.map(model.dareThings, thing => lyingSpot(model, thing)),
        ),
        byDistanceFrom(focusOf(model).player),
      )
    : Option.none()

export const maybeDarePointer = (model: Model): Option.Option<Vector> =>
  isPocketCardOut(model)
    ? Option.none()
    : Option.orElse(
        Option.flatMap(maybeHintCall(model), call => call.maybeTarget),
        () => maybeNearestThing(model),
      )

export const darePointerShapes: {
  (screen: Screen, camera: Camera): (model: Model) => ReadonlyArray<Draw.Shape>
  (model: Model, screen: Screen, camera: Camera): ReadonlyArray<Draw.Shape>
} = Function.dual(
  3,
  (model: Model, screen: Screen, camera: Camera): ReadonlyArray<Draw.Shape> =>
    Option.match(maybeDarePointer(model), {
      onNone: () => [],
      onSome: mark =>
        pointerArrowShapes({
          mark,
          liftPx: liftOf(model, mark),
          elapsedMs: model.elapsedMs,
          screen,
          camera,
        }),
    }),
)
