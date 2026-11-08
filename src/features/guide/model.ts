import { Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

import { ShopGuideSection } from '../../shared/nameKeys'

// NOTE: where a guide stands, fixed when its parent binds it: in Rattles'
// shop dialog, opened by its ? (the root's `shopGuide`), or on the
// Munchopedia's Shop page (the Munchopedia's `guide`). It picks the back
// button's words and the ids focus moves between.
export const GuidePlacement = Schema.Literals(['Shop', 'Munchopedia'])
export type GuidePlacement = typeof GuidePlacement.Type

// NOTE: shut, or up on one section. Its parent draws what the guide stands
// in for while it is shut: the shop's shelves, the Munchopedia's zombies.
export const GuideStatus = defineTaggedUnion({
  Closed: {},
  Open: { section: ShopGuideSection },
})
export type GuideStatus = typeof GuideStatus.Type

// NOTE: the guide's own state, never saved. What it shows (the fridge
// prizes pulled, so a ??? fills in) is its parent's, read as a view input.
export const Model = Schema.Struct({
  placement: GuidePlacement,
  status: GuideStatus,
})
export type Model = typeof Model.Type

// NOTE: a Binding's init arguments, the placement as the tuple InitArgs
// declares.
export const placedIn = (
  placement: GuidePlacement,
): readonly [GuidePlacement] => [placement]

export const initialModel = (placement: GuidePlacement): Model => ({
  placement,
  status: GuideStatus.Closed(),
})

// NOTE: a read for the parents, so they never read the guide's fields.
export const isGuideOpen = (model: Model): boolean =>
  GuideStatus.isAnyOf(['Open'])(model.status)
