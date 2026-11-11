import { Array, Option, Result } from 'effect'
import type { Canvas } from 'foldkit'

import type { Model } from '../../app/model'
import { DARE_ICONS, DARE_ICON_SIZE } from '../../art/dareArt'
import { type Sprite, bakeShapes, placeAt } from '../../art/sprite'
import type { Drawable } from '../../render/depth'
import { rect } from '../../render/drawing'
import { isInOpenRoom, maybeLyingAt } from '../../world/dare/dare'
import { type DareThing, DareThingState } from '../../world/dare/dareSchema'
import { levelOf } from '../../world/level/arena'
import { focusOf } from '../../world/party/party'
import { Phase, type Vector } from '../../world/schema/worldSchema'
import { distanceBetween } from '../../world/step/geometry'

// The dare's things in the house (src/world/dare/dare.ts), one in each room
// that holds one. Uncle Chunk's dropped hat bobs on the floor over a
// shadow. A hidden thing is unseen until a player walks close in its open
// room, when its spot glints. Help by difficulty: on Dare every hidden thing of the list sparkles
// through a break, on Double Dare one does, a different one each break, and
// Triple Dare and Triple Dog Dare get none.

const BOB_MS = 300
const BOB_PX = 1
const LIFT_PX = 5
const HALF_ICON = Math.floor(DARE_ICON_SIZE / 2)
const NEAR_GLINT_PX = 34
const GLINT_MS = 900
const GLINT_ON_MS = 220
const SPARKLE_MS = 600

const SHADOW: Sprite = bakeShapes([
  rect(-3, 0, 7, 1, 'rgba(0, 0, 0, 0.4)'),
  rect(-2, 1, 5, 1, 'rgba(0, 0, 0, 0.25)'),
])

const NEAR_GLINT: Sprite = bakeShapes([
  rect(0, -1, 1, 3, '#fff7d0'),
  rect(-1, 0, 3, 1, '#fff7d0'),
])

// NOTE: the help's sparkle, bigger and gold, seen from across the room.
const SPARKLE: Sprite = bakeShapes([
  rect(0, -3, 1, 7, '#ffe066'),
  rect(-3, 0, 7, 1, '#ffe066'),
  rect(-1, -1, 3, 3, '#fff1a8'),
  rect(0, 0, 1, 1, '#ffffff'),
])

const bobOf = (elapsedMs: number): number =>
  Math.floor(elapsedMs / BOB_MS) % 2 === 0 ? 0 : BOB_PX

const iconAt = (kind: DareThing['kind'], center: Vector): Canvas.Shape =>
  placeAt(center.x - HALF_ICON, center.y - HALF_ICON, DARE_ICONS[kind])

// NOTE: a dropped thing sorts with what stands around it, by its floor.
const droppedDrawable = (
  model: Model,
  thing: DareThing,
): Option.Option<Drawable> =>
  DareThingState.isAnyOf(['Dropped'])(thing.state)
    ? Option.some({
        footY: thing.state.y,
        rank: 'Pickup',
        shapes: [
          placeAt(thing.state.x, thing.state.y, SHADOW),
          iconAt(thing.kind, {
            x: thing.state.x,
            y: thing.state.y - LIFT_PX - bobOf(model.elapsedMs),
          }),
        ],
      })
    : Option.none()

export const dareDrawables = (model: Model): ReadonlyArray<Drawable> =>
  Array.getSomes(
    Array.map(model.dareThings, thing => droppedDrawable(model, thing)),
  )

// HELP

const hiddenAskedSpots = (model: Model): ReadonlyArray<Vector> => {
  const level = levelOf(model)
  return Array.filterMap(model.dareThings, thing =>
    DareThingState.isAnyOf(['Hidden'])(thing.state)
      ? Option.match(maybeLyingAt(thing, level), {
          onNone: () => Result.failVoid,
          onSome: spot => Result.succeed(spot),
        })
      : Result.failVoid,
  )
}

// NOTE: the spots the help sparkles over in this break, by difficulty.
const sparkleSpots = (model: Model): ReadonlyArray<Vector> => {
  if (!Phase.isAnyOf(['Preparation'])(model.phase)) {
    return []
  }
  const spots = hiddenAskedSpots(model)
  const wave = model.phase.wave
  return {
    Easy: spots,
    Normal: Option.toArray(Array.get(spots, wave % Math.max(1, spots.length))),
    Hard: [],
    Nightmare: [],
  }[model.difficulty.chosen]
}

const sparkleShapes = (model: Model): ReadonlyArray<Canvas.Shape> =>
  Math.floor(model.elapsedMs / SPARKLE_MS) % 3 === 2
    ? []
    : Array.map(sparkleSpots(model), spot =>
        placeAt(spot.x, spot.y - LIFT_PX, SPARKLE),
      )

// NOTE: a hidden thing's spot glints for a player walking near it.
const nearGlintShapes = (model: Model): ReadonlyArray<Canvas.Shape> => {
  if (model.elapsedMs % GLINT_MS >= GLINT_ON_MS) {
    return []
  }
  const level = levelOf(model)
  const { player } = focusOf(model)
  return Array.filterMap(model.dareThings, thing =>
    DareThingState.isAnyOf(['Hidden'])(thing.state) &&
    isInOpenRoom(level, thing.state) &&
    distanceBetween(player, thing.state) <= NEAR_GLINT_PX
      ? Result.succeed(placeAt(thing.state.x, thing.state.y - 2, NEAR_GLINT))
      : Result.failVoid,
  )
}

// OVERHEAD

export const dareOverheadShapes = (
  model: Model,
): ReadonlyArray<Canvas.Shape> => [
  ...nearGlintShapes(model),
  ...sparkleShapes(model),
]
