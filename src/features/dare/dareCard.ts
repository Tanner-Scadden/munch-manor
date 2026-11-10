import { Array, Function } from 'effect'
import type { Canvas } from 'foldkit'

import type { Model } from '../../app/model'
import {
  DARE_EMPTY_SLOTS,
  DARE_FOUND_SLOTS,
  DARE_SLOT_SIZE,
} from '../../art/dareArt'
import { placeSprite, rect } from '../../render/drawing'
import type { HudLayout } from '../../render/hudLayout'
import { dareCardOf } from '../../world/dare/dare'
import { Finale } from '../../world/dare/dareSchema'
import { unlockShareOf } from '../../world/dare/finale'

// The dare card on the HUD (LORE.md, "The dare card in your pocket"): this
// run's list as a row of small slots, each an empty outline with the
// thing's dim silhouette, that fills with the thing in full color and a gold
// rim once it is found. Uncle Chunk's party hat is always the last slot.
// Show, don't explain: no words, only the things. Each slot is one baked
// sprite, so the card costs one shape a thing.

const DARE_SLOT_GAP = 1
const DARE_SLOT_STRIDE = DARE_SLOT_SIZE + DARE_SLOT_GAP

// NOTE: laid out from the layout's right edge, the hat last. Endless has
// no list, so no card.
export const dareCardShapes: {
  (layout: HudLayout): (model: Model) => ReadonlyArray<Canvas.Shape>
  (model: Model, layout: HudLayout): ReadonlyArray<Canvas.Shape>
} = Function.dual(
  2,
  (model: Model, layout: HudLayout): ReadonlyArray<Canvas.Shape> => {
    const card = dareCardOf(model)
    const left =
      layout.dareRight - card.length * DARE_SLOT_STRIDE + DARE_SLOT_GAP
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
