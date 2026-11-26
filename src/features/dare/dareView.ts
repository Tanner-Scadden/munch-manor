import { Array, Option, Result, String } from 'effect'

import type { Model } from '#app/model.ts'
import {
  BIG_KEY_PALETTE,
  BIG_KEY_PIXELS,
  DARE_BIG_ICONS,
  DARE_BIG_ICON_SIZE,
} from '#art/dareArt.ts'
import {
  type Sprite,
  TOP_LEFT,
  bakeShapes,
  placeAt,
  spriteShapes,
} from '#art/sprite.ts'
import { runDifficultyOf } from '#domain/onlineRun.ts'
import type { Drawable } from '#render/depth.ts'
import type * as Draw from '#render/draw.ts'
import { FULL_TURN, rect } from '#render/drawing.ts'
import {
  bakeDiscs,
  bakeRings,
  pixelDisc,
  pixelRing,
} from '#render/pixelCircle.ts'
import type { Difficulty } from '#shared/playerData.ts'
import { isHiddenInDark } from '#world/cellar/bulb.ts'
import { findStyleOf, isInOpenRoom, maybeLyingAt } from '#world/dare/dare.ts'
import {
  type DareThing,
  DareThingState,
  Finale,
} from '#world/dare/dareSchema.ts'
import { keyFlightShareOf } from '#world/dare/finale.ts'
import { isWorkedFind } from '#world/dare/finds.ts'
import { levelOf } from '#world/level/arena.ts'
import { focusOf } from '#world/party/party.ts'
import { Phase, type Vector } from '#world/schema/worldSchema.ts'
import { distanceBetween } from '#world/step/geometry.ts'

const BOB_MS = 300
const BOB_PX = 1
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

const OVER_FIND_PX = 9

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

const SPARKLE: Sprite = bakeShapes([
  rect(0, -3, 1, 7, '#ffe066'),
  rect(-3, 0, 7, 1, '#ffe066'),
  rect(-1, -1, 3, 3, '#fff1a8'),
  rect(0, 0, 1, 1, '#ffffff'),
])

const bobOf = (elapsedMs: number): number =>
  Math.floor(elapsedMs / BOB_MS) % 2 === 0 ? 0 : BOB_PX

const SHOWS_THINGS: Readonly<Record<Difficulty, boolean>> = {
  Easy: true,
  Normal: true,
  Hard: false,
  Nightmare: false,
}

export const isThingShownOn = (difficulty: Difficulty): boolean =>
  SHOWS_THINGS[difficulty]

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
          onSome: spot =>
            isHiddenInDark(model, spot)
              ? Result.failVoid
              : Result.succeed({ thing, spot }),
        })
      : Result.failVoid,
  )
}

const glowRadiusOf = (elapsedMs: number): number =>
  Math.round(
    GLOW_RADIUS + Math.sin((FULL_TURN * elapsedMs) / GLOW_MS) * GLOW_PULSE_PX,
  )

const shownDrawable = (
  model: Model,
  thing: DareThing,
  spot: Vector,
): Drawable => {
  const x = Math.round(spot.x)
  const y = Math.round(spot.y)
  const lift = isWorkedFind(findStyleOf(thing, levelOf(model)))
    ? BIG_LIFT_PX + OVER_FIND_PX
    : BIG_LIFT_PX
  return {
    footY: y,
    rank: 'Pickup',
    shapes: [
      placeAt(x, y, BIG_SHADOW),
      placeAt(
        x - HALF_BIG_ICON,
        y - lift - HALF_BIG_ICON - bobOf(model.elapsedMs),
        DARE_BIG_ICONS[thing.kind],
      ),
    ],
  }
}

const BIG_KEY: Sprite = spriteShapes(BIG_KEY_PIXELS, BIG_KEY_PALETTE, TOP_LEFT)
const BIG_KEY_GLINT: Sprite = spriteShapes(
  Array.map(BIG_KEY_PIXELS, row => String.replaceAll('Y', 'W')(row)),
  BIG_KEY_PALETTE,
  TOP_LEFT,
)
const BIG_KEY_HALF_WIDTH = 7
const BIG_KEY_HALF_HEIGHT = 3
const KEY_ARC_PX = 26
const KEY_GLINT_MS = 120
const LOCK_DROP_PX = 4

const keyDrawable = (model: Model): Option.Option<Drawable> =>
  Finale.matchOrElse(
    model.dare.finale,
    {
      KeyFlying: ({ from }): Option.Option<Drawable> => {
        const { box } = levelOf(model).thresholds.Front
        const lock = {
          x: (box.left + box.right) / 2,
          y: box.top + LOCK_DROP_PX,
        }
        const share = keyFlightShareOf(model)
        const floor = {
          x: from.x + (lock.x - from.x) * share,
          y: from.y + (lock.y - from.y) * share,
        }
        const lift = 4 * KEY_ARC_PX * share * (1 - share)
        const isGlint = Math.floor(model.elapsedMs / KEY_GLINT_MS) % 2 === 0
        return Option.some({
          footY: floor.y,
          rank: 'Pickup',
          shapes: [
            placeAt(Math.round(floor.x), Math.round(floor.y), SHADOW),
            placeAt(
              Math.round(floor.x - BIG_KEY_HALF_WIDTH),
              Math.round(floor.y - lift - BIG_KEY_HALF_HEIGHT * 2),
              isGlint ? BIG_KEY_GLINT : BIG_KEY,
            ),
          ],
        })
      },
    },
    (): Option.Option<Drawable> => Option.none(),
  )

bakeDiscs(
  GLOW_RADIUS - GLOW_PULSE_PX - 1,
  GLOW_RADIUS + GLOW_PULSE_PX - 1,
  GLOW_FILL,
)
bakeRings(
  GLOW_RADIUS - GLOW_PULSE_PX,
  GLOW_RADIUS + GLOW_PULSE_PX,
  1,
  GLOW_RING,
)

export const dareGroundShapes = (model: Model): ReadonlyArray<Draw.Shape> => {
  const radius = glowRadiusOf(model.elapsedMs)
  return Array.flatMap(shownThingSpots(model), ({ spot }) => {
    const x = Math.round(spot.x)
    const y = Math.round(spot.y) - 2
    return [
      pixelDisc(x, y, radius - 1, GLOW_FILL),
      pixelRing(x, y, radius, 1, GLOW_RING),
    ]
  })
}

export const dareDrawables = (model: Model): ReadonlyArray<Drawable> => [
  ...Array.getSomes([keyDrawable(model)]),
  ...Array.map(shownThingSpots(model), ({ thing, spot }) =>
    shownDrawable(model, thing, spot),
  ),
]

const sparkleSpots = (model: Model): ReadonlyArray<Vector> =>
  runDifficultyOf(model) === 'Easy' &&
  Phase.isAnyOf(['Preparation', 'Wave'])(model.phase)
    ? Array.map(shownThingSpots(model), ({ spot }) => spot)
    : []

const sparkleShapes = (model: Model): ReadonlyArray<Draw.Shape> =>
  Math.floor(model.elapsedMs / SPARKLE_MS) % 3 === 2
    ? []
    : Array.map(sparkleSpots(model), spot =>
        placeAt(
          spot.x + HALF_BIG_ICON,
          spot.y - BIG_LIFT_PX - HALF_BIG_ICON,
          SPARKLE,
        ),
      )

const nearGlintShapes = (model: Model): ReadonlyArray<Draw.Shape> => {
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
    !isHiddenInDark(model, thing.state) &&
    distanceBetween(player, thing.state) <= NEAR_GLINT_PX
      ? Result.succeed(placeAt(thing.state.x, thing.state.y - 2, NEAR_GLINT))
      : Result.failVoid,
  )
}

export const dareOverheadShapes = (model: Model): ReadonlyArray<Draw.Shape> => [
  ...nearGlintShapes(model),
  ...sparkleShapes(model),
]
