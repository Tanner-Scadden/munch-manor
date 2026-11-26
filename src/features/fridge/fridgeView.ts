import { Array, Function, Option, Result, pipe } from 'effect'

import type { Model } from '../../app/model'
import { prizeOnPaperSprite } from '../../art/prizeArt'
import {
  type Sprite,
  bakeShapes,
  deepSprite,
  group,
  placeAt,
  spriteShapes,
} from '../../art/sprite'
import { type Camera, worldToView } from '../../render/camera'
import { type Drawable, ON_FRONT_PX } from '../../render/depth'
import type * as Draw from '../../render/draw'
import { rect } from '../../render/drawing'
import { clearWindowOf } from '../../render/hudLayout'
import { type Keepout, maybeClearOfKeepouts } from '../../render/keepout'
import { FRIDGE_RISE_PX, isKitchenShown } from '../../render/room/kitchenView'
import { screenOf } from '../../render/screen'
import { TILE_SIZE } from '../../shared/constants'
import {
  PAN_RULES,
  SMASH_TIER,
  chargeOf,
  maybeHeldFridgeWeapon,
} from '../../world/fridge/fridgeWeapons'
import {
  FRIDGE_RULES,
  PRIZE_ORDER,
  fridgeBoxOf,
  prizeOddsFor,
} from '../../world/fridge/leftovers'
import { levelOf } from '../../world/level/arena'
import { distanceToBox } from '../../world/level/tileGrid'
import { focusOf, focusSlotOf } from '../../world/party/party'
import { activeModifiersOf } from '../../world/run/dareLadder'
import {
  Charge,
  FridgeDoor,
  type FridgePrize,
  type Lob,
  type Player,
  type Vector,
} from '../../world/schema/entitySchema'
import { clamp } from '../../world/step/geometry'
import { type Rarity, revealOf } from './fridgeReveal'

const FRIDGE_WIDTH = TILE_SIZE * 2
const FREEZER_PX = 11
const MAIN_DOOR_PX = FRIDGE_RISE_PX + TILE_SIZE * 2 - FREEZER_PX - 2

const doorShapes = (inside: string): ReadonlyArray<Draw.Shape> => [
  rect(1, FREEZER_PX + 1, FRIDGE_WIDTH - 3, MAIN_DOOR_PX - 1, '#14200e'),
  rect(1, FREEZER_PX + 1, FRIDGE_WIDTH - 3, 2, '#9be36a'),
  rect(2, FREEZER_PX + 3, FRIDGE_WIDTH - 5, 4, inside),
  rect(2, FREEZER_PX + 9, FRIDGE_WIDTH - 5, 1, '#4a5a3a'),
  rect(2, FREEZER_PX + 16, FRIDGE_WIDTH - 5, 1, '#4a5a3a'),
  rect(3, FREEZER_PX + 6, 3, 3, '#a04a5a'),
  rect(12, FREEZER_PX + 13, 3, 3, '#c08a4a'),
  rect(5, FREEZER_PX + 13, 2, 3, '#7aa04a'),
  rect(-5, FREEZER_PX - 1, 5, MAIN_DOOR_PX + 2, '#a89f74'),
  rect(-5, FREEZER_PX - 1, 1, MAIN_DOOR_PX + 2, '#6e6648'),
  rect(-2, FREEZER_PX + 4, 1, 10, '#c9ced6'),
  rect(-4, FREEZER_PX + 2, 2, MAIN_DOOR_PX - 4, '#7aa04a'),
]

const ON_FRONT = { most: 1, isUpright: true }

const OPEN_DOOR: Sprite = deepSprite(
  bakeShapes(doorShapes('#14200e')),
  ON_FRONT,
)

const LIT_DOOR: Sprite = deepSprite(bakeShapes(doorShapes('#517837')), ON_FRONT)

const GLOW_PULSE_MS = 140

const CHAIN: Sprite = deepSprite(
  bakeShapes([
    ...Array.makeBy(6, index =>
      rect(1 + index * 3, FREEZER_PX + 6 + (index % 2), 2, 1, '#8a8a96'),
    ),
    rect(FRIDGE_WIDTH / 2 - 3, FREEZER_PX + 7, 6, 5, '#e0b040'),
    rect(FRIDGE_WIDTH / 2 - 2, FREEZER_PX + 5, 4, 2, '#140c10'),
    rect(FRIDGE_WIDTH / 2 - 1, FREEZER_PX + 9, 2, 2, '#140c10'),
  ]),
  ON_FRONT,
)

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
    footY: spot.bottom + ON_FRONT_PX,
    rank: 'Prop',
    shapes: [
      placeAt(
        spot.left,
        spot.top,
        Math.floor(model.elapsedMs / GLOW_PULSE_MS) % 2 === 0
          ? LIT_DOOR
          : OPEN_DOOR,
      ),
    ],
  },
]

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
                  footY: spot.bottom + ON_FRONT_PX,
                  rank: 'Prop',
                  shapes: [placeAt(spot.left + shake, spot.top, CHAIN)],
                },
              ]
            },
          }),
      })
    : []

const ODDS_PIP_SHARE = 0.05
const ODDS_MAX_PIPS = 12
const ODDS_ROW_PX = 7
const ODDS_ICON_PX = 11
const ODDS_PAD_PX = 2
const ODDS_PIP_LEFT = ODDS_PAD_PX + ODDS_ICON_PX + ODDS_PAD_PX
const ODDS_WIDTH = ODDS_PIP_LEFT + ODDS_MAX_PIPS * 2 + ODDS_PAD_PX - 1
const ODDS_HEIGHT = PRIZE_ORDER.length * ODDS_ROW_PX + ODDS_PAD_PX
const ODDS_NEAR_PX = FRIDGE_RULES.leavePx

const PIP_COLORS: Readonly<Record<Rarity, string>> = {
  Common: '#ffd23f',
  Rare: '#8fe3ff',
  Snack: '#9be36a',
  Dud: '#8a8a96',
}

const ODDS_CARD: Sprite = bakeShapes([
  rect(-1, -1, ODDS_WIDTH + 2, ODDS_HEIGHT + 2, '#140c10'),
  rect(0, 0, ODDS_WIDTH, ODDS_HEIGHT, '#efe6c8'),
  rect(ODDS_WIDTH - 3, -2, 4, 3, 'rgba(230, 230, 210, 0.8)'),
])

const pipRow = (count: number, color: string): Sprite =>
  bakeShapes(Array.makeBy(count, index => rect(index * 2, -1, 1, 3, color)))

const PIP_ROWS: Readonly<Record<Rarity, Array.NonEmptyReadonlyArray<Sprite>>> =
  {
    Common: [
      [],
      ...Array.makeBy(ODDS_MAX_PIPS, n => pipRow(n + 1, PIP_COLORS.Common)),
    ],
    Rare: [
      [],
      ...Array.makeBy(ODDS_MAX_PIPS, n => pipRow(n + 1, PIP_COLORS.Rare)),
    ],
    Snack: [
      [],
      ...Array.makeBy(ODDS_MAX_PIPS, n => pipRow(n + 1, PIP_COLORS.Snack)),
    ],
    Dud: [
      [],
      ...Array.makeBy(ODDS_MAX_PIPS, n => pipRow(n + 1, PIP_COLORS.Dud)),
    ],
  }

export const oddsPips = (share: number): number =>
  share <= 0
    ? 0
    : Math.min(ODDS_MAX_PIPS, Math.max(1, Math.round(share / ODDS_PIP_SHARE)))

const oddsRow = (
  left: number,
  top: number,
  index: number,
  prize: FridgePrize,
  share: number,
): ReadonlyArray<Draw.Shape> => {
  const middle = top + ODDS_PAD_PX + index * ODDS_ROW_PX + 3
  const rows = PIP_ROWS[revealOf(prize).rarity]
  return [
    placeAt(
      left + ODDS_PAD_PX + Math.floor(ODDS_ICON_PX / 2),
      middle,
      prizeOnPaperSprite(prize),
    ),
    placeAt(
      left + ODDS_PIP_LEFT,
      middle,
      Option.getOrElse(Array.get(rows, oddsPips(share)), () => rows[0]),
    ),
  ]
}

const isNearShutFridge = (model: Model): boolean =>
  isKitchenShown(model) &&
  !activeModifiersOf(model).broke &&
  FridgeDoor.isAnyOf(['Shut'])(model.fridge.door) &&
  Option.exists(
    fridgeBoxOf(levelOf(model)),
    box => distanceToBox(focusOf(model).player, box) <= ODDS_NEAR_PX,
  )

const ODDS_GAP_PX = 3
const ODDS_EDGE_PX = 2
const ODDS_EDGE_GAP = 2

type PlacedOdds = Readonly<{
  anchor: Vector
  translate: Vector
  scale: number
  covers: Keepout
}>

const maybePlacedOdds = (
  model: Model,
  camera: Camera,
  keepouts: ReadonlyArray<Keepout>,
): Option.Option<PlacedOdds> =>
  isNearShutFridge(model)
    ? Option.flatMap(fridgeBoxOf(levelOf(model)), box => {
        const anchor = { x: box.right + ODDS_GAP_PX, y: box.top }
        const scale = Math.max(1, Math.round(camera.scale))
        const at = worldToView(camera, anchor)
        const left = Math.round(at.x) - ODDS_EDGE_PX * scale
        const top = Math.round(at.y) - ODDS_EDGE_PX * scale
        const width = (ODDS_WIDTH + ODDS_EDGE_PX * 2) * scale
        const height = (ODDS_HEIGHT + ODDS_EDGE_PX * 2) * scale
        const window = screenOf(model).world
        const isOut =
          left + width <= window.x ||
          left >= window.x + window.width ||
          top + height <= window.y ||
          top >= window.y + window.height
        if (isOut) {
          return Option.none()
        }
        const clear = clearWindowOf(screenOf(model), ODDS_EDGE_GAP)
        const x = clamp(left, clear.left, clear.right - width)
        const lowest = clear.bottom - height
        return Option.map(
          maybeClearOfKeepouts({
            keepouts,
            x,
            y: clamp(top, clear.top, lowest),
            width,
            height,
            top: clear.top,
            bottom: lowest,
          }),
          y => {
            const placedLeft = Math.round(x)
            const placedTop = Math.round(y)
            return {
              anchor,
              translate: {
                x: placedLeft + (ODDS_EDGE_PX - anchor.x) * scale,
                y: placedTop + (ODDS_EDGE_PX - anchor.y) * scale,
              },
              scale,
              covers: {
                left: placedLeft,
                top: placedTop,
                right: placedLeft + width,
                bottom: placedTop + height,
              },
            }
          },
        )
      })
    : Option.none()

export const fridgeOddsShapes: {
  (
    camera: Camera,
    keepouts: ReadonlyArray<Keepout>,
  ): (model: Model) => ReadonlyArray<Draw.Shape>
  (
    model: Model,
    camera: Camera,
    keepouts: ReadonlyArray<Keepout>,
  ): ReadonlyArray<Draw.Shape>
} = Function.dual(
  3,
  (
    model: Model,
    camera: Camera,
    keepouts: ReadonlyArray<Keepout>,
  ): ReadonlyArray<Draw.Shape> =>
    Option.match(maybePlacedOdds(model, camera, keepouts), {
      onNone: () => [],
      onSome: ({ anchor, translate, scale }) => [
        group({
          translate,
          scale: { x: scale, y: scale },
          shapes: [
            placeAt(anchor.x, anchor.y, ODDS_CARD),
            ...Array.flatMap(
              prizeOddsFor(model, focusSlotOf(model)),
              ([prize, share], index) =>
                oddsRow(anchor.x, anchor.y, index, prize, share),
            ),
          ],
        }),
      ],
    }),
)

export const fridgeOddsKeepoutsOf: {
  (
    camera: Camera,
    keepouts: ReadonlyArray<Keepout>,
  ): (model: Model) => ReadonlyArray<Keepout>
  (
    model: Model,
    camera: Camera,
    keepouts: ReadonlyArray<Keepout>,
  ): ReadonlyArray<Keepout>
} = Function.dual(
  3,
  (
    model: Model,
    camera: Camera,
    keepouts: ReadonlyArray<Keepout>,
  ): ReadonlyArray<Keepout> =>
    Option.toArray(
      Option.map(
        maybePlacedOdds(model, camera, keepouts),
        ({ covers }) => covers,
      ),
    ),
)

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

const dialShapes = (model: Model): ReadonlyArray<Draw.Shape> =>
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

export const lidShadowShapes = (model: Model): ReadonlyArray<Draw.Shape> =>
  Array.map(model.lobs, lob =>
    rect(Math.round(lob.x) - 2, Math.round(lob.y) + 2, 5, 1, LID_SHADOW_COLOR),
  )

const lidShapes = (model: Model): ReadonlyArray<Draw.Shape> =>
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

export const fridgeOverheadShapes = (
  model: Model,
): ReadonlyArray<Draw.Shape> => [...lidShapes(model), ...dialShapes(model)]
