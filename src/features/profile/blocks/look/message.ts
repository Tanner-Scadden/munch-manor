import { Array, Schema } from 'effect'

import { UiSchema } from '@effect/ui'

import { LookPart } from '#domain/looks.ts'

import { LookSection, LookToggle } from './lookSchema.ts'

export const Message = UiSchema.TaggedEnum({
  PickedSection: { value: Schema.String },
  PickedPart: { part: LookPart, value: Schema.String },
  ClickedToggle: { toggle: LookToggle },
  ClickedDiceButton: {},
  ClickedGearOption: { part: LookPart, value: Schema.String },
  ClickedBuyButton: { part: LookPart, value: Schema.String },
})
export type Message = typeof Message.Type

export const Events = UiSchema.TaggedEnum({
  ChoseLook: { part: LookPart, value: Schema.String },
  FlippedLook: { toggle: LookToggle },
  RolledDice: {},
  ClickedBuy: { part: LookPart, value: Schema.String },
})
export type Events = typeof Events.Type

export const isLookSection = (value: string): value is LookSection =>
  Array.some(LookSection.literals, section => section === value)
