import { Array, Schema } from 'effect'

import { UiSchema } from '@effect/ui'

import { LookPart } from '../../../../domain/looks'
import { LookSection, LookToggle } from './lookSchema'

// NOTE: the Look tab's own facts: a little tab picked, a free part picked
// in its radio group, a face toggle, the dice, an earned look's option, and
// the BUY pill. Section and part values come from the radio groups as
// strings, read back to their literals in the update.
export const Message = UiSchema.TaggedEnum({
  PickedSection: { value: Schema.String },
  PickedPart: { part: LookPart, value: Schema.String },
  ClickedToggle: { toggle: LookToggle },
  ClickedDiceButton: {},
  // NOTE: the rows of earned looks (shirt color, print, hat, gun skin) pick
  // by this click and not by the radio group, which is read only there: an
  // arrow key only moves focus, so walking a row never buys anything.
  ClickedGearOption: { part: LookPart, value: Schema.String },
  // NOTE: the BUY pill by the figure, for the look being tried on.
  ClickedBuyButton: { part: LookPart, value: Schema.String },
})
export type Message = typeof Message.Type

// NOTE: what happened in the Look tab, for the Profile to pass up: a part
// picked, a toggle flipped, the dice, and BUY on the look tried on. The
// root owns the look and judges each one.
export const Events = UiSchema.TaggedEnum({
  ChoseLook: { part: LookPart, value: Schema.String },
  FlippedLook: { toggle: LookToggle },
  RolledDice: {},
  ClickedBuy: { part: LookPart, value: Schema.String },
})
export type Events = typeof Events.Type

// NOTE: a little tab as the radio group names it, read back to its literal.
export const isLookSection = (value: string): value is LookSection =>
  Array.some(LookSection.literals, section => section === value)
