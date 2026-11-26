import { Schema } from 'effect'

export const MapId = Schema.Literals(['Manor'])
export type MapId = typeof MapId.Type

export const ShopGuideSection = Schema.Literals([
  'Guns',
  'Health',
  'Traps',
  'Fridge',
  'House',
])
export type ShopGuideSection = typeof ShopGuideSection.Type

export const HouseSpot = Schema.Literals([
  'Rattles',
  'Boards',
  'Fridge',
  'Stove',
  'Valve',
])
export type HouseSpot = typeof HouseSpot.Type

export const TutorialChoice = Schema.Literals(['Tutorial', 'Skip'])
export type TutorialChoice = typeof TutorialChoice.Type
