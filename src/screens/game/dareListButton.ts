import { Function } from 'effect'
import type { Html } from 'foldkit/html'

import type { ApplicationViewBuilder } from '../../app/composition'
import type { Model } from '../../app/model'
import { pocketBoxOf } from '../../features/dare/dareCard'
import {
  isDareCardToggling,
  isPocketCardOpened,
} from '../../features/dare/pocketCard'
import { isCaseCardUp } from '../../features/onboarding/caseCard'
import { isDebutCardUp } from '../../features/onboarding/onboarding'
import { RunButtonMessage } from '../../input/message'
import { hudLayoutFor } from '../../render/hudLayout'
import { screenOf } from '../../render/screen'
import { percentOf } from '../../ui/menuParts'
import { pocketOf } from './pocket'

// NOTE: the HUD's dare list as a button (Demi and the owner, 2026-11-11):
// a clear button over the pocket the canvas draws, shut or open, that
// opens the dare card again with its satchel, and puts it away. It acts on
// click, so a tap works with a thumb on a stick (src/input/touchTaps.ts),
// and it never moves. Endless has no list, so no button; nor while
// another card holds the round.
const HIT_PAD = 2

export const DARE_LIST_BUTTON_CLASS = 'dare-list-button'

export const dareListButtonView: {
  (h: ApplicationViewBuilder): (model: Model) => Html
  (model: Model, h: ApplicationViewBuilder): Html
} = Function.dual(2, (model: Model, h: ApplicationViewBuilder): Html => {
  if (
    !isDareCardToggling(model) ||
    isDebutCardUp(model) ||
    isCaseCardUp(model)
  ) {
    return h.empty
  }
  const screen = screenOf(model)
  const box = pocketBoxOf(model, hudLayoutFor(screen), pocketOf(model))
  const left = Math.max(0, box.left - HIT_PAD)
  const top = Math.max(0, box.top - HIT_PAD)
  return h.div(
    [h.Class('hud-tap-frame')],
    [
      h.div(
        [h.Class('hud-tap-stage')],
        [
          h.button([
            h.Type('button'),
            h.Class(DARE_LIST_BUTTON_CLASS),
            h.AriaLabel(
              isPocketCardOpened(model)
                ? 'Put the dare card away'
                : 'Open the dare card',
            ),
            h.AriaKeyshortcuts('Tab'),
            h.Style({
              left: percentOf(left, screen.width),
              top: percentOf(top, screen.height),
              width: percentOf(box.right + HIT_PAD - left, screen.width),
              height: percentOf(box.bottom + HIT_PAD - top, screen.height),
            }),
            h.OnClick(RunButtonMessage.ClickedDareList(), {
              focusSelector: '.game-surface',
            }),
          ]),
        ],
      ),
    ],
  )
})
