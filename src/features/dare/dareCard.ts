import { Array, Function } from 'effect'
import type { Canvas } from 'foldkit'

import type { Model } from '../../app/model'
import {
  DARE_CARD_HEIGHT,
  DARE_CARD_ICON,
  DARE_CARD_WIDTH,
  DARE_CHECK,
  DARE_CHECK_SIZE,
  DARE_EMPTY_SLOTS,
  DARE_FOUND_SLOTS,
  DARE_SLOT_SIZE,
} from '../../art/dareArt'
import { bakeText, placeBaked, textShapes, textWidth } from '../../art/font'
import { TOP_LEFT, group, spriteShapes } from '../../art/sprite'
import { placeSprite, rect } from '../../render/drawing'
import { type HudLayout, POCKET_CHIP_HEIGHT } from '../../render/hudLayout'
import { dareCardOf } from '../../world/dare/dare'
import { Finale } from '../../world/dare/dareSchema'
import { unlockShareOf } from '../../world/dare/finale'
import type { Vector } from '../../world/schema/worldSchema'

// The dare card on the HUD (LORE.md, "The dare card in your pocket"), as a
// pocket. Through a wave it is shut: a chip of the card and how many things
// are found ("2/5"), so nothing covers the room while zombies come. In a
// break, when the house is there to search, it opens into the whole list:
// each thing at twice its size in a slot, a light silhouette until found,
// then in color with a green check. Uncle Chunk's party hat is always the
// last slot. Show, don't explain: no words, only the things. The screen
// decides which (src/screens/game/pocket.ts), since a banner in the open
// list's rows keeps it shut.

export type DarePocket = 'Shut' | 'Open'

export type PocketBox = Readonly<{
  left: number
  top: number
  right: number
  bottom: number
}>

const POCKET_PAD = 3
const SLOT_GAP = 1
const SLOT_STRIDE = DARE_SLOT_SIZE + SLOT_GAP
const HEADER_GAP = 2
const CHIP_GAP = 3
const COUNT_SCALE = 2
const COUNT_TOP = 2

const POCKET_FILL = 'rgba(18, 13, 22, 0.94)'
const SHUT_RIM = '#6f6580'
const OPEN_RIM = '#ffe066'

type Card = ReturnType<typeof dareCardOf>

const foundOf = (card: Card): number =>
  Array.length(Array.filter(card, ({ isFound }) => isFound))

const countLabel = (card: Card): string =>
  `${foundOf(card)}/${Array.length(card)}`

const chipWidth = (card: Card): number =>
  POCKET_PAD +
  DARE_CARD_WIDTH +
  CHIP_GAP +
  textWidth(countLabel(card)) * COUNT_SCALE +
  POCKET_PAD +
  1

const openWidth = (card: Card): number =>
  POCKET_PAD * 2 + Array.length(card) * SLOT_STRIDE - SLOT_GAP

const OPEN_HEIGHT =
  POCKET_PAD + DARE_CARD_HEIGHT + HEADER_GAP + DARE_SLOT_SIZE + POCKET_PAD

const boxOf = (card: Card, layout: HudLayout, pocket: DarePocket): PocketBox =>
  pocket === 'Shut'
    ? {
        left: layout.pocket.shutRight - chipWidth(card),
        top: layout.pocket.shutTop,
        right: layout.pocket.shutRight,
        bottom: layout.pocket.shutTop + POCKET_CHIP_HEIGHT,
      }
    : {
        left: layout.pocket.openRight - openWidth(card),
        top: layout.pocket.openTop,
        right: layout.pocket.openRight,
        bottom: layout.pocket.openTop + OPEN_HEIGHT,
      }

// NOTE: what the pocket covers, for what must keep clear of it (Rattles'
// bubbles, the boss's bar beside it on a portrait HUD, a banner).
export const pocketBoxOf: {
  (layout: HudLayout, pocket: DarePocket): (model: Model) => PocketBox
  (model: Model, layout: HudLayout, pocket: DarePocket): PocketBox
} = Function.dual(
  3,
  (model: Model, layout: HudLayout, pocket: DarePocket): PocketBox =>
    boxOf(dareCardOf(model), layout, pocket),
)

// NOTE: where the open pocket's header has room on its right, for the rooms
// counter the screen puts there (src/features/kitchen/roomsFound.ts): its
// right edge and its text's top.
export const pocketHeaderOf: {
  (layout: HudLayout): (model: Model) => Vector
  (model: Model, layout: HudLayout): Vector
} = Function.dual(2, (model: Model, layout: HudLayout): Vector => {
  const box = boxOf(dareCardOf(model), layout, 'Open')
  return { x: box.right - POCKET_PAD, y: box.top + POCKET_PAD + 2 }
})

// NOTE: where each picture of the card in your pocket lands as it folds
// (src/features/dare/pocketCardView.ts), the hat last: inside its own slot
// on the open list, at the slot's size, so the player sees the card become
// the list; or, with the pocket shut (a banner over the list), all on the
// shut chip's card.
export const pocketSlotSpotsOf: {
  (
    layout: HudLayout,
    pocket: DarePocket,
  ): (model: Model) => ReadonlyArray<Vector>
  (model: Model, layout: HudLayout, pocket: DarePocket): ReadonlyArray<Vector>
} = Function.dual(
  3,
  (
    model: Model,
    layout: HudLayout,
    pocket: DarePocket,
  ): ReadonlyArray<Vector> => {
    const card = dareCardOf(model)
    const box = boxOf(card, layout, pocket)
    return pocket === 'Shut'
      ? Array.map(card, () => ({
          x: box.left + POCKET_PAD,
          y: box.top + POCKET_PAD,
        }))
      : Array.map(card, (_, index) => ({
          x: box.left + POCKET_PAD + index * SLOT_STRIDE + 1,
          y: box.top + POCKET_PAD + DARE_CARD_HEIGHT + HEADER_GAP + 1,
        }))
  },
)

// A rim one pixel wide with its corners cut, round a dark fill.
const frameShapes = (
  box: PocketBox,
  rim: string,
): ReadonlyArray<Canvas.Shape> => {
  const width = box.right - box.left
  const height = box.bottom - box.top
  return [
    rect(box.left + 1, box.top, width - 2, 1, rim),
    rect(box.left + 1, box.bottom - 1, width - 2, 1, rim),
    rect(box.left, box.top + 1, 1, height - 2, rim),
    rect(box.right - 1, box.top + 1, 1, height - 2, rim),
    rect(box.left + 1, box.top + 1, width - 2, height - 2, POCKET_FILL),
  ]
}

const chipShapes = (
  card: Card,
  box: PocketBox,
): ReadonlyArray<Canvas.Shape> => [
  ...frameShapes(box, SHUT_RIM),
  placeSprite(box.left + POCKET_PAD, box.top + POCKET_PAD, DARE_CARD_ICON),
  group({
    translate: {
      x: box.left + POCKET_PAD + DARE_CARD_WIDTH + CHIP_GAP,
      y: box.top + COUNT_TOP,
    },
    scale: { x: COUNT_SCALE, y: COUNT_SCALE },
    shapes: textShapes(
      countLabel(card),
      foundOf(card) === Array.length(card) ? 'Title' : 'Prompt',
      0,
      0,
      'Left',
    ),
  }),
]

const CHECK_INSET = DARE_CHECK_SIZE - 2

// NOTE: the checks are drawn after every slot, so a check hanging past its
// slot's corner is never under the next slot.
const openShapes = (
  card: Card,
  box: PocketBox,
): ReadonlyArray<Canvas.Shape> => {
  const top = box.top + POCKET_PAD + DARE_CARD_HEIGHT + HEADER_GAP
  const left = box.left + POCKET_PAD
  const xOf = (index: number): number => left + index * SLOT_STRIDE
  return [
    ...frameShapes(box, OPEN_RIM),
    placeSprite(left, box.top + POCKET_PAD, DARE_CARD_ICON),
    ...Array.map(card, ({ kind, isFound }, index) =>
      placeSprite(
        xOf(index),
        top,
        isFound ? DARE_FOUND_SLOTS[kind] : DARE_EMPTY_SLOTS[kind],
      ),
    ),
    ...Array.flatMap(card, ({ isFound }, index) =>
      isFound
        ? [
            placeSprite(
              xOf(index) + DARE_SLOT_SIZE - CHECK_INSET,
              top + DARE_SLOT_SIZE - CHECK_INSET,
              DARE_CHECK,
            ),
          ]
        : [],
    ),
  ]
}

// NOTE: laid out from the layout's right edge, the hat last. Endless has
// no list, so no pocket.
export const dareCardShapes: {
  (
    layout: HudLayout,
    pocket: DarePocket,
  ): (model: Model) => ReadonlyArray<Canvas.Shape>
  (
    model: Model,
    layout: HudLayout,
    pocket: DarePocket,
  ): ReadonlyArray<Canvas.Shape>
} = Function.dual(
  3,
  (
    model: Model,
    layout: HudLayout,
    pocket: DarePocket,
  ): ReadonlyArray<Canvas.Shape> => {
    const card = dareCardOf(model)
    if (Array.isReadonlyArrayEmpty(card)) {
      return []
    }
    const box = boxOf(card, layout, pocket)
    return [
      ...(pocket === 'Shut' ? chipShapes(card, box) : openShapes(card, box)),
      ...unlockBarShapes(model, box),
    ]
  },
)

// NOTE: under the pocket, once the hat is taken, the front door's unlock as
// a bar that fills gold, full once the door is open.
const UNLOCK_BAR_HEIGHT = 2
const UNLOCK_BAR_GAP = 1

export const UNLOCK_BAR_ROWS = UNLOCK_BAR_GAP + UNLOCK_BAR_HEIGHT

const unlockBarShapes = (
  model: Model,
  box: PocketBox,
): ReadonlyArray<Canvas.Shape> => {
  const top = box.bottom + UNLOCK_BAR_GAP
  const width = box.right - box.left
  return Finale.isAnyOf(['Unlocking', 'Open'])(model.dare.finale)
    ? [
        rect(box.left, top, width, UNLOCK_BAR_HEIGHT, 'rgba(10, 8, 14, 0.8)'),
        rect(
          box.left,
          top,
          Math.round(width * unlockShareOf(model)),
          UNLOCK_BAR_HEIGHT,
          '#ffd23f',
        ),
      ]
    : []
}

// POINTED AT

// NOTE: the guided first break's last step (src/features/onboarding/firstBreakQuest.ts)
// points at the pocket: a gold rim round it that blinks, an arrow under it
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
  box: PocketBox,
  fill: string,
): ReadonlyArray<Canvas.Shape> => {
  const width = box.right - box.left
  const height = box.bottom - box.top
  return [
    rect(box.left - 1, box.top - 1, width + 2, 1, fill),
    rect(box.left - 1, box.bottom, width + 2, 1, fill),
    rect(box.left - 1, box.top, 1, height, fill),
    rect(box.right, box.top, 1, height, fill),
  ]
}

export const dareCardPointShapes: {
  (
    layout: HudLayout,
    pocket: DarePocket,
  ): (model: Model) => ReadonlyArray<Canvas.Shape>
  (
    model: Model,
    layout: HudLayout,
    pocket: DarePocket,
  ): ReadonlyArray<Canvas.Shape>
} = Function.dual(
  3,
  (
    model: Model,
    layout: HudLayout,
    pocket: DarePocket,
  ): ReadonlyArray<Canvas.Shape> => {
    const card = dareCardOf(model)
    if (Array.isReadonlyArrayEmpty(card)) {
      return []
    }
    const box = boxOf(card, layout, pocket)
    const centerX = Math.round((box.left + box.right) / 2)
    const arrowTop =
      box.bottom +
      UNLOCK_BAR_ROWS +
      POINT_GAP +
      (Math.floor(model.elapsedMs / POINT_BOB_MS) % 2)
    const isLit = Math.floor(model.elapsedMs / POINT_BLINK_MS) % 2 === 0
    return [
      ...rimShapes(box, isLit ? RIM_LIT : RIM_DIM),
      placeSprite(centerX - UP_ARROW_HALF_WIDTH, arrowTop, UP_ARROW),
      placeBaked(DARE_WORD, {
        x: centerX,
        y: arrowTop + UP_ARROW_HEIGHT + 1,
        align: 'Center',
      }),
    ]
  },
)
