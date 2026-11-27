import { Array, Function, Option } from 'effect'

import type { Model } from '#app/model.ts'
import { DARE_BIG_ICONS, DARE_BIG_ICON_SIZE } from '#art/dareArt.ts'
import { bakeText } from '#art/font.ts'
import {
  type Palette,
  type Sprite,
  TOP_LEFT,
  bakeShapes,
  placeAt,
  spriteShapes,
} from '#art/sprite.ts'
import { isPocketCardOut } from '#features/dare/pocketCard.ts'
import { HINT_LINES, maybeHintCall } from '#features/dare/rattlesHint.ts'
import { maybeDarePointer } from '#features/dare/views/darePointer.ts'
import { fridgeOddsKeepoutsOf } from '#features/fridge/fridgeView.ts'
import {
  CALL_LINES,
  callLineIndex,
  maybeCallTarget,
} from '#features/kitchen/kitchenCall.ts'
import { maybeQuestMark } from '#features/onboarding/firstBreakQuest.ts'
import {
  kitchenStepOf,
  maybeKitchenMark,
} from '#features/onboarding/kitchenTour.ts'
import {
  RATTLES_INTRO_LINES,
  maybeRattlesLine,
} from '#features/onboarding/rattlesIntro.ts'
import { type Camera, viewBoxOf, worldToView } from '#render/camera/camera.ts'
import { landscapeFrameOffset, screenOf } from '#render/camera/screen.ts'
import * as Draw from '#render/draw.ts'
import { FULL_TURN, placeSprite } from '#render/drawing.ts'
import { doorArrowBox } from '#render/effects/powerupView.ts'
import { type Keepout, clearOfKeepouts } from '#render/hud/keepout.ts'
import type { DareKind } from '#world/dare/dareSchema.ts'
import { fridgeBoxOf } from '#world/fridge/leftovers.ts'
import { RATTLES_BOX, levelOf } from '#world/level/arena.ts'
import type { Vector } from '#world/schema/worldSchema.ts'

import { hintBoxesOf } from './overlay.ts'
import { pinnedKeepoutsOf } from './pocket.ts'

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

const frameRects = (
  width: number,
  height: number,
  edge: string,
): ReadonlyArray<Draw.Shape> => [
  Draw.Rect({
    x: 1,
    y: 0,
    width: width - 2,
    height,
    fill: edge,
  }),
  Draw.Rect({ x: 0, y: 1, width, height: height - 2, fill: edge }),
  Draw.Rect({
    x: 1,
    y: 1,
    width: width - 2,
    height: height - 2,
    fill: BUBBLE_FILL,
  }),
  Draw.Rect({
    x: width - TAIL - 3,
    y: height,
    width: TAIL,
    height: 1,
    fill: edge,
  }),
  Draw.Rect({
    x: width - 4,
    y: height + 1,
    width: 2,
    height: 1,
    fill: edge,
  }),
  Draw.Rect({
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

type Side = 'Left' | 'Right' | 'Up' | 'Down' | 'Inside'

const EDGE_MARGIN = 4
const HUD_CLEARANCE = 22
const ARROW_LENGTH = 4
const ARROW_REACH = ARROW_LENGTH + 1
const BOB_PX = 1
const BOB_MS = 900
const RATTLES_HEAD_LIFT = 6

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
): ReadonlyArray<Draw.Shape> => {
  const midY = y + Math.floor(height / 2)
  const midX = x + Math.floor(width / 2)
  return Array.makeBy(ARROW_LENGTH, step => {
    const reach = ARROW_LENGTH - step
    if (side === 'Right') {
      return Draw.Rect({
        x: x + width + 1 + step,
        y: midY - reach + 1,
        width: 1,
        height: reach * 2 - 1,
        fill: color,
      })
    } else if (side === 'Left') {
      return Draw.Rect({
        x: x - 2 - step,
        y: midY - reach + 1,
        width: 1,
        height: reach * 2 - 1,
        fill: color,
      })
    } else if (side === 'Down') {
      return Draw.Rect({
        x: midX - reach + 1,
        y: y + height + TAIL + 1 + step,
        width: reach * 2 - 1,
        height: 1,
        fill: color,
      })
    } else {
      return Draw.Rect({
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
  goods: ReadonlyArray<Good>,
  x: number,
  y: number,
  height: number,
): ReadonlyArray<Draw.Shape> =>
  Array.reduce(
    goods,
    { left: x + PAD, shapes: Array.empty<Draw.Shape>() },
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
): ReadonlyArray<Draw.Shape> =>
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

const questArrowKeepout = (
  model: Model,
  camera: Camera,
): ReadonlyArray<Keepout> =>
  Option.match(maybeQuestMark(model), {
    onNone: () => [],
    onSome: mark => [doorArrowBox(worldToView(camera, mark))],
  })

const keepoutsOf = (model: Model, camera: Camera): ReadonlyArray<Keepout> => {
  const screen = screenOf(model)
  const frame = landscapeFrameOffset(screen)
  const hints = Array.map(hintBoxesOf(model), box => ({
    left: box.left + frame.x,
    top: box.top + frame.y,
    right: box.right + frame.x,
    bottom: box.bottom + frame.y,
  }))
  const pinned = pinnedKeepoutsOf(model, camera)
  return [
    ...pinned,
    ...fridgeOddsKeepoutsOf(model, camera, pinned),
    ...hints,
    ...questArrowKeepout(model, camera),
  ]
}

type Placing = Readonly<{
  bubble: Bubble
  tipInWorld: Vector
  isPointing: boolean
  inset: number
  maybeUnder: Option.Option<Vector>
}>

const placedBubble = (
  { bubble, tipInWorld, isPointing, inset, maybeUnder }: Placing,
  model: Model,
  camera: Camera,
): ReadonlyArray<Draw.Shape> => {
  const { goods, frame, width, height } = bubble
  const view = viewBoxOf(camera)
  const tip = worldToView(camera, tipInWorld)
  const bob = Math.round(
    Math.sin((FULL_TURN * model.elapsedMs) / BOB_MS) * BOB_PX,
  )
  const margin = EDGE_MARGIN + ARROW_LENGTH + inset
  const left = view.x + margin
  const right = view.x + view.width - margin - width
  const top = view.y + HUD_CLEARANCE + inset
  const bottom = view.y + view.height - margin - height - TAIL
  const wantedX = Math.round(tip.x) - width + 2
  const wantedY = Math.round(tip.y) - height - TAIL
  const x = Math.max(left, Math.min(right, wantedX))
  const underY = Option.getOrElse(
    Option.filter(
      Option.map(maybeUnder, under => Math.round(worldToView(camera, under).y)),
      y => wantedY < top && y >= view.y && y <= bottom,
    ),
    () => Math.max(top, Math.min(bottom, wantedY)),
  )
  const side = sideOf({ x: wantedX, y: wantedY }, left, right, top, bottom)
  const arrowSide = isPointing ? side : 'Inside'
  const above = BOB_PX + (arrowSide === 'Up' ? ARROW_REACH : 0)
  const below = BOB_PX + (arrowSide === 'Down' ? ARROW_REACH : 0)
  const before = arrowSide === 'Left' ? ARROW_REACH : 0
  const after = arrowSide === 'Right' ? ARROW_REACH : 0
  const y =
    clearOfKeepouts({
      keepouts: keepoutsOf(model, camera),
      x: x - before,
      y: underY - above,
      width: width + before + after,
      height: height + TAIL + above + below,
      top: top - above,
      bottom: bottom - above,
    }) +
    above +
    bob
  return [
    placeSprite(x, y, frame),
    ...goodsShapes(goods, x, y, height),
    ...(arrowSide === 'Inside'
      ? []
      : arrowRects(arrowSide, x, y, width, height, BUBBLE_INK)),
  ]
}

const LEAVE_TIP_RIGHT = 26
const LEAVE_TIP_DROP = 32

const kitchenBubbleShapes: {
  (camera: Camera): (model: Model) => ReadonlyArray<Draw.Shape>
  (model: Model, camera: Camera): ReadonlyArray<Draw.Shape>
} = Function.dual(
  2,
  (model: Model, camera: Camera): ReadonlyArray<Draw.Shape> =>
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

export const soupBubbleShapes: {
  (camera: Camera): (model: Model) => ReadonlyArray<Draw.Shape>
  (model: Model, camera: Camera): ReadonlyArray<Draw.Shape>
} = Function.dual(
  2,
  (model: Model, camera: Camera): ReadonlyArray<Draw.Shape> =>
    Option.match(maybeCallTarget(model), {
      onNone: () => [],
      onSome: target =>
        Option.match(Array.get(SOUP_KINDS, callLineIndex(model)), {
          onNone: () => [],
          onSome: kind => bubbleShapes(kind, target, model, camera),
        }),
    }),
)

const dareIconGood = (kind: DareKind): Good => ({
  sprite: DARE_BIG_ICONS[kind],
  isCentered: false,
  width: DARE_BIG_ICON_SIZE,
  height: DARE_BIG_ICON_SIZE,
})

const HINT_BUBBLES: ReadonlyMap<string, Bubble> = new Map(
  Array.map(HINT_LINES, ({ line, maybeIcon }): readonly [string, Bubble] => [
    line,
    bubbleOf([
      ...Option.toArray(Option.map(maybeIcon, dareIconGood)),
      lineGood(line),
    ]),
  ]),
)

const HINT_TIP_OVER_POINTER = 12
const HINT_INSET = 12
const HINT_UNDER_GAP = 6

export const dareHintShapes: {
  (camera: Camera): (model: Model) => ReadonlyArray<Draw.Shape>
  (model: Model, camera: Camera): ReadonlyArray<Draw.Shape>
} = Function.dual(
  2,
  (model: Model, camera: Camera): ReadonlyArray<Draw.Shape> =>
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

const INTRO_BUBBLES: ReadonlyMap<string, Bubble> = new Map(
  Array.map(RATTLES_INTRO_LINES, (line): readonly [string, Bubble] => [
    line,
    bubbleOf([lineGood(line)]),
  ]),
)

const rattlesIntroShapes: {
  (camera: Camera): (model: Model) => ReadonlyArray<Draw.Shape>
  (model: Model, camera: Camera): ReadonlyArray<Draw.Shape>
} = Function.dual(
  2,
  (model: Model, camera: Camera): ReadonlyArray<Draw.Shape> =>
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

const RATTLES_BUBBLES: ReadonlyArray<
  (model: Model, camera: Camera) => ReadonlyArray<Draw.Shape>
> = [
  (model, camera) => kitchenBubbleShapes(model, camera),
  (model, camera) => rattlesIntroShapes(model, camera),
  (model, camera) => soupBubbleShapes(model, camera),
  (model, camera) => dareHintShapes(model, camera),
]

export const rattlesBubbleShapes: {
  (camera: Camera): (model: Model) => ReadonlyArray<Draw.Shape>
  (model: Model, camera: Camera): ReadonlyArray<Draw.Shape>
} = Function.dual(
  2,
  (model: Model, camera: Camera): ReadonlyArray<Draw.Shape> => {
    for (const bubble of RATTLES_BUBBLES) {
      const shapes = bubble(model, camera)
      if (shapes.length > 0) {
        return shapes
      }
    }
    return []
  },
)
