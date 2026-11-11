import { Array, Function, Option, Order } from 'effect'
import type { Canvas } from 'foldkit'

import type { Model } from '../../app/model'
import { runDifficultyOf } from '../../domain/onlineRun'
import type { Camera } from '../../render/camera'
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

// NOTE: the gold arrow that shows the way to a thing on the dare's list, a
// client cosmetic read off the World (src/render/pointerArrow.ts draws it):
// right over the thing while it is in sight, at the window's edge pointing
// toward it while it is not. It shows while Rattles' hint about a thing (or
// the room it lies in) is up, and on Dare (Easy) for the whole of a break,
// toward the nearest thing still lying in an open room. The owner read
// "SOMETHING'S THAT WAY" and could not tell what or where (playtest,
// 2026-11-10). It never points at a zombie.

const FLOOR_LIFT = 6

// NOTE: where the arrow's tip goes for a thing: over the thing floating in
// plain sight, else just over its spot.
const markOf = (model: Model, spot: Vector): Vector => ({
  x: spot.x,
  y:
    spot.y -
    (isThingShownOn(runDifficultyOf(model)) &&
    isInOpenRoom(levelOf(model), spot)
      ? SHOWN_THING_TOP
      : FLOOR_LIFT),
})

const lyingSpot = (model: Model, thing: DareThing): Option.Option<Vector> =>
  DareThingState.isAnyOf(['Found'])(thing.state)
    ? Option.none()
    : maybeLyingAt(thing, levelOf(model))

const byDistanceFrom = (from: Vector): Order.Order<Vector> =>
  Order.mapInput(Order.Number, (spot: Vector) => distanceBetween(from, spot))

// NOTE: Array.min asks for a non-empty list.
const minOf = (
  spots: ReadonlyArray<Vector>,
  order: Order.Order<Vector>,
): Option.Option<Vector> =>
  Array.isReadonlyArrayNonEmpty(spots)
    ? Option.some(Array.min(spots, order))
    : Option.none()

// NOTE: on Dare, through a break, the nearest thing still lying in an open
// room.
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
    : Option.map(
        Option.orElse(
          Option.flatMap(maybeHintCall(model), call => call.maybeTarget),
          () => maybeNearestThing(model),
        ),
        spot => markOf(model, spot),
      )

// NOTE: in the overlay canvas's pixels, from the screen camera.
export const darePointerShapes: {
  (
    screen: Screen,
    camera: Camera,
  ): (model: Model) => ReadonlyArray<Canvas.Shape>
  (model: Model, screen: Screen, camera: Camera): ReadonlyArray<Canvas.Shape>
} = Function.dual(
  3,
  (model: Model, screen: Screen, camera: Camera): ReadonlyArray<Canvas.Shape> =>
    Option.match(maybeDarePointer(model), {
      onNone: () => [],
      onSome: mark =>
        pointerArrowShapes({
          mark,
          elapsedMs: model.elapsedMs,
          screen,
          camera,
        }),
    }),
)
