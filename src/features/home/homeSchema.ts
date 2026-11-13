// The home menu's Schemas: its buttons, the MANOR hand's cards, and the
// panels.

import { Schema } from 'effect'

export const HomeButton = Schema.Literals([
  'Play',
  'Coop',
  'Manor',
  'Bests',
  'Missions',
  'Support',
  'Settings',
])
export type HomeButton = typeof HomeButton.Type

// NOTE: the cards the MANOR button deals. Code links to the game's public
// source on GitHub. The tip jar's coffee is not a card: it stands in the
// home menu's corner (HomeButton Support).
export const HandCard = Schema.Literals([
  'Character',
  'Munchopedia',
  'WhatsNew',
  'HowToPlay',
  'Proof',
  'Code',
])
export type HandCard = typeof HandCard.Type

export const MenuPanel = Schema.Literals([
  'HowToPlay',
  'LeaveRun',
  'Difficulty',
  'WhatsNew',
  'Munchopedia',
  'Missions',
  'Proof',
])
export type MenuPanel = typeof MenuPanel.Type
