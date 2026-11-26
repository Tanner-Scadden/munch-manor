import { Schema } from 'effect'

import { UiSchema } from '@effect/ui'

export const HelpCard = Schema.Literals([
  'Move',
  'Aim',
  'Swap',
  'Knife',
  'Traps',
  'Keys',
  'Rooms',
  'Cases',
  'Guns',
  'Stove',
  'List',
  'Exit',
])
export type HelpCard = typeof HelpCard.Type

export const helpCases = {
  FocusedHelpCard: { card: HelpCard },
  ClickedHelpCard: { card: HelpCard },
}
export const HelpMessage = UiSchema.TaggedEnum(helpCases)
