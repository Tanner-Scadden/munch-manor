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
import { type Screen, screenOf } from '../../render/screen'
import { percentOf } from '../../ui/menuParts'
import { pocketOf } from './pocket'

// NOTE: the HUD's dare list as a button (Demi and the owner, 2026-11-11):
// a clear button over the pocket the canvas draws, shut or open, that
// opens the dare card again with its satchel, and puts it away. It acts on
// click, so a tap works with a thumb on a stick (src/input/touchTaps.ts),
// and it never moves. Endless has no list, so no button; nor while
// another card holds the round.
const HIT_PAD = 2
const TAP_PX = 48

// NOTE: the corner's buttons end 54 px below the tap frame's top (6 px in
// and 48 px tall, `.corner-buttons` in src/app/styles.css). The stage sits
// centered in the frame, so in the stage that line is up by half the room
// the frame has over the stage.
const CORNER_BOTTOM = `calc(54px - (100cqh - var(--screen-h) * var(--hud-px)) / 2)`

type Span = Readonly<{ top: string; height: string }>

// NOTE: the button's height, never under a thumb's 48 px. On a phone on its
// side it grows out from the list's middle. Upright, the list stands right
// under the pause button, so the button starts at the list's top or the
// corner's bottom, whichever is lower, and grows down from there.
const verticalSpan = (
  layout: Screen['layout'],
  top: string,
  bottom: string,
  height: string,
): Span =>
  layout === 'Portrait'
    ? {
        top: `max(${top}, ${CORNER_BOTTOM})`,
        height: `max(${bottom} - max(${top}, ${CORNER_BOTTOM}), ${TAP_PX}px)`,
      }
    : {
        top: `max(${top} + ${height} / 2, max(${height}, ${TAP_PX}px) / 2)`,
        height: `max(${height}, ${TAP_PX}px)`,
      }

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
  const width = percentOf(box.right + HIT_PAD - left, screen.width)
  const height = percentOf(box.bottom + HIT_PAD - top, screen.height)
  const span = verticalSpan(
    screen.layout,
    percentOf(top, screen.height),
    percentOf(box.bottom + HIT_PAD, screen.height),
    height,
  )
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
            // NOTE: never under a thumb's 48 px: centered across the drawn
            // list and kept inside the screen's sides, its height as
            // verticalSpan says; the art never moves.
            h.Style({
              left: `max(${percentOf(left, screen.width)} + ${width} / 2, max(${width}, ${TAP_PX}px) / 2)`,
              width: `max(${width}, ${TAP_PX}px)`,
              ...span,
              translate: screen.layout === 'Portrait' ? '-50% 0' : '-50% -50%',
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
