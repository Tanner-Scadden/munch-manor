import { Array, Option, Result } from 'effect'
import { Canvas } from 'foldkit'

import type { Model } from '../../app/model'
import {
  DARE_BIG_ICONS,
  DARE_BIG_ICON_SIZE,
  DARE_ICONS,
  DARE_ICON_SIZE,
} from '../../art/dareArt'
import { type Sprite, bakeShapes, placeAt } from '../../art/sprite'
import { runDifficultyOf } from '../../domain/onlineRun'
import type { Drawable } from '../../render/depth'
import { FULL_TURN, rect } from '../../render/drawing'
import type { Difficulty } from '../../shared/playerData'
import { findStyleOf, isInOpenRoom, maybeLyingAt } from '../../world/dare/dare'
import { type DareThing, DareThingState } from '../../world/dare/dareSchema'
import { isWorkedFind } from '../../world/dare/finds'
import { levelOf } from '../../world/level/arena'
import { focusOf } from '../../world/party/party'
import { Phase, type Vector } from '../../world/schema/worldSchema'
import { distanceBetween } from '../../world/step/geometry'

// NOTE: the dare's things in the house (src/world/dare/dare.ts), one in each
// room that holds one. Uncle Chunk's dropped hat bobs on the floor over a
// shadow. Help by difficulty:
//
// - Dare (Easy) and Double Dare (Normal): a thing in its open room is always
//   drawn on its spot, twice its size in a dark outline, bobbing over a
//   shadow inside a soft gold glow that pulses, so it reads from across the
//   room and stands out from the decor. The owner bought every room on Easy
//   and still found nothing when things hid until you stepped close
//   (playtest, 2026-11-10).
// - Dare also keeps the gold sparkle over each, through waves and breaks.
// - Triple Dare (Hard) and Triple Dog Dare (Nightmare): a thing is unseen
//   until a player walks close in its open room, when its spot glints.
//
// The arrow that points the way is src/features/dare/darePointer.ts.

const BOB_MS = 300
const BOB_PX = 1
const LIFT_PX = 5
const HALF_ICON = Math.floor(DARE_ICON_SIZE / 2)
const HALF_BIG_ICON = Math.floor(DARE_BIG_ICON_SIZE / 2)
const BIG_LIFT_PX = HALF_BIG_ICON + 2
const NEAR_GLINT_PX = 34
const GLINT_MS = 900
const GLINT_ON_MS = 220
const SPARKLE_MS = 600
const GLOW_MS = 1400
const GLOW_RADIUS = 10
const GLOW_PULSE_PX = 2
const GLOW_FILL = 'rgba(255, 224, 102, 0.22)'
const GLOW_RING = 'rgba(255, 224, 102, 0.55)'

// NOTE: how much higher a thing floats over a room's find (its trunk, its
// book stack, its dumbwaiter, src/features/dare/findView.ts), to clear it.
const OVER_FIND_PX = 9

// NOTE: how high over its spot a shown thing floats, at most, for the
// pointer and the bubble to clear it.
export const SHOWN_THING_TOP =
  BIG_LIFT_PX + OVER_FIND_PX + HALF_BIG_ICON + BOB_PX

const SHADOW: Sprite = bakeShapes([
  rect(-3, 0, 7, 1, 'rgba(0, 0, 0, 0.4)'),
  rect(-2, 1, 5, 1, 'rgba(0, 0, 0, 0.25)'),
])

const BIG_SHADOW: Sprite = bakeShapes([
  rect(-5, 0, 11, 1, 'rgba(0, 0, 0, 0.45)'),
  rect(-4, 1, 9, 1, 'rgba(0, 0, 0, 0.3)'),
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

// NOTE: the difficulties whose things lie in plain sight in an open room.
const SHOWS_THINGS: Readonly<Record<Difficulty, boolean>> = {
  Easy: true,
  Normal: true,
  Hard: false,
  Nightmare: false,
}

export const isThingShownOn = (difficulty: Difficulty): boolean =>
  SHOWS_THINGS[difficulty]

// NOTE: a thing on the list still lying in its open room, in plain sight
// on this run's difficulty.
const shownThingSpots = (
  model: Model,
): ReadonlyArray<Readonly<{ thing: DareThing; spot: Vector }>> => {
  if (!isThingShownOn(runDifficultyOf(model))) {
    return []
  }
  const level = levelOf(model)
  return Array.filterMap(model.dareThings, thing =>
    DareThingState.isAnyOf(['Hidden'])(thing.state)
      ? Option.match(maybeLyingAt(thing, level), {
          onNone: () => Result.failVoid,
          onSome: spot => Result.succeed({ thing, spot }),
        })
      : Result.failVoid,
  )
}

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

const glowRadiusOf = (elapsedMs: number): number =>
  Math.round(
    GLOW_RADIUS + Math.sin((FULL_TURN * elapsedMs) / GLOW_MS) * GLOW_PULSE_PX,
  )

// NOTE: a thing in plain sight: the glow on the floor, its shadow, and the
// thing floating over them.
const shownDrawable = (
  model: Model,
  thing: DareThing,
  spot: Vector,
): Drawable => {
  const x = Math.round(spot.x)
  const y = Math.round(spot.y)
  const radius = glowRadiusOf(model.elapsedMs)
  const lift = isWorkedFind(findStyleOf(thing, levelOf(model)))
    ? BIG_LIFT_PX + OVER_FIND_PX
    : BIG_LIFT_PX
  return {
    footY: y,
    rank: 'Pickup',
    shapes: [
      Canvas.Circle({ x, y: y - 2, radius, fill: GLOW_FILL }),
      Canvas.Circle({
        x,
        y: y - 2,
        radius,
        stroke: GLOW_RING,
        lineWidth: 1,
      }),
      placeAt(x, y, BIG_SHADOW),
      placeAt(
        x - HALF_BIG_ICON,
        y - lift - HALF_BIG_ICON - bobOf(model.elapsedMs),
        DARE_BIG_ICONS[thing.kind],
      ),
    ],
  }
}

export const dareDrawables = (model: Model): ReadonlyArray<Drawable> => [
  ...Array.getSomes(
    Array.map(model.dareThings, thing => droppedDrawable(model, thing)),
  ),
  ...Array.map(shownThingSpots(model), ({ thing, spot }) =>
    shownDrawable(model, thing, spot),
  ),
]

// HELP

// NOTE: the spots the gold sparkle shines over: every thing in plain sight
// on Dare, through waves and breaks alike.
const sparkleSpots = (model: Model): ReadonlyArray<Vector> =>
  runDifficultyOf(model) === 'Easy' &&
  Phase.isAnyOf(['Preparation', 'Wave'])(model.phase)
    ? Array.map(shownThingSpots(model), ({ spot }) => spot)
    : []

const sparkleShapes = (model: Model): ReadonlyArray<Canvas.Shape> =>
  Math.floor(model.elapsedMs / SPARKLE_MS) % 3 === 2
    ? []
    : Array.map(sparkleSpots(model), spot =>
        placeAt(
          spot.x + HALF_BIG_ICON,
          spot.y - BIG_LIFT_PX - HALF_BIG_ICON,
          SPARKLE,
        ),
      )

// NOTE: on Triple Dare and Triple Dog Dare, a hidden thing's spot glints
// for a player walking near it.
const nearGlintShapes = (model: Model): ReadonlyArray<Canvas.Shape> => {
  if (
    isThingShownOn(runDifficultyOf(model)) ||
    model.elapsedMs % GLINT_MS >= GLINT_ON_MS
  ) {
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
