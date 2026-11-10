import { Array, Function } from 'effect'
import type { Canvas } from 'foldkit'

import type { Model } from '../../app/model'
import {
  DARE_EMPTY_SLOTS,
  DARE_FOUND_SLOTS,
  DARE_SLOT_SIZE,
} from '../../art/dareArt'
import { bakeText, placeBaked } from '../../art/font'
import { TOP_LEFT, spriteShapes } from '../../art/sprite'
import { placeSprite, rect } from '../../render/drawing'
import type { HudLayout } from '../../render/hudLayout'
import { dareCardOf } from '../../world/dare/dare'
import { Finale } from '../../world/dare/dareSchema'
import { unlockShareOf } from '../../world/dare/finale'
import type { Vector } from '../../world/schema/worldSchema'

// The dare card on the HUD (LORE.md, "The dare card in your pocket"): this
// run's list as a row of small slots, each an empty outline with the
// thing's dim silhouette, that fills with the thing in full color and a gold
// rim once it is found. Uncle Chunk's party hat is always the last slot.
// Show, don't explain: no words, only the things. Each slot is one baked
// sprite, so the card costs one shape a thing.

const DARE_SLOT_GAP = 1
const DARE_SLOT_STRIDE = DARE_SLOT_SIZE + DARE_SLOT_GAP

const cardLeftOf = (count: number, layout: HudLayout): number =>
  layout.dareRight - count * DARE_SLOT_STRIDE + DARE_SLOT_GAP

// NOTE: where each slot's thing sits on the HUD, in the card's order, for
// the dare card in your pocket to fold into (src/features/dare/pocketCardView.ts).
// A slot's thing sits one pixel inside its outline.
export const dareSlotSpotsOf: {
  (layout: HudLayout): (model: Model) => ReadonlyArray<Vector>
  (model: Model, layout: HudLayout): ReadonlyArray<Vector>
} = Function.dual(
  2,
  (model: Model, layout: HudLayout): ReadonlyArray<Vector> => {
    const card = dareCardOf(model)
    const left = cardLeftOf(card.length, layout)
    return Array.map(card, (_thing, index) => ({
      x: left + index * DARE_SLOT_STRIDE + 1,
      y: layout.dareTop + 1,
    }))
  },
)

// NOTE: laid out from the layout's right edge, the hat last. Endless has
// no list, so no card.
export const dareCardShapes: {
  (layout: HudLayout): (model: Model) => ReadonlyArray<Canvas.Shape>
  (model: Model, layout: HudLayout): ReadonlyArray<Canvas.Shape>
} = Function.dual(
  2,
  (model: Model, layout: HudLayout): ReadonlyArray<Canvas.Shape> => {
    const card = dareCardOf(model)
    const left = cardLeftOf(card.length, layout)
    return [
      ...Array.map(card, ({ kind, isFound }, index) =>
        placeSprite(
          left + index * DARE_SLOT_STRIDE,
          layout.dareTop,
          isFound ? DARE_FOUND_SLOTS[kind] : DARE_EMPTY_SLOTS[kind],
        ),
      ),
      ...unlockBarShapes(
        model,
        left,
        layout.dareTop + DARE_SLOT_SIZE + DARE_SLOT_GAP,
        layout.dareRight - left,
      ),
    ]
  },
)

// NOTE: under the card, once the hat is taken, the front door's unlock as a
// bar that fills gold, full once the door is open.
const UNLOCK_BAR_HEIGHT = 2

const unlockBarShapes = (
  model: Model,
  left: number,
  top: number,
  width: number,
): ReadonlyArray<Canvas.Shape> =>
  Finale.isAnyOf(['Unlocking', 'Open'])(model.dare.finale)
    ? [
        rect(left, top, width, UNLOCK_BAR_HEIGHT, 'rgba(10, 8, 14, 0.8)'),
        rect(
          left,
          top,
          Math.round(width * unlockShareOf(model)),
          UNLOCK_BAR_HEIGHT,
          '#ffd23f',
        ),
      ]
    : []

// POINTED AT

// NOTE: the guided first break's last step (src/features/onboarding/firstBreakQuest.ts)
// points at the card: a gold rim round it that blinks, an arrow under it
// bobbing up, and its one word.
const POINT_BLINK_MS = 300
const POINT_BOB_MS = 260
const POINT_GAP = 2
const RIM_LIT = '#ffe066'
const RIM_DIM = 'rgba(255, 224, 102, 0.45)'

const UP_ARROW = spriteShapes(
  ['...o...', '..owo..', '.owwwo.', 'owwwwwo', 'ooooooo'],
  { o: '#140c10', w: '#f4f1de' },
  TOP_LEFT,
)
const UP_ARROW_HALF_WIDTH = 3
const UP_ARROW_HEIGHT = 5

const DARE_WORD = bakeText('DARE', 'Prompt')

const rimShapes = (
  left: number,
  top: number,
  width: number,
  height: number,
  fill: string,
): ReadonlyArray<Canvas.Shape> => [
  rect(left - 1, top - 1, width + 2, 1, fill),
  rect(left - 1, top + height, width + 2, 1, fill),
  rect(left - 1, top, 1, height, fill),
  rect(left + width, top, 1, height, fill),
]

export const dareCardPointShapes: {
  (layout: HudLayout): (model: Model) => ReadonlyArray<Canvas.Shape>
  (model: Model, layout: HudLayout): ReadonlyArray<Canvas.Shape>
} = Function.dual(
  2,
  (model: Model, layout: HudLayout): ReadonlyArray<Canvas.Shape> => {
    const count = dareCardOf(model).length
    if (count === 0) {
      return []
    }
    const left = cardLeftOf(count, layout)
    const width = layout.dareRight - left
    const centerX = Math.round(left + width / 2)
    const arrowTop =
      layout.dareTop +
      DARE_SLOT_SIZE +
      POINT_GAP +
      (Math.floor(model.elapsedMs / POINT_BOB_MS) % 2)
    const isLit = Math.floor(model.elapsedMs / POINT_BLINK_MS) % 2 === 0
    return [
      ...rimShapes(
        left,
        layout.dareTop,
        width,
        DARE_SLOT_SIZE,
        isLit ? RIM_LIT : RIM_DIM,
      ),
      placeSprite(centerX - UP_ARROW_HALF_WIDTH, arrowTop, UP_ARROW),
      placeBaked(DARE_WORD, {
        x: centerX,
        y: arrowTop + UP_ARROW_HEIGHT + 1,
        align: 'Center',
      }),
    ]
  },
)
