import { Function } from 'effect'

import type {
  ApplicationHtml,
  ApplicationViewBuilder,
} from '../../app/definition'
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

const HIT_PAD = 2
const TAP_PX = 48

const CORNER_BOTTOM = `calc(54px - (100cqh - var(--screen-h) * var(--hud-px)) / 2)`

type Span = Readonly<{ top: string; height: string }>

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
  (h: ApplicationViewBuilder): (model: Model) => ApplicationHtml
  (model: Model, h: ApplicationViewBuilder): ApplicationHtml
} = Function.dual(
  2,
  (model: Model, h: ApplicationViewBuilder): ApplicationHtml | null => {
    if (
      !isDareCardToggling(model) ||
      isDebutCardUp(model) ||
      isCaseCardUp(model)
    ) {
      return null
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
    return h.div.class('hud-tap-frame').children(
      h.div.class('hud-tap-stage').children(
        h.button
          .attr('type', 'button')
          .class(DARE_LIST_BUTTON_CLASS)
          .attr(
            'aria-label',
            isPocketCardOpened(model)
              ? 'Put the dare card away'
              : 'Open the dare card',
          )
          .attr('aria-keyshortcuts', 'Tab')
          .style({
            left: `max(${percentOf(left, screen.width)} + ${width} / 2, max(${width}, ${TAP_PX}px) / 2)`,
            width: `max(${width}, ${TAP_PX}px)`,
            ...span,
            translate: screen.layout === 'Portrait' ? '-50% 0' : '-50% -50%',
          })
          .on('click', RunButtonMessage.ClickedDareList()),
      ),
    )
  },
)
