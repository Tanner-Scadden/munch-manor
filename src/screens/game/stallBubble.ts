import { Array, Function, Option } from 'effect'
import { Canvas } from 'foldkit'

import type { Model } from '../../app/model'
import { DARE_BIG_ICONS, DARE_BIG_ICON_SIZE } from '../../art/dareArt'
import { bakeText } from '../../art/font'
import {
  type Palette,
  type Sprite,
  TOP_LEFT,
  bakeShapes,
  placeAt,
  spriteShapes,
} from '../../art/sprite'
import { maybeDarePointer } from '../../features/dare/darePointer'
import { isPocketCardOut } from '../../features/dare/pocketCard'
import { HINT_LINES, maybeHintCall } from '../../features/dare/rattlesHint'
import {
  CALL_LINES,
  callLineIndex,
  maybeCallTarget,
} from '../../features/kitchen/kitchenCall'
import {
  kitchenStepOf,
  maybeKitchenMark,
} from '../../features/onboarding/kitchenTour'
import {
  RATTLES_INTRO_LINES,
  maybeRattlesLine,
} from '../../features/onboarding/rattlesIntro'
import { type Camera, viewBoxOf, worldToView } from '../../render/camera'
import { FULL_TURN, placeSprite } from '../../render/drawing'
import { startWavePillBox } from '../../render/hudLayout'
import {
  type Screen,
  landscapeFrameOffset,
  screenOf,
  stagePlacement,
} from '../../render/screen'
import type { DareKind } from '../../world/dare/dareSchema'
import { fridgeBoxOf } from '../../world/fridge/leftovers'
import { RATTLES_BOX, levelOf } from '../../world/level/arena'
import { Phase, type Vector } from '../../world/schema/worldSchema'
import { maybeBannerBand } from './overlay'
import { keyRingBoxOf, maybePocketKeepout } from './pocket'

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

type Good = Readonly<{
  sprite: Sprite
  isCentered: boolean
  width: number
  height: number
}>

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
  height: 7,
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
  height: 7,
}

const lineGood = (line: string): Good => {
  const baked = bakeText(line, 'Ink')
  return {
    sprite: [placeAt(0, 1, baked.sprite)],
    isCentered: false,
    width: baked.width,
    height: 7,
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
const TAIL = 3

const GOODS: Readonly<Record<BubbleKind, ReadonlyArray<Good>>> = {
  Gift: [GIFT],
  Leave: [FOOTSTEPS, CROSS],
  Soup0: soupGoods(0),
  Soup1: soupGoods(1),
  Soup2: soupGoods(2),
}

const goodsWidth = (goods: ReadonlyArray<Good>): number =>
  PAD * 2 +
  Array.reduce(goods, 0, (sum, good) => sum + good.width) +
  (goods.length - 1) * ICON_GAP

const goodsHeight = (goods: ReadonlyArray<Good>): number =>
  PAD * 2 +
  Array.reduce(goods, ICON_SIZE, (most, good) => Math.max(most, good.height))

const bubbleWidth = (kind: BubbleKind): number => goodsWidth(GOODS[kind])

const BUBBLE_INK = '#140c10'
const BUBBLE_FILL = '#f4f1de'

// NOTE: the frame and its tail, a fixed set of whole pixel rectangles,
// baked once per kind. The tail sits at the bottom right, toward Rattles.
const frameRects = (
  width: number,
  height: number,
  edge: string,
): ReadonlyArray<Canvas.Shape> => [
  Canvas.Rect({
    x: 1,
    y: 0,
    width: width - 2,
    height,
    fill: edge,
  }),
  Canvas.Rect({ x: 0, y: 1, width, height: height - 2, fill: edge }),
  Canvas.Rect({
    x: 1,
    y: 1,
    width: width - 2,
    height: height - 2,
    fill: BUBBLE_FILL,
  }),
  Canvas.Rect({
    x: width - TAIL - 3,
    y: height,
    width: TAIL,
    height: 1,
    fill: edge,
  }),
  Canvas.Rect({
    x: width - 4,
    y: height + 1,
    width: 2,
    height: 1,
    fill: edge,
  }),
  Canvas.Rect({
    x: width - 3,
    y: height + 2,
    width: 1,
    height: 1,
    fill: edge,
  }),
]

const FRAMES: Readonly<Record<BubbleKind, Sprite>> = {
  Gift: bakeShapes(
    frameRects(bubbleWidth('Gift'), goodsHeight(GOODS['Gift']), BUBBLE_INK),
  ),
  Leave: bakeShapes(
    frameRects(bubbleWidth('Leave'), goodsHeight(GOODS['Leave']), BUBBLE_INK),
  ),
  Soup0: bakeShapes(
    frameRects(bubbleWidth('Soup0'), goodsHeight(GOODS['Soup0']), BUBBLE_INK),
  ),
  Soup1: bakeShapes(
    frameRects(bubbleWidth('Soup1'), goodsHeight(GOODS['Soup1']), BUBBLE_INK),
  ),
  Soup2: bakeShapes(
    frameRects(bubbleWidth('Soup2'), goodsHeight(GOODS['Soup2']), BUBBLE_INK),
  ),
}

// PLACING

type Side = 'Left' | 'Right' | 'Up' | 'Down' | 'Inside'

const EDGE_MARGIN = 4
const HUD_CLEARANCE = 22
const ARROW_LENGTH = 4
const BOB_MS = 900
const RATTLES_HEAD_LIFT = 6

// NOTE: Rattles' spot, where his bubble's tail tip hangs when it points at
// nothing else: by his head, over his trunk by the front door
// (src/features/rattles/rattlesSpot.ts).
const RATTLES_TIP: Vector = {
  x: RATTLES_BOX.left + 1,
  y: RATTLES_BOX.top - RATTLES_HEAD_LIFT,
}

export const rattlesSpot = (): Vector => RATTLES_TIP

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
  height: number,
  color: string,
): ReadonlyArray<Canvas.Shape> => {
  const midY = y + Math.floor(height / 2)
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
        y: y + height + TAIL + 1 + step,
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

// NOTE: each good centered on the bubble's height, so a line sits level
// with a big icon beside it.
const goodsShapes = (
  goods: ReadonlyArray<Good>,
  x: number,
  y: number,
  height: number,
): ReadonlyArray<Canvas.Shape> =>
  Array.reduce(
    goods,
    { left: x + PAD, shapes: Array.empty<Canvas.Shape>() },
    ({ left, shapes }, good) => {
      const top = y + Math.floor((height - good.height) / 2)
      return {
        left: left + good.width + ICON_GAP,
        shapes: [
          ...shapes,
          good.isCentered
            ? placeSprite(left + 3, top + 3, good.sprite)
            : placeSprite(left, top, good.sprite),
        ],
      }
    },
  ).shapes

type Bubble = Readonly<{
  goods: ReadonlyArray<Good>
  frame: Sprite
  width: number
  height: number
}>

const bubbleOfKind = (kind: BubbleKind): Bubble => ({
  goods: GOODS[kind],
  frame: FRAMES[kind],
  width: bubbleWidth(kind),
  height: goodsHeight(GOODS[kind]),
})

// NOTE: a bubble baked once from its goods.
const bubbleOf = (goods: ReadonlyArray<Good>): Bubble => {
  const width = goodsWidth(goods)
  const height = goodsHeight(goods)
  return {
    goods,
    frame: bakeShapes(frameRects(width, height, BUBBLE_INK)),
    width,
    height,
  }
}

const bubbleShapes = (
  kind: BubbleKind,
  tipInWorld: Vector,
  model: Model,
  camera: Camera,
): ReadonlyArray<Canvas.Shape> =>
  placedBubble(
    {
      bubble: bubbleOfKind(kind),
      tipInWorld,
      isPointing: true,
      inset: 0,
      maybeUnder: Option.none(),
    },
    model,
    camera,
  )

// NOTE: what a bubble keeps out of, in screen pixels: the dare pocket on
// the HUD with its unlock bar, the key ring, and a banner's rows while one shows. A
// bubble over one moves under it, or over it when there is no room under.
type Keepout = Readonly<{
  left: number
  top: number
  right: number
  bottom: number
}>

const KEEPOUT_GAP = 2

// NOTE: on touch a break's START WAVE pill stands over the gun row, an HTML
// button the canvas cannot draw over, so a bubble keeps clear of it too.
const startWaveKeepout = (
  model: Model,
  screen: Screen,
): ReadonlyArray<Keepout> =>
  model.lastDevice === 'Touch' && Phase.isAnyOf(['Preparation'])(model.phase)
    ? Option.match(model.maybeSurface, {
        onNone: () => [],
        onSome: surface => {
          const box = startWavePillBox(
            screen,
            stagePlacement(surface, screen).scale,
          )
          return [
            {
              left: box.x,
              top: box.y,
              right: box.x + box.width,
              bottom: box.y + box.height,
            },
          ]
        },
      })
    : []

const keepoutsOf = (model: Model): ReadonlyArray<Keepout> => {
  const screen = screenOf(model)
  const frameTop = landscapeFrameOffset(screen).y
  const card: ReadonlyArray<Keepout> = Option.toArray(maybePocketKeepout(model))
  const banner: ReadonlyArray<Keepout> = Option.match(maybeBannerBand(model), {
    onNone: () => [],
    onSome: band => [
      {
        left: 0,
        top: band.top + frameTop,
        right: screen.width,
        bottom: band.bottom + frameTop,
      },
    ],
  })
  return [
    ...card,
    keyRingBoxOf(model),
    ...banner,
    ...startWaveKeepout(model, screen),
  ]
}

const clearOfHud = (
  model: Model,
  { width, height: bubbleHeight }: Bubble,
  x: number,
  y: number,
  top: number,
  bottom: number,
): number =>
  Array.reduce(keepoutsOf(model), y, (placed, keepout) => {
    const height = bubbleHeight + TAIL
    const isOver =
      x < keepout.right &&
      x + width > keepout.left &&
      placed < keepout.bottom &&
      placed + height > keepout.top
    if (!isOver) {
      return placed
    }
    const under = keepout.bottom + KEEPOUT_GAP
    return under <= bottom
      ? under
      : Math.max(top, keepout.top - KEEPOUT_GAP - height)
  })

// NOTE: where a bubble goes: the spot its tail tip points at, whether it
// draws its own arrow toward that spot out of view, and how much further
// in from the window's edge it waits (room for the dare's gold arrow).
type Placing = Readonly<{
  bubble: Bubble
  tipInWorld: Vector
  isPointing: boolean
  inset: number
  maybeUnder: Option.Option<Vector>
}>

// NOTE: a bubble whose tail tip points at a spot in the world, pinned to
// the window's edge, with an arrow toward the spot when it is out of view
// and the bubble points.
const placedBubble = (
  { bubble, tipInWorld, isPointing, inset, maybeUnder }: Placing,
  model: Model,
  camera: Camera,
): ReadonlyArray<Canvas.Shape> => {
  const { goods, frame, width, height } = bubble
  const view = viewBoxOf(camera)
  const tip = worldToView(camera, tipInWorld)
  const bob = Math.round(Math.sin((FULL_TURN * model.elapsedMs) / BOB_MS) * 1)
  const margin = EDGE_MARGIN + ARROW_LENGTH + inset
  const left = view.x + margin
  const right = view.x + view.width - margin - width
  const top = view.y + HUD_CLEARANCE + inset
  const bottom = view.y + view.height - margin - height - TAIL
  const wantedX = Math.round(tip.x) - width + 2
  const wantedY = Math.round(tip.y) - height - TAIL
  const x = Math.max(left, Math.min(right, wantedX))
  // NOTE: with no room over the spot in view, the bubble hangs under the
  // spot it may name, so it never covers the thing it is about.
  const underY = Option.getOrElse(
    Option.filter(
      Option.map(maybeUnder, under => Math.round(worldToView(camera, under).y)),
      y => wantedY < top && y >= view.y && y <= bottom,
    ),
    () => Math.max(top, Math.min(bottom, wantedY)),
  )
  const y = clearOfHud(model, bubble, x, underY, top, bottom) + bob
  const side = sideOf({ x: wantedX, y: wantedY }, left, right, top, bottom)
  return [
    placeSprite(x, y, frame),
    ...goodsShapes(goods, x, y, height),
    ...(side === 'Inside' || !isPointing
      ? []
      : arrowRects(side, x, y, width, height, BUBBLE_INK)),
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

// RATTLES' HINTS

// NOTE: the thing a hint is about, big and clear beside the line.
const dareIconGood = (kind: DareKind): Good => ({
  sprite: DARE_BIG_ICONS[kind],
  isCentered: false,
  width: DARE_BIG_ICON_SIZE,
  height: DARE_BIG_ICON_SIZE,
})

// NOTE: every hint's bubble baked once: the thing it is about, and the line.
const HINT_BUBBLES: ReadonlyMap<string, Bubble> = new Map(
  Array.map(HINT_LINES, ({ line, maybeIcon }): readonly [string, Bubble] => [
    line,
    bubbleOf([
      ...Option.toArray(Option.map(maybeIcon, dareIconGood)),
      lineGood(line),
    ]),
  ]),
)

// NOTE: a hint about a thing hangs over the gold arrow over it
// (src/features/dare/darePointer.ts), and out of view waits further in
// than that arrow at the window's edge, which points the way in its place.
const HINT_TIP_OVER_POINTER = 12
const HINT_INSET = 12
const HINT_UNDER_GAP = 6

// NOTE: Rattles' hint about the dare (src/features/dare/rattlesHint.ts):
// over the thing it is about, pinned to the window's edge with an arrow
// toward it when it is out of view, or from his own spot, pointing nowhere.
export const dareHintShapes: {
  (camera: Camera): (model: Model) => ReadonlyArray<Canvas.Shape>
  (model: Model, camera: Camera): ReadonlyArray<Canvas.Shape>
} = Function.dual(
  2,
  (model: Model, camera: Camera): ReadonlyArray<Canvas.Shape> =>
    Option.match(
      isPocketCardOut(model) ? Option.none() : maybeHintCall(model),
      {
        onNone: () => [],
        onSome: ({ line, maybeTarget }) =>
          Option.match(Option.fromNullishOr(HINT_BUBBLES.get(line)), {
            onNone: () => [],
            onSome: bubble =>
              Option.match(
                Option.flatMap(maybeTarget, () => maybeDarePointer(model)),
                {
                  onNone: () =>
                    placedBubble(
                      {
                        bubble,
                        tipInWorld: rattlesSpot(),
                        isPointing: false,
                        inset: 0,
                        maybeUnder: Option.none(),
                      },
                      model,
                      camera,
                    ),
                  onSome: mark =>
                    placedBubble(
                      {
                        bubble,
                        tipInWorld: {
                          x: mark.x,
                          y: mark.y - HINT_TIP_OVER_POINTER,
                        },
                        isPointing: false,
                        inset: HINT_INSET,
                        maybeUnder: Option.map(maybeTarget, target => ({
                          x: target.x,
                          y: target.y + HINT_UNDER_GAP,
                        })),
                      },
                      model,
                      camera,
                    ),
                },
              ),
          }),
      },
    ),
)

// RATTLES' HELLO

// NOTE: each line of his hello (src/features/onboarding/rattlesIntro.ts)
// baked once.
const INTRO_BUBBLES: ReadonlyMap<string, Bubble> = new Map(
  Array.map(RATTLES_INTRO_LINES, (line): readonly [string, Bubble] => [
    line,
    bubbleOf([lineGood(line)]),
  ]),
)

// NOTE: his hello hangs from his own spot and points at it, so with him off
// screen the bubble waits at the window's edge with an arrow toward him.
export const rattlesIntroShapes: {
  (camera: Camera): (model: Model) => ReadonlyArray<Canvas.Shape>
  (model: Model, camera: Camera): ReadonlyArray<Canvas.Shape>
} = Function.dual(
  2,
  (model: Model, camera: Camera): ReadonlyArray<Canvas.Shape> =>
    Option.match(
      Option.flatMap(maybeRattlesLine(model), line =>
        Option.fromNullishOr(INTRO_BUBBLES.get(line)),
      ),
      {
        onNone: () => [],
        onSome: bubble =>
          placedBubble(
            {
              bubble,
              tipInWorld: rattlesSpot(),
              isPointing: true,
              inset: 0,
              maybeUnder: Option.none(),
            },
            model,
            camera,
          ),
      },
    ),
)
