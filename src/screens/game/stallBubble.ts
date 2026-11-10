import { Array, Function, Option } from 'effect'
import { Canvas } from 'foldkit'

import type { Model } from '../../app/model'
import { bakeText } from '../../art/font'
import {
  type Palette,
  type Sprite,
  TOP_LEFT,
  bakeShapes,
  placeAt,
  spriteShapes,
} from '../../art/sprite'
import {
  CALL_LINES,
  callLineIndex,
  maybeCallTarget,
} from '../../features/kitchen/kitchenCall'
import {
  kitchenStepOf,
  maybeKitchenMark,
} from '../../features/onboarding/kitchenTour'
import { type Camera, viewBoxOf, worldToView } from '../../render/camera'
import { FULL_TURN, placeSprite } from '../../render/drawing'
import { fridgeBoxOf } from '../../world/fridge/leftovers'
import { levelOf } from '../../world/level/arena'
import type { Vector } from '../../world/schema/worldSchema'

// NOTE: Rattles hollers his hints in a speech bubble of pictures, hung
// from the spot it is about, and when that spot is out of view it waits at
// the window's edge with an arrow toward it. It never points at a zombie.
// His stall and its bubble of goods went with the shop
// (docs/ESCAPE_PLAN.md, layer 7).
//
// The kitchen tour (src/features/onboarding/kitchenTour.ts) hangs the same bubble from its
// spots: a gift over the boards and the fridge it gives away, and, under
// the prize's TAKE tag and its ring (which teach taking), footprints and a
// cross for leaving it by walking away.
type BubbleKind = 'Gift' | 'Leave' | 'Soup0' | 'Soup1' | 'Soup2'

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

// NOTE: Rattles' holler about the boarded kitchen (src/features/kitchen/kitchenCall.ts): a
// steaming pot and a goofy line, in dark ink on the bubble.
const POT_STEAM = '#aeb6bd'

const potGood: Good = {
  sprite: spriteShapes(
    [
      '.w.w...',
      '..w.w..',
      '.ooooo.',
      'oGGGGGo',
      'ogggsso',
      'ogggggo',
      '.ooooo.',
    ],
    { o: '#140c10', G: '#8a93a0', g: '#5d6672', s: '#7c9c3a', w: POT_STEAM },
    TOP_LEFT,
  ),
  isCentered: false,
  width: 7,
}

const lineGood = (line: string): Good => {
  const baked = bakeText(line, 'Ink')
  return {
    sprite: [placeAt(0, 1, baked.sprite)],
    isCentered: false,
    width: baked.width,
  }
}

const SOUP_GOODS: ReadonlyArray<ReadonlyArray<Good>> = Array.map(
  CALL_LINES,
  line => [potGood, lineGood(line)],
)

const soupGoods = (index: number): ReadonlyArray<Good> =>
  Option.getOrElse(Array.get(SOUP_GOODS, index), () => [])

const ICON_SIZE = 7
const ICON_GAP = 2
const PAD = 3
const BUBBLE_HEIGHT = ICON_SIZE + PAD * 2
const TAIL = 3

const GOODS: Readonly<Record<BubbleKind, ReadonlyArray<Good>>> = {
  Gift: [GIFT],
  Leave: [FOOTSTEPS, CROSS],
  Soup0: soupGoods(0),
  Soup1: soupGoods(1),
  Soup2: soupGoods(2),
}

const bubbleWidth = (kind: BubbleKind): number =>
  PAD * 2 +
  Array.reduce(GOODS[kind], 0, (sum, good) => sum + good.width) +
  (GOODS[kind].length - 1) * ICON_GAP

const BUBBLE_INK = '#140c10'
const BUBBLE_FILL = '#f4f1de'

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
  Gift: bakeShapes(frameRects(bubbleWidth('Gift'), BUBBLE_INK)),
  Leave: bakeShapes(frameRects(bubbleWidth('Leave'), BUBBLE_INK)),
  Soup0: bakeShapes(frameRects(bubbleWidth('Soup0'), BUBBLE_INK)),
  Soup1: bakeShapes(frameRects(bubbleWidth('Soup1'), BUBBLE_INK)),
  Soup2: bakeShapes(frameRects(bubbleWidth('Soup2'), BUBBLE_INK)),
}

// PLACING

type Side = 'Left' | 'Right' | 'Up' | 'Down' | 'Inside'

const EDGE_MARGIN = 4
const HUD_CLEARANCE = 22
const ARROW_LENGTH = 4
const BOB_MS = 900

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
  return [
    placeSprite(x, y, FRAMES[kind]),
    ...goodsShapes(kind, x, y),
    ...(side === 'Inside' ? [] : arrowRects(side, x, y, width, BUBBLE_INK)),
  ]
}

// NOTE: the kitchen tour's bubbles: a gift over the boards, then over the
// fridge, and while the prize floats, under its TAKE tag (and the ring that
// teaches taking), footprints and a cross for leaving it.
const LEAVE_TIP_RIGHT = 26
const LEAVE_TIP_DROP = 32

export const kitchenBubbleShapes: {
  (camera: Camera): (model: Model) => ReadonlyArray<Canvas.Shape>
  (model: Model, camera: Camera): ReadonlyArray<Canvas.Shape>
} = Function.dual(
  2,
  (model: Model, camera: Camera): ReadonlyArray<Canvas.Shape> =>
    Option.match(kitchenStepOf(model), {
      onNone: () => [],
      onSome: step =>
        step === 'Choose'
          ? Option.match(fridgeBoxOf(levelOf(model)), {
              onNone: () => [],
              onSome: box =>
                bubbleShapes(
                  'Leave',
                  {
                    x: box.right + LEAVE_TIP_RIGHT,
                    y: box.top + LEAVE_TIP_DROP,
                  },
                  model,
                  camera,
                ),
            })
          : Option.match(maybeKitchenMark(model), {
              onNone: () => [],
              onSome: mark => bubbleShapes('Gift', mark, model, camera),
            }),
    }),
)

const SOUP_KINDS: ReadonlyArray<BubbleKind> = ['Soup0', 'Soup1', 'Soup2']

// NOTE: Rattles' holler about the kitchen's boards, pinned to the window's
// edge with an arrow toward them when they are out of view.
export const soupBubbleShapes: {
  (camera: Camera): (model: Model) => ReadonlyArray<Canvas.Shape>
  (model: Model, camera: Camera): ReadonlyArray<Canvas.Shape>
} = Function.dual(
  2,
  (model: Model, camera: Camera): ReadonlyArray<Canvas.Shape> =>
    Option.match(maybeCallTarget(model), {
      onNone: () => [],
      onSome: target =>
        Option.match(Array.get(SOUP_KINDS, callLineIndex(model)), {
          onNone: () => [],
          onSome: kind => bubbleShapes(kind, target, model, camera),
        }),
    }),
)
