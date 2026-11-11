import { Array, Option, Result } from 'effect'
import type { Canvas } from 'foldkit'

import type { Model } from '../../app/model'
import { type Sprite, bakeShapes, placeAt } from '../../art/sprite'
import { runDifficultyOf } from '../../domain/onlineRun'
import type { Drawable } from '../../render/depth'
import { rect } from '../../render/drawing'
import { SET_UP_RINGS, ringStepOf } from '../../render/workRing'
import { findStyleOf, isInOpenRoom } from '../../world/dare/dare'
import { DareThingState } from '../../world/dare/dareSchema'
import { FIND_RULES, type FindStyle } from '../../world/dare/finds'
import { levelOf } from '../../world/level/arena'
import { focusOf } from '../../world/party/party'
import type { Vector } from '../../world/schema/worldSchema'
import { distanceBetween } from '../../world/step/geometry'
import { isThingShownOn } from './dareView'

// Each room's find drawn (src/world/dare/finds.ts). Show, don't explain:
// the thing sits in something of the room's own, and working it plays the
// thing open in three stages while the gold work ring fills round it.
//
// - The parlour's trunk: its lid creeps up, then springs open on a glow.
// - The library's hollow book: one red book sticks out of a short stack,
//   slides out, then falls open, hollow.
// - The kitchen's dumbwaiter: a hatch with its rope; the car's tray rises
//   into view, then sits at the top with its bell.
//
// On Dare and Double Dare it is always drawn under the floating thing; on
// Triple Dare and Triple Dog Dare it shows only to a player close by, as the
// thing's glint does (src/features/dare/dareView.ts).

const NEAR_PX = 34
const JIGGLE_MS = 90

// NOTE: the colours of the house's old wood and brass.
const WOOD = '#6b3f1f'
const WOOD_DARK = '#3e2210'
const WOOD_LIGHT = '#8e5a2c'
const BRASS = '#d8b04a'
const BRASS_DARK = '#8a6420'
const INSIDE = '#1a0f08'
const GLOW = '#ffe680'

type Stages = readonly [Sprite, Sprite, Sprite]

// NOTE: every sprite's origin is the middle of its foot.

const trunkBody = [
  rect(-5, -5, 11, 5, WOOD),
  rect(-5, -1, 11, 1, WOOD_DARK),
  rect(-3, -5, 1, 5, BRASS_DARK),
  rect(3, -5, 1, 5, BRASS_DARK),
  rect(0, -4, 1, 2, BRASS),
]

const TRUNK: Stages = [
  bakeShapes([
    ...trunkBody,
    rect(-5, -8, 11, 3, WOOD_LIGHT),
    rect(-5, -8, 11, 1, WOOD),
    rect(-3, -8, 1, 3, BRASS),
    rect(3, -8, 1, 3, BRASS),
  ]),
  bakeShapes([
    ...trunkBody,
    rect(-5, -6, 11, 1, INSIDE),
    rect(-5, -10, 11, 3, WOOD_LIGHT),
    rect(-5, -10, 11, 1, WOOD),
    rect(-3, -10, 1, 3, BRASS),
    rect(3, -10, 1, 3, BRASS),
  ]),
  bakeShapes([
    rect(-5, -13, 11, 6, WOOD_DARK),
    rect(-4, -12, 9, 4, WOOD_LIGHT),
    ...trunkBody,
    rect(-4, -6, 9, 1, INSIDE),
    rect(-2, -7, 5, 1, GLOW),
  ]),
]

const BOOK_RED = '#a8322c'
const BOOK_RED_DARK = '#6e1e1a'
const BOOK_GREEN = '#3f6b3a'
const BOOK_BLUE = '#34507a'
const PAGES = '#efe2c0'

const bookStack = [
  rect(-5, -3, 11, 3, BOOK_GREEN),
  rect(-5, -1, 11, 1, '#2a4a26'),
  rect(-4, -6, 9, 3, BOOK_BLUE),
  rect(-4, -4, 9, 1, '#22385a'),
  rect(4, -6, 1, 3, PAGES),
  rect(5, -3, 1, 3, PAGES),
]

const sticking = (shift: number) => [
  rect(-6 - shift, -9, 10, 3, BOOK_RED),
  rect(-6 - shift, -7, 10, 1, BOOK_RED_DARK),
  rect(-5 - shift, -8, 1, 1, BRASS),
  rect(3 - shift, -9, 1, 3, PAGES),
]

const HOLLOW_BOOK: Stages = [
  bakeShapes([...bookStack, ...sticking(0)]),
  bakeShapes([...bookStack, ...sticking(3)]),
  bakeShapes([
    ...bookStack,
    rect(-6, -10, 6, 4, BOOK_RED),
    rect(0, -10, 6, 4, BOOK_RED),
    rect(-5, -9, 4, 2, PAGES),
    rect(1, -9, 4, 2, PAGES),
    rect(-3, -9, 6, 2, INSIDE),
    rect(-1, -9, 2, 1, GLOW),
  ]),
]

const ROPE = '#c9a66b'

const hatch = [
  rect(-5, -12, 10, 12, WOOD_DARK),
  rect(-4, -11, 8, 10, INSIDE),
  rect(-5, -1, 10, 1, WOOD),
  rect(5, -12, 1, 10, ROPE),
  rect(5, -2, 1, 1, BRASS),
]

const tray = (top: number) => [
  rect(-4, top, 8, 1, '#b8b8c0'),
  rect(-4, top + 1, 8, 1, '#6a6a74'),
]

const DUMBWAITER: Stages = [
  bakeShapes([...hatch, ...tray(-3)]),
  bakeShapes([...hatch, ...tray(-6), rect(-4, -5, 8, 3, '#2a1a10')]),
  bakeShapes([
    ...hatch,
    ...tray(-9),
    rect(-4, -8, 8, 6, '#2a1a10'),
    rect(-1, -11, 2, 2, BRASS),
    rect(0, -12, 1, 1, '#fff7d0'),
  ]),
]

const PROPS: Readonly<Record<FindStyle, Option.Option<Stages>>> = {
  Walk: Option.none(),
  Rummage: Option.some(TRUNK),
  HollowBook: Option.some(HOLLOW_BOOK),
  Dumbwaiter: Option.some(DUMBWAITER),
}

type FindView = Readonly<{
  spot: Vector
  stages: Stages
  share: number
}>

const stageOf = (stages: Stages, share: number): Sprite =>
  share <= 0 ? stages[0] : share < 0.6 ? stages[1] : stages[2]

const isSeen = (model: Model, spot: Vector): boolean =>
  isThingShownOn(runDifficultyOf(model)) ||
  distanceBetween(focusOf(model).player, spot) <= NEAR_PX

// NOTE: each hidden thing in an open room whose room finds it by work,
// with its prop and how far its work has come.
const findViewsOf = (model: Model): ReadonlyArray<FindView> => {
  const level = levelOf(model)
  return Array.filterMap(model.dareThings, thing => {
    if (
      !DareThingState.isAnyOf(['Hidden'])(thing.state) ||
      !isInOpenRoom(level, thing.state)
    ) {
      return Result.failVoid
    }
    const style = findStyleOf(thing, level)
    const spot = { x: thing.state.x, y: thing.state.y }
    const workedMs = thing.state.workedMs
    return Option.match(PROPS[style], {
      onNone: () => Result.failVoid,
      onSome: stages =>
        isSeen(model, spot)
          ? Result.succeed({
              spot,
              stages,
              share: Math.min(1, workedMs / FIND_RULES[style].workMs),
            })
          : Result.failVoid,
    })
  })
}

const jiggleOf = (elapsedMs: number, share: number): number =>
  share > 0 && Math.floor(elapsedMs / JIGGLE_MS) % 2 === 0 ? 1 : 0

// NOTE: a prop sorts just behind the thing floating over it.
export const findDrawables = (model: Model): ReadonlyArray<Drawable> =>
  Array.map(findViewsOf(model), ({ spot, stages, share }): Drawable => ({
    footY: Math.round(spot.y) - 1,
    rank: 'Pickup',
    shapes: [
      placeAt(
        Math.round(spot.x) + jiggleOf(model.elapsedMs, share),
        Math.round(spot.y) + 3,
        stageOf(stages, share),
      ),
    ],
  }))

// NOTE: over everything: the gold work ring while a find is worked.
export const findOverheadShapes = (model: Model): ReadonlyArray<Canvas.Shape> =>
  Array.filterMap(findViewsOf(model), ({ spot, share }) =>
    share > 0
      ? Result.succeed(
          placeAt(
            Math.round(spot.x),
            Math.round(spot.y) - 3,
            ringStepOf(SET_UP_RINGS, share),
          ),
        )
      : Result.failVoid,
  )
