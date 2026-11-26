import { Function } from 'effect'

import type { View } from '@effect/ui'
import type { Html } from '@effect/ui/html'

import { CLOCK_ICON } from '../art/icons'
import { iconView } from './menuParts'

const easyBreakText = (seconds: number): string =>
  seconds > 0 ? `${seconds}s` : '∞'

export const easyBreakLabel = (seconds: number): string =>
  seconds > 0
    ? `Break clock, ${seconds} seconds`
    : 'Break clock, none: waits for READY'

export const easyBreakFaceView: {
  <Message>(
    h: Html.H<Message>,
  ): (seconds: number) => ReadonlyArray<View.Content<Message>>
  <Message>(
    seconds: number,
    h: Html.H<Message>,
  ): ReadonlyArray<View.Content<Message>>
} = Function.dual(
  2,
  <Message>(
    seconds: number,
    h: Html.H<Message>,
  ): ReadonlyArray<View.Content<Message>> => [
    iconView('coop-pick-icon easy-break-icon', CLOCK_ICON, h),
    h.span
      .class('easy-break-value')
      .attr('aria-hidden', 'true')
      .children(easyBreakText(seconds)),
  ],
)
