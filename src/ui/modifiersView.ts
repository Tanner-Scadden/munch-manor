import { Function } from 'effect'

import type { View } from '@effect/ui'
import type { Html } from '@effect/ui/html'

import { MODIFIER_ICONS } from '../art/icons'
import { MODIFIER_NAMES } from '../world/names'
import { type Modifier, bonusPercentOfModifier } from '../world/run/modifiers'
import { iconView } from './menuParts'

// The parts of a run modifier's tile that the single player lobby
// (src/features/lobby/lobbyView.ts) and the co-op lobby (src/features/coop/picksView.ts) share. Each
// view builds its own button, as the picks around it are built; the picture,
// the word, and the bonus readout are the same everywhere.

// NOTE: "+115%", the sum of the modifiers on.
const bonusText = (percent: number): string => `+${percent}%`

// NOTE: a tile's picture over its name. The name is capitals by style, and
// the screen reader gets the whole label on the button instead.
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

// NOTE: the total bonus as a gold chip at the end of the row. It is there,
// dim at +0%, so the row never changes width as tiles turn on.
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
