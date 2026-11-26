import { Function } from 'effect'

import { isRunEndComing } from '#domain/onlineRun.ts'
import { coopScreenView } from '#features/coop/view.ts'
import { isRunCardHeld } from '#features/end/endBeat.ts'
import { bonesBalanceOf } from '#world/heroes/rank.ts'

import type { ApplicationHtml, ApplicationViewBuilder } from './definition.ts'
import type { Model } from './model.ts'

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
