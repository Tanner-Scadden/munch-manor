import { Array, Option, Result, pipe } from 'effect'
import type { Canvas } from 'foldkit'

import { levelOf } from './arena'
import { TILE_SIZE } from './constants'
import type { Drawable } from './depth'
import { rect } from './drawing'
import {
  PAN_RULES,
  SMASH_TIER,
  chargeOf,
  maybeHeldFridgeWeapon,
} from './fridgeWeapons'
import { FRIDGE_RISE_PX, isKitchenShown } from './kitchenView'
import { fridgeBoxOf } from './leftovers'
import { Charge, FridgeDoor, type Lob, type Model, type Player } from './model'
import { focusOf } from './party'
import { type Sprite, bakeShapes, placeAt, spriteShapes } from './sprite'

// The Mystery Leftovers fridge in motion (src/leftovers.ts) and the fridge
// weapons' own pictures (src/fridgeWeapons.ts): the door swinging open on a
// pull (the prize's reveal is src/fridgeRevealView.ts), the chain
// and padlock while it rests after a slam, the Cooker's pressure dial over
// the player, and its lids in flight. The fridge itself is baked into the
// kitchen (fridgeShapes in src/kitchenView.ts).

const FRIDGE_WIDTH = TILE_SIZE * 2
const FREEZER_PX = 11
const MAIN_DOOR_PX = FRIDGE_RISE_PX + TILE_SIZE * 2 - FREEZER_PX - 2

// THE DOOR

// NOTE: the main door swung open toward the viewer's left, a dark inside
// lit sick green, shelves of things best not named.
const OPEN_DOOR: Sprite = bakeShapes([
  rect(1, FREEZER_PX + 1, FRIDGE_WIDTH - 3, MAIN_DOOR_PX - 1, '#14200e'),
  rect(1, FREEZER_PX + 1, FRIDGE_WIDTH - 3, 2, '#9be36a'),
  rect(2, FREEZER_PX + 9, FRIDGE_WIDTH - 5, 1, '#4a5a3a'),
  rect(2, FREEZER_PX + 16, FRIDGE_WIDTH - 5, 1, '#4a5a3a'),
  rect(3, FREEZER_PX + 6, 3, 3, '#a04a5a'),
  rect(12, FREEZER_PX + 13, 3, 3, '#c08a4a'),
  rect(5, FREEZER_PX + 13, 2, 3, '#7aa04a'),
  rect(-5, FREEZER_PX - 1, 5, MAIN_DOOR_PX + 2, '#a89f74'),
  rect(-5, FREEZER_PX - 1, 1, MAIN_DOOR_PX + 2, '#6e6648'),
  rect(-2, FREEZER_PX + 4, 1, 10, '#c9ced6'),
  rect(-4, FREEZER_PX + 2, 2, MAIN_DOOR_PX - 4, '#7aa04a'),
])

const GLOW_PULSE_MS = 140

const GLOW: Sprite = bakeShapes([
  rect(2, FREEZER_PX + 3, FRIDGE_WIDTH - 5, 4, 'rgba(155, 227, 106, 0.45)'),
])

// NOTE: a chain across the shut door with a padlock, while it rests after
// a slam.
const CHAIN: Sprite = bakeShapes([
  ...Array.makeBy(6, index =>
    rect(1 + index * 3, FREEZER_PX + 6 + (index % 2), 2, 1, '#8a8a96'),
  ),
  rect(FRIDGE_WIDTH / 2 - 3, FREEZER_PX + 7, 6, 5, '#e0b040'),
  rect(FRIDGE_WIDTH / 2 - 2, FREEZER_PX + 5, 4, 2, '#140c10'),
  rect(FRIDGE_WIDTH / 2 - 1, FREEZER_PX + 9, 2, 2, '#140c10'),
])

const SLAM_SHAKE_MS = 500

type FridgeSpot = Readonly<{ left: number; top: number; bottom: number }>

const maybeFridgeSpot = (model: Model): Option.Option<FridgeSpot> =>
  Option.map(fridgeBoxOf(levelOf(model)), box => ({
    left: box.left,
    top: box.top - FRIDGE_RISE_PX,
    bottom: box.bottom,
  }))

const openDoor = (model: Model, spot: FridgeSpot): ReadonlyArray<Drawable> => [
  {
    footY: spot.bottom,
    rank: 'Prop',
    shapes: [
      placeAt(spot.left, spot.top, OPEN_DOOR),
      ...(Math.floor(model.elapsedMs / GLOW_PULSE_MS) % 2 === 0
        ? [placeAt(spot.left, spot.top, GLOW)]
        : []),
    ],
  },
]

// NOTE: the door's state, sorted with what stands in front of the fridge.
export const fridgeDrawables = (model: Model): ReadonlyArray<Drawable> =>
  isKitchenShown(model)
    ? Option.match(maybeFridgeSpot(model), {
        onNone: () => [],
        onSome: spot =>
          FridgeDoor.match(model.fridge.door, {
            Shut: (): ReadonlyArray<Drawable> => [],
            Open: (): ReadonlyArray<Drawable> => openDoor(model, spot),
            Offering: (): ReadonlyArray<Drawable> => openDoor(model, spot),
            Slammed: ({ remainingMs, durationMs }): ReadonlyArray<Drawable> => {
              const shake =
                durationMs - remainingMs < SLAM_SHAKE_MS
                  ? Math.floor(model.elapsedMs / 40) % 2 === 0
                    ? 1
                    : -1
                  : 0
              return [
                {
                  footY: spot.bottom,
                  rank: 'Prop',
                  shapes: [placeAt(spot.left + shake, spot.top, CHAIN)],
                },
              ]
            },
          }),
      })
    : []

// THE DIAL

// NOTE: a little pressure dial over the player while the Cooker charges
// (and while the Pan 3000 winds up its smash): it fills clockwise, turns
// red past full, and blinks just before the lid pops.
const DIAL_RADIUS = 3
const DIAL_STEPS = 12
const DIAL_LIFT_PX = 15

type DialPixel = Readonly<{ x: number; y: number; turn: number }>

const DIAL_PIXELS: ReadonlyArray<DialPixel> = pipe(
  Array.makeBy(DIAL_RADIUS * 2 + 1, row => row - DIAL_RADIUS),
  Array.flatMap(dy =>
    Array.filterMap(
      Array.makeBy(DIAL_RADIUS * 2 + 1, column => column - DIAL_RADIUS),
      (dx): Result.Result<DialPixel, void> => {
        const distance = Math.hypot(dx, dy)
        const angle = Math.atan2(dx, -dy)
        return distance >= DIAL_RADIUS - 0.5 && distance <= DIAL_RADIUS + 0.5
          ? Result.succeed({
              x: dx,
              y: dy,
              turn: (angle < 0 ? angle + Math.PI * 2 : angle) / (Math.PI * 2),
            })
          : Result.failVoid
      },
    ),
  ),
)

const dialSprite = (filled: number, fill: string): Sprite =>
  bakeShapes([
    rect(
      -DIAL_RADIUS + 1,
      -DIAL_RADIUS + 1,
      DIAL_RADIUS * 2 - 1,
      DIAL_RADIUS * 2 - 1,
      '#f4f1de',
    ),
    ...Array.map(DIAL_PIXELS, ({ x, y, turn }) =>
      rect(x, y, 1, 1, turn < filled ? fill : '#2a1a10'),
    ),
    rect(0, 0, 1, 1, '#140c10'),
  ])

const DIALS: Array.NonEmptyReadonlyArray<Sprite> = [
  dialSprite(0, '#ffd23f'),
  ...Array.makeBy(DIAL_STEPS, step =>
    dialSprite((step + 1) / DIAL_STEPS, '#ffd23f'),
  ),
]

const HOT_DIAL: Sprite = dialSprite(1, '#ff4a4f')

const POP_BLINK_MS = 70

const dialFor = (player: Player, elapsedMs: number): Option.Option<Sprite> =>
  Option.flatMap(maybeHeldFridgeWeapon(player), spare => {
    if (!Charge.isAnyOf(['Building'])(player.charge)) {
      return Option.none()
    } else if (spare.kind === 'Cooker') {
      const charge = chargeOf(player)
      return charge >= 1
        ? Math.floor(elapsedMs / POP_BLINK_MS) % 2 === 0 && charge > 1.4
          ? Option.none()
          : Option.some(HOT_DIAL)
        : Array.get(DIALS, Math.floor(charge * DIAL_STEPS))
    } else if (spare.kind === 'Pan' && spare.tier >= SMASH_TIER) {
      const share = player.charge.heldMs / PAN_RULES.smashHoldMs
      return share >= 1
        ? Option.some(HOT_DIAL)
        : Array.get(DIALS, Math.floor(share * DIAL_STEPS))
    } else {
      return Option.none()
    }
  })

const dialShapes = (model: Model): ReadonlyArray<Canvas.Shape> =>
  Option.match(dialFor(focusOf(model).player, model.elapsedMs), {
    onNone: () => [],
    onSome: dial => [
      placeAt(
        Math.round(focusOf(model).player.x),
        Math.round(focusOf(model).player.y) - DIAL_LIFT_PX,
        dial,
      ),
    ],
  })

// THE LIDS

// NOTE: a spinning pot lid: wide, then edge-on, then wide again.
const LID_FRAMES: Array.NonEmptyReadonlyArray<Sprite> = [
  spriteShapes(['.kHk.', 'kGHGk', '.kkk.'], {
    k: '#140c10',
    G: '#8d96a3',
    H: '#d9dde3',
  }),
  spriteShapes(['..k..', 'kGHGk', '..k..'], {
    k: '#140c10',
    G: '#8d96a3',
    H: '#d9dde3',
  }),
]

const LID_SPIN_MS = 70
const LID_ARC_PX = 8
const LID_SHADOW_COLOR = 'rgba(0, 0, 0, 0.35)'

const lidLift = (lob: Lob): number => {
  const progress = 1 - lob.remainingMs / Math.max(1, lob.durationMs)
  return 4 * LID_ARC_PX * progress * (1 - progress)
}

export const lidShadowShapes = (model: Model): ReadonlyArray<Canvas.Shape> =>
  Array.map(model.lobs, lob =>
    rect(Math.round(lob.x) - 2, Math.round(lob.y) + 2, 5, 1, LID_SHADOW_COLOR),
  )

const lidShapes = (model: Model): ReadonlyArray<Canvas.Shape> =>
  Array.map(model.lobs, lob =>
    placeAt(
      Math.round(lob.x),
      Math.round(lob.y - lidLift(lob)),
      Option.getOrElse(
        Array.get(
          LID_FRAMES,
          Math.floor((lob.durationMs - lob.remainingMs) / LID_SPIN_MS) %
            LID_FRAMES.length,
        ),
        () => LID_FRAMES[0],
      ),
    ),
  )

// NOTE: what flies over the heads of everything standing.
export const fridgeOverheadShapes = (
  model: Model,
): ReadonlyArray<Canvas.Shape> => [...lidShapes(model), ...dialShapes(model)]
