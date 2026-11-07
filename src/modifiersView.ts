import { Function } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { MODIFIER_ICONS } from './icons'
import { iconView } from './menuParts'
import { type Modifier, bonusPercentOfModifier } from './modifiers'
import { MODIFIER_NAMES } from './names'

// The parts of a run modifier's tile that the single player lobby
// (src/lobbyView.ts) and the co-op lobby (src/coop/picksView.ts) share. Each
// view builds its own button, as the picks around it are built; the picture,
// the word, and the bonus readout are the same everywhere.

// NOTE: "+115%", the sum of the modifiers on.
const bonusText = (percent: number): string => `+${percent}%`

// NOTE: a tile's picture over its name. The name is capitals by style, and
// the screen reader gets the whole label on the button instead.
export const modifierFaceView: {
  <Message>(
    h: HtmlBuilder<Message>,
  ): (modifier: Modifier) => ReadonlyArray<Html>
  <Message>(modifier: Modifier, h: HtmlBuilder<Message>): ReadonlyArray<Html>
} = Function.dual(
  2,
  <Message>(
    modifier: Modifier,
    h: HtmlBuilder<Message>,
  ): ReadonlyArray<Html> => [
    iconView('modifier-icon', MODIFIER_ICONS[modifier], h),
    h.span(
      [h.Class('modifier-name'), h.AriaHidden(true)],
      [MODIFIER_NAMES[modifier]],
    ),
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
  <Message>(h: HtmlBuilder<Message>): (percent: number) => Html
  <Message>(percent: number, h: HtmlBuilder<Message>): Html
} = Function.dual(
  2,
  <Message>(percent: number, h: HtmlBuilder<Message>): Html =>
    h.span(
      [
        h.Class('modifier-bonus'),
        h.DataAttribute('state', percent > 0 ? 'On' : 'Off'),
        h.Role('status'),
        h.AriaLabel(`Bonus ${bonusText(percent)}`),
      ],
      [h.span([h.AriaHidden(true)], [bonusText(percent)])],
    ),
)
