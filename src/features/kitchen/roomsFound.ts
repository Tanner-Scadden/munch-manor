import { Array, Function } from 'effect'
import type { Canvas } from 'foldkit'

import type { Model } from '../../app/model'
import { textShapes, textWidth } from '../../art/font'
import { type Palette, TOP_LEFT, spriteShapes } from '../../art/sprite'
import { KitchenCall } from '../../domain/clientSchema'
import { placeSprite, rect } from '../../render/drawing'
import { type Level, levelOf } from '../../world/level/arena'
import { Phase } from '../../world/schema/worldSchema'

// NOTE: from the owner (2026-11-01), players were not finding the kitchen.
// In a break, a small house and "1/3" says there is more to the map: the
// rooms opened out of the rooms on it, read from the level's exits (the
// start room plus one for each exit). It turns gold with a sparkle when the
// last one opens. It is only a readout, never a button.
export const roomsOf = (level: Level): { found: number; total: number } => ({
  found: 1 + Array.length(Array.filter(level.exits, ({ isOpen }) => isOpen)),
  total: 1 + level.exits.length,
})

const isRoomsCounterShown = (model: Model): boolean =>
  Phase.isAnyOf(['Preparation'])(model.phase) &&
  roomsOf(levelOf(model)).total > 1

const HOUSE_PALETTE: Palette = {
  o: '#140c10',
  r: '#c8483c',
  R: '#e8685a',
  w: '#f4f1de',
  d: '#8a5a32',
  y: '#ffe066',
}

const HOUSE = spriteShapes(
  ['...o...', '..oRo..', '.oRRRo.', 'orrrrro', '.owywo.', '.owdwo.', '.owdwo.'],
  HOUSE_PALETTE,
  TOP_LEFT,
)

const HOUSE_SIZE = 7
const ICON_GAP = 2
const SPARKLE_MS = 1400
const SPARKLE_STEP_MS = 140

const SPARKLE_SPOTS: ReadonlyArray<readonly [number, number]> = [
  [-2, 0],
  [HOUSE_SIZE, 1],
  [3, -2],
  [-1, 5],
  [HOUSE_SIZE - 1, 6],
]

const sparklesOf = (
  x: number,
  y: number,
  ageMs: number,
): ReadonlyArray<Canvas.Shape> => {
  const step = Math.floor(ageMs / SPARKLE_STEP_MS)
  return ageMs >= SPARKLE_MS
    ? []
    : Array.flatMap(SPARKLE_SPOTS, ([dx, dy], index) =>
        (step + index) % 3 === 0
          ? []
          : [
              rect(x + dx, y + dy + 1, 3, 1, '#ffe066'),
              rect(x + dx + 1, y + dy, 1, 3, '#ffe066'),
              rect(x + dx + 1, y + dy + 1, 1, 1, '#ffffff'),
            ],
      )
}

// NOTE: laid out from the right edge: the icon, then "1/2" in gold once
// every room is found. `right` is the text's right edge, `y` its top.
export const roomsCounterShapes: {
  (right: number, y: number): (model: Model) => ReadonlyArray<Canvas.Shape>
  (model: Model, right: number, y: number): ReadonlyArray<Canvas.Shape>
} = Function.dual(
  3,
  (model: Model, right: number, y: number): ReadonlyArray<Canvas.Shape> => {
    if (!isRoomsCounterShown(model)) {
      return []
    }
    const { found, total } = roomsOf(levelOf(model))
    const label = `${found}/${total}`
    const iconX = right - textWidth(label) - ICON_GAP - HOUSE_SIZE
    const sparkle = KitchenCall.match(model.kitchenCall, {
      Quiet: () => [],
      Calling: () => [],
      Opened: ({ ageMs }) => sparklesOf(iconX, y - 1, ageMs),
    })
    return [
      placeSprite(iconX, y - 1, HOUSE),
      ...textShapes(
        label,
        found === total ? 'Prompt' : 'Plain',
        right,
        y,
        'Right',
      ),
      ...sparkle,
    ]
  },
)
