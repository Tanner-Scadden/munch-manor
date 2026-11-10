import { Schema } from 'effect'

// NOTE: the key sets of the names the menus read (src/world/names.ts), apart from
// src/domain/clientSchema.ts so that names.ts, which the World's modules read, takes
// no type from a client module. clientSchema.ts re-exports them.

// NOTE: the maps a run can be played on (src/features/lobby/lobby.ts). One for now.
export const MapId = Schema.Literals(['Manor'])
export type MapId = typeof MapId.Type

// NOTE: the shop guide's sections, the shop's tabs and then the fridge's
// prizes and the rest of the house (src/features/guide/shopGuide.ts).
export const ShopGuideSection = Schema.Literals([
  'Guns',
  'Health',
  'Traps',
  'Fridge',
  'House',
])
export type ShopGuideSection = typeof ShopGuideSection.Type

// NOTE: the places around the house the shop guide shows (src/features/guide/shopGuide.ts).
export const HouseSpot = Schema.Literals([
  'Rattles',
  'Boards',
  'Fridge',
  'Stove',
  'Valve',
])
export type HouseSpot = typeof HouseSpot.Type

// NOTE: the first-run card's two-way pick (owner, 2026-11-07): play the
// tutorial, the default, or skip it and start as a returning player.
export const TutorialChoice = Schema.Literals(['Tutorial', 'Skip'])
export type TutorialChoice = typeof TutorialChoice.Type
