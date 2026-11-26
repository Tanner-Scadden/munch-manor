import { Function } from 'effect'

import type { View } from '@effect/ui'
import type { Html } from '@effect/ui/html'

import { MODIFIER_ICONS } from '#art/icons.ts'
import { MODIFIER_NAMES } from '#world/names.ts'
import { type Modifier, bonusPercentOfModifier } from '#world/run/modifiers.ts'

import { iconView } from './menuParts.ts'

const bonusText = (percent: number): string => `+${percent}%`

export const modifierFaceView: {
  <Message>(
    h: Html.H<Message>,
  ): (modifier: Modifier) => ReadonlyArray<View.Content<Message>>
  <Message>(
    modifier: Modifier,
    h: Html.H<Message>,
  ): ReadonlyArray<View.Content<Message>>
} = Function.dual(
  2,
  <Message>(
    modifier: Modifier,
    h: Html.H<Message>,
  ): ReadonlyArray<View.Content<Message>> => [
    iconView('modifier-icon', MODIFIER_ICONS[modifier], h),
    h.span
      .class('modifier-name')
      .attr('aria-hidden', 'true')
      .children(MODIFIER_NAMES[modifier]),
  ],
)

export const modifierLabel: {
  (isOn: boolean): (modifier: Modifier) => string
  (modifier: Modifier, isOn: boolean): string
} = Function.dual(
  2,
  (modifier: Modifier, isOn: boolean): string =>
    `${MODIFIER_NAMES[modifier]}, ${bonusText(bonusPercentOfModifier(modifier))}, ${isOn ? 'on' : 'off'}`,
)

export const bonusChipView: {
  <Message>(h: Html.H<Message>): (percent: number) => View.Content<Message>
  <Message>(percent: number, h: Html.H<Message>): View.Content<Message>
} = Function.dual(
  2,
  <Message>(percent: number, h: Html.H<Message>): View.Content<Message> =>
    h.span
      .class('modifier-bonus')
      .attr('data-state', percent > 0 ? 'On' : 'Off')
      .attr('role', 'status')
      .attr('aria-label', `Bonus ${bonusText(percent)}`)
      .children(
        h.span.attr('aria-hidden', 'true').children(bonusText(percent)),
      ),
)
