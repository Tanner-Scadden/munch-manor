import type { Canvas } from 'foldkit'

import type { Model } from '../../app/model'
import { rect } from '../../render/drawing'
import { Finale } from '../../world/dare/dareSchema'
import { isFrontDoorOpen, unlockShareOf } from '../../world/dare/finale'
import { levelOf } from '../../world/level/arena'

// The front door in the finale (src/world/dare/finale.ts), over its baked
// art (src/render/room/diningArt.ts): while it unlocks, a bar over the
// lintel fills gold and the padlock blinks; once it is open, the leaves are
// gone and the night outside shows through, with a warm spill on the sill.

const BAR_HEIGHT = 2
const BAR_RISE = 7
const BLINK_MS = 400
const TRACK_COLOR = 'rgba(10, 8, 14, 0.8)'
const FILL_COLOR = '#ffd23f'
const GLINT_COLOR = '#fff7d0'
const NIGHT_COLOR = '#0b0a1a'
const STARLIGHT_COLOR = '#2a2850'
const SPILL_COLOR = 'rgba(255, 210, 120, 0.35)'

export const frontDoorShapes = (model: Model): ReadonlyArray<Canvas.Shape> => {
  if (Finale.isAnyOf(['Hunting', 'Summoned'])(model.dare.finale)) {
    return []
  }
  const { box } = levelOf(model).thresholds.Front
  const width = box.right - box.left
  const height = box.bottom - box.top
  if (isFrontDoorOpen(model)) {
    return [
      rect(box.left, box.top, width, height, NIGHT_COLOR),
      rect(box.left + 2, box.top + 2, width - 4, 1, STARLIGHT_COLOR),
      rect(box.left, box.top - 3, width, 3, SPILL_COLOR),
    ]
  }
  const middle = box.left + Math.floor(width / 2)
  return [
    rect(box.left, box.top - BAR_RISE, width, BAR_HEIGHT, TRACK_COLOR),
    rect(
      box.left,
      box.top - BAR_RISE,
      Math.round(width * unlockShareOf(model)),
      BAR_HEIGHT,
      FILL_COLOR,
    ),
    ...(Math.floor(model.elapsedMs / BLINK_MS) % 2 === 0
      ? [rect(middle - 1, box.top + 3, 3, 3, GLINT_COLOR)]
      : []),
  ]
}
