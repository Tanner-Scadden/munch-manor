import { Option } from 'effect'

import type { Model } from '../../app/model'
import { textShapes } from '../../art/font'
import { group } from '../../art/sprite'
import type * as Draw from '../../render/draw'
import { FULL_TURN } from '../../render/drawing'
import { doorArrowShapes } from '../../render/powerupView'
import { maybeLockProgress, maybePadlockNudge } from './firstBreakQuest'

const PROGRESS_RIGHT_PX = 6
const PROGRESS_DROP_PX = 4
const NUDGE_PULSE_MS = 1200
const NUDGE_LOW = 0.35

const progressShapes = (model: Model): ReadonlyArray<Draw.Shape> =>
  Option.match(maybeLockProgress(model), {
    onNone: () => [],
    onSome: ({ box, held, price }) =>
      textShapes(
        `$${Math.min(held, price)}/${price}`,
        held >= price ? 'Title' : 'Coin',
        Math.round((box.left + box.right) / 2) + PROGRESS_RIGHT_PX,
        box.bottom + PROGRESS_DROP_PX,
        'Left',
      ),
  })

const nudgeShapes = (model: Model): ReadonlyArray<Draw.Shape> =>
  Option.match(maybePadlockNudge(model), {
    onNone: () => [],
    onSome: mark => [
      group({
        translate: { x: 0, y: 0 },
        opacity:
          NUDGE_LOW +
          (1 - NUDGE_LOW) *
            (0.5 +
              0.5 * Math.sin((FULL_TURN * model.elapsedMs) / NUDGE_PULSE_MS)),
        shapes: doorArrowShapes(mark, model.elapsedMs),
      }),
    ],
  })

export const questLockShapes = (model: Model): ReadonlyArray<Draw.Shape> => [
  ...progressShapes(model),
  ...nudgeShapes(model),
]
