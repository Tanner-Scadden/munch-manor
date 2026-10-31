import { Array, Option } from 'effect'
import { Canvas } from 'foldkit'

import { levelOf } from './arena'
import { type Camera, viewBoxOf, worldToView } from './camera'
import { AmmoTip, Tour } from './clientSchema'
import { FULL_TURN, placeSprite } from './drawing'
import { COIN_SPRITE, COIN_WIDTH } from './font'
import { kitchenStepOf, maybeKitchenMark } from './kitchenTour'
import { fridgeBoxOf } from './leftovers'
import type { Model } from './model'
import { isLearned } from './onboarding'
import { STALL_BOX, isBrowsing, isShopOpenFor } from './shop'
import {
  type Palette,
  type Sprite,
  TOP_LEFT,
  bakeShapes,
  spriteShapes,
} from './sprite'
import { TRAP_ICONS } from './sprites/traps'
import { TrapHint, type Vector } from './worldSchema'

// NOTE: Rattles calls from his stall with a speech bubble of pictures: a
// coin and what he sells that the player needs now. Traps, in the breaks
// until the first one is bought, since a playtester took the trap hint for
// a button that builds them. Ammo, once, the first time a gun that can run
// dry runs low. A bare coin, between waves, when the stall is out of the
// window and the shop has never been opened. The bubble hangs beside the
// stall, and when the stall is out of view it waits at the window's edge
// with an arrow toward it. It never points at a zombie.
//
// The kitchen tour (src/kitchenTour.ts) hangs the same bubble from its
// spots: a gift over the boards and the fridge it gives away, and, under
// the prize's TAKE tag and its ring (which teach taking), footprints and a
// cross for leaving it by walking away.
export type BubbleKind = 'Ammo' | 'Traps' | 'Shop' | 'Gift' | 'Leave'

const AMMO_PALETTE: Palette = {
  o: '#140c10',
  b: '#c9a227',
  B: '#ffe066',
  g: '#4f7a3a',
  G: '#6fa34f',
}

export const AMMO_BOX_WIDTH = 7

export const AMMO_BOX: Sprite = spriteShapes(
  ['.B.B.B.', '.b.b.b.', 'ooooooo', 'oGGGGGo', 'oGgggGo', 'oGGGGGo', 'ooooooo'],
  AMMO_PALETTE,
  TOP_LEFT,
)

type Good = Readonly<{ sprite: Sprite; isCentered: boolean; width: number }>

const TOUR_PALETTE: Palette = {
  o: '#140c10',
  r: '#ff4a4f',
  y: '#ffe066',
  g: '#4fb04f',
  w: '#5d6672',
}

const tourIcon = (pixels: ReadonlyArray<string>): Good => ({
  sprite: spriteShapes(pixels, TOUR_PALETTE, TOP_LEFT),
  isCentered: false,
  width: 7,
})

const GIFT = tourIcon([
  '.y...y.',
  '..yry..',
  'rrryrrr',
  'rrryrrr',
  '.rryrr.',
  '.rryrr.',
  '.rrrrr.',
])

// NOTE: two footprints walking off, for leaving the prize behind.
const FOOTSTEPS = tourIcon([
  '....oo.',
  '...ooo.',
  '...oo..',
  'oo.....',
  'ooo....',
  'oo.....',
  '.......',
])

const CROSS = tourIcon([
  'r.....r',
  'rr...rr',
  '.rr.rr.',
  '..rrr..',
  '.rr.rr.',
  'rr...rr',
  'r.....r',
])

const COIN: Good = { sprite: COIN_SPRITE, isCentered: false, width: COIN_WIDTH }

const ICON_SIZE = 7
const ICON_GAP = 2
const PAD = 3
const BUBBLE_HEIGHT = ICON_SIZE + PAD * 2
const TAIL = 3

const GOODS: Readonly<Record<BubbleKind, ReadonlyArray<Good>>> = {
  Ammo: [COIN, { sprite: AMMO_BOX, isCentered: false, width: ICON_SIZE }],
  Traps: [
    COIN,
    { sprite: TRAP_ICONS.Barricade, isCentered: true, width: ICON_SIZE },
    { sprite: TRAP_ICONS.Turret, isCentered: true, width: ICON_SIZE },
  ],
  Shop: [COIN],
  Gift: [GIFT],
  Leave: [FOOTSTEPS, CROSS],
}

const bubbleWidth = (kind: BubbleKind): number =>
  PAD * 2 +
  Array.reduce(GOODS[kind], 0, (sum, good) => sum + good.width) +
  (GOODS[kind].length - 1) * ICON_GAP

const BUBBLE_INK = '#140c10'
const BUBBLE_FILL = '#f4f1de'
const BUBBLE_ALERT = '#ff4a4f'

// NOTE: the frame and its tail, a fixed set of whole pixel rectangles,
// baked once per kind. The tail sits at the bottom right, toward Rattles.
const frameRects = (
  width: number,
  edge: string,
): ReadonlyArray<Canvas.Shape> => [
  Canvas.Rect({
    x: 1,
    y: 0,
    width: width - 2,
    height: BUBBLE_HEIGHT,
    fill: edge,
  }),
  Canvas.Rect({ x: 0, y: 1, width, height: BUBBLE_HEIGHT - 2, fill: edge }),
  Canvas.Rect({
    x: 1,
    y: 1,
    width: width - 2,
    height: BUBBLE_HEIGHT - 2,
    fill: BUBBLE_FILL,
  }),
  Canvas.Rect({
    x: width - TAIL - 3,
    y: BUBBLE_HEIGHT,
    width: TAIL,
    height: 1,
    fill: edge,
  }),
  Canvas.Rect({
    x: width - 4,
    y: BUBBLE_HEIGHT + 1,
    width: 2,
    height: 1,
    fill: edge,
  }),
  Canvas.Rect({
    x: width - 3,
    y: BUBBLE_HEIGHT + 2,
    width: 1,
    height: 1,
    fill: edge,
  }),
]

const FRAMES: Readonly<Record<BubbleKind, Sprite>> = {
  Ammo: bakeShapes(frameRects(bubbleWidth('Ammo'), BUBBLE_ALERT)),
  Traps: bakeShapes(frameRects(bubbleWidth('Traps'), BUBBLE_INK)),
  Shop: bakeShapes(frameRects(bubbleWidth('Shop'), BUBBLE_INK)),
  Gift: bakeShapes(frameRects(bubbleWidth('Gift'), BUBBLE_INK)),
  Leave: bakeShapes(frameRects(bubbleWidth('Leave'), BUBBLE_INK)),
}

const isStallInView = (camera: Camera): boolean => {
  const view = viewBoxOf(camera)
  const near = worldToView(camera, { x: STALL_BOX.left, y: STALL_BOX.top })
  const far = worldToView(camera, { x: STALL_BOX.right, y: STALL_BOX.bottom })
  return (
    near.x >= view.x &&
    far.x <= view.x + view.width &&
    near.y >= view.y &&
    far.y <= view.y + view.height
  )
}

const isBreakWithShop = (model: Model): boolean =>
  isShopOpenFor(model.phase) && !isBrowsing(model.shop)

export const maybeBubbleKind = (
  model: Model,
  camera: Camera,
): Option.Option<BubbleKind> => {
  if (AmmoTip.isAnyOf(['Showing'])(model.ammoTip)) {
    return Option.some('Ammo')
  } else if (
    !isBreakWithShop(model) ||
    Tour.isAnyOf(['Running', 'Done'])(model.kitchenTour)
  ) {
    return Option.none()
  } else if (
    TrapHint.isAnyOf(['Unseen'])(model.trapHint) &&
    (isStallInView(camera) || Tour.isAnyOf(['Running'])(model.firstBreakQuest))
  ) {
    return Option.some('Traps')
  } else if (!isLearned(model.lessons.shop) && !isStallInView(camera)) {
    return Option.some('Shop')
  } else {
    return Option.none()
  }
}

// PLACING

type Side = 'Left' | 'Right' | 'Up' | 'Down' | 'Inside'

const EDGE_MARGIN = 4
const HUD_CLEARANCE = 22
const ARROW_LENGTH = 4
const BOB_MS = 900

// NOTE: the bubble's tail tip in the world: just left of the awning, by
// Rattles' head.
const TIP = { x: STALL_BOX.left + 1, y: STALL_BOX.top + 1 }

const sideOf = (
  tip: { x: number; y: number },
  left: number,
  right: number,
  top: number,
  bottom: number,
): Side => {
  if (tip.x > right) {
    return 'Right'
  } else if (tip.x < left) {
    return 'Left'
  } else if (tip.y > bottom) {
    return 'Down'
  } else if (tip.y < top) {
    return 'Up'
  } else {
    return 'Inside'
  }
}

const arrowRects = (
  side: Side,
  x: number,
  y: number,
  width: number,
  color: string,
): ReadonlyArray<Canvas.Shape> => {
  const midY = y + Math.floor(BUBBLE_HEIGHT / 2)
  const midX = x + Math.floor(width / 2)
  return Array.makeBy(ARROW_LENGTH, step => {
    const reach = ARROW_LENGTH - step
    if (side === 'Right') {
      return Canvas.Rect({
        x: x + width + 1 + step,
        y: midY - reach + 1,
        width: 1,
        height: reach * 2 - 1,
        fill: color,
      })
    } else if (side === 'Left') {
      return Canvas.Rect({
        x: x - 2 - step,
        y: midY - reach + 1,
        width: 1,
        height: reach * 2 - 1,
        fill: color,
      })
    } else if (side === 'Down') {
      return Canvas.Rect({
        x: midX - reach + 1,
        y: y + BUBBLE_HEIGHT + TAIL + 1 + step,
        width: reach * 2 - 1,
        height: 1,
        fill: color,
      })
    } else {
      return Canvas.Rect({
        x: midX - reach + 1,
        y: y - 2 - step,
        width: reach * 2 - 1,
        height: 1,
        fill: color,
      })
    }
  })
}

const goodsShapes = (
  kind: BubbleKind,
  x: number,
  y: number,
): ReadonlyArray<Canvas.Shape> =>
  Array.reduce(
    GOODS[kind],
    { left: x + PAD, shapes: Array.empty<Canvas.Shape>() },
    ({ left, shapes }, { sprite, isCentered, width }) => ({
      left: left + width + ICON_GAP,
      shapes: [
        ...shapes,
        isCentered
          ? placeSprite(left + 3, y + PAD + 3, sprite)
          : placeSprite(left, y + PAD, sprite),
      ],
    }),
  ).shapes

export const stallBubbleShapes = (
  model: Model,
  camera: Camera,
): ReadonlyArray<Canvas.Shape> =>
  Option.match(maybeBubbleKind(model, camera), {
    onNone: () => [],
    onSome: kind => bubbleShapes(kind, TIP, model, camera),
  })

// NOTE: a bubble whose tail tip points at a spot in the world, pinned to
// the window's edge with an arrow when the spot is out of view.
const bubbleShapes = (
  kind: BubbleKind,
  tipInWorld: Vector,
  model: Model,
  camera: Camera,
): ReadonlyArray<Canvas.Shape> => {
  const width = bubbleWidth(kind)
  const view = viewBoxOf(camera)
  const tip = worldToView(camera, tipInWorld)
  const bob = Math.round(Math.sin((FULL_TURN * model.elapsedMs) / BOB_MS) * 1)
  const left = view.x + EDGE_MARGIN + ARROW_LENGTH
  const right = view.x + view.width - EDGE_MARGIN - ARROW_LENGTH - width
  const top = view.y + HUD_CLEARANCE
  const bottom = view.y + view.height - EDGE_MARGIN - BUBBLE_HEIGHT - TAIL
  const wantedX = Math.round(tip.x) - width + 2
  const wantedY = Math.round(tip.y) - BUBBLE_HEIGHT - TAIL
  const x = Math.max(left, Math.min(right, wantedX))
  const y = Math.max(top, Math.min(bottom, wantedY)) + bob
  const side = sideOf({ x: wantedX, y: wantedY }, left, right, top, bottom)
  const color = kind === 'Ammo' ? BUBBLE_ALERT : BUBBLE_INK
  return [
    placeSprite(x, y, FRAMES[kind]),
    ...goodsShapes(kind, x, y),
    ...(side === 'Inside' ? [] : arrowRects(side, x, y, width, color)),
  ]
}

// NOTE: the kitchen tour's bubbles: a gift over the boards, then over the
// fridge, and while the prize floats, under its TAKE tag (and the ring that
// teaches taking), footprints and a cross for leaving it.
const LEAVE_TIP_RIGHT = 26
const LEAVE_TIP_DROP = 32

export const kitchenBubbleShapes = (
  model: Model,
  camera: Camera,
): ReadonlyArray<Canvas.Shape> =>
  Option.match(kitchenStepOf(model), {
    onNone: () => [],
    onSome: step =>
      step === 'Choose'
        ? Option.match(fridgeBoxOf(levelOf(model)), {
            onNone: () => [],
            onSome: box =>
              bubbleShapes(
                'Leave',
                { x: box.right + LEAVE_TIP_RIGHT, y: box.top + LEAVE_TIP_DROP },
                model,
                camera,
              ),
          })
        : Option.match(maybeKitchenMark(model), {
            onNone: () => [],
            onSome: mark => bubbleShapes('Gift', mark, model, camera),
          }),
  })
