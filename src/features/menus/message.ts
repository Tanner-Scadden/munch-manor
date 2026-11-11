import { Schema } from 'effect'
import { defineMessageUnion } from 'foldkit/message'

// NOTE: the How to play cards (src/features/menus/pauseHelp.ts). One card at a time shows
// its line of how to do it: the one focused or tapped last, until the
// panel closes.
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

// NOTE: the How to play panel's cards (src/features/menus/pauseHelp.ts),
// handled in src/app/update/home.ts with the other panels.
export const helpCases = {
  FocusedHelpCard: { card: HelpCard },
  ClickedHelpCard: { card: HelpCard },
}
export const HelpMessage = defineMessageUnion(helpCases)
