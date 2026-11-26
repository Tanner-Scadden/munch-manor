import { Array, Function } from 'effect'

import type { Model } from '../../app/model'
import { textShapes, textWidth } from '../../art/font'
import { HOUSE_PALETTE, HOUSE_PIXELS } from '../../art/icons'
import { TOP_LEFT, spriteShapes } from '../../art/sprite'
import { KitchenCall } from '../../domain/clientSchema'
import { roomsOf } from '../../domain/run'
import type * as Draw from '../../render/draw'
import { placeSprite, rect } from '../../render/drawing'
import { levelOf } from '../../world/level/arena'
import { Phase } from '../../world/schema/worldSchema'

const isRoomsCounterShown = (model: Model): boolean =>
  Phase.isAnyOf(['Preparation'])(model.phase) &&
  roomsOf(levelOf(model)).total > 1

const HOUSE = spriteShapes(HOUSE_PIXELS, HOUSE_PALETTE, TOP_LEFT)

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
): ReadonlyArray<Draw.Shape> => {
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

export const roomsCounterShapes: {
  (right: number, y: number): (model: Model) => ReadonlyArray<Draw.Shape>
  (model: Model, right: number, y: number): ReadonlyArray<Draw.Shape>
} = Function.dual(
  3,
  (model: Model, right: number, y: number): ReadonlyArray<Draw.Shape> => {
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
