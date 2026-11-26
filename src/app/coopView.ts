import { Function } from 'effect'

import { isRunEndComing } from '../domain/onlineRun'
import { coopScreenView } from '../features/coop/view'
import { isRunCardHeld } from '../features/end/endBeat'
import { bonesBalanceOf } from '../world/heroes/rank'
import type { ApplicationHtml, ApplicationViewBuilder } from './definition'
import type { Model } from './model'

// NOTE: co-op over the game (src/features/coop/view.ts), handed what it
// reads of the root: the player's look, the device, whether the end card
// holds the run, the Bones and heroes bought, and the dare marks.
export const coopView: {
  (h: ApplicationViewBuilder): (model: Model) => ApplicationHtml | null
  (model: Model, h: ApplicationViewBuilder): ApplicationHtml | null
} = Function.dual(
  2,
  (model: Model, h: ApplicationViewBuilder): ApplicationHtml | null =>
    coopScreenView(
      model.coop,
      {
        look: model.appearance,
        isKeyboard: model.lastDevice === 'KeyboardMouse',
        isRunCardUp: isRunCardHeld(model),
        isRunEndComing: isRunEndComing(model),
        bought: model.boughtCosmetics,
        bones: bonesBalanceOf(model.rank),
        dareMarks: model.dareMarks,
      },
      h,
    ),
)
