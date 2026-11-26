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
