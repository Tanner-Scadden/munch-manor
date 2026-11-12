import { Function } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { CLOCK_ICON } from '../art/icons'
import { iconView } from './menuParts'

// The parts of Dare's break clock pill that the single player lobby
// (src/features/lobby/view.ts) and the co-op lobby
// (src/features/coop/picksView.ts) share: a clock and its pick, ∞ for none.
// Each lobby builds its own button, as it does a modifier's tile. A press
// steps to the next choice (EASY_BREAK_CHOICES in
// src/world/run/difficulty.ts).

const easyBreakText = (seconds: number): string =>
  seconds > 0 ? `${seconds}s` : '∞'

export const easyBreakLabel = (seconds: number): string =>
  seconds > 0
    ? `Break clock, ${seconds} seconds`
    : 'Break clock, none: waits for READY'

export const easyBreakFaceView: {
  <Message>(h: HtmlBuilder<Message>): (seconds: number) => ReadonlyArray<Html>
  <Message>(seconds: number, h: HtmlBuilder<Message>): ReadonlyArray<Html>
} = Function.dual(
  2,
  <Message>(seconds: number, h: HtmlBuilder<Message>): ReadonlyArray<Html> => [
    iconView('coop-pick-icon easy-break-icon', CLOCK_ICON, h),
    h.span(
      [h.Class('easy-break-value'), h.AriaHidden(true)],
      [easyBreakText(seconds)],
    ),
  ],
)
