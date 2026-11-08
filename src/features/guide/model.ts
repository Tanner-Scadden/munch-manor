import { Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

import { ShopGuideSection } from '../../shared/nameKeys'

// NOTE: where a guide stands, fixed when its parent binds it: in Rattles'
// shop dialog, opened by its ? (the shop dialog's `guide`), or on the
// Munchopedia's Shop page (the Munchopedia's `guide`). It picks the back
// button's words and the ids focus moves between.
export const GuidePlacement = Schema.Literals(['Shop', 'Munchopedia'])
export type GuidePlacement = typeof GuidePlacement.Type

// NOTE: the buttons focus moves between as a guide opens and closes, by
// where it stands: its BACK, and the button that opened it (the shop's ?,
// the Munchopedia's Shop tile).
export const GUIDE_FOCUS_IDS: Readonly<
  Record<GuidePlacement, Readonly<{ back: string; opener: string }>>
> = {
  Shop: { back: 'shop-guide-back', opener: 'shop-guide-open' },
  Munchopedia: { back: 'munch-guide-back', opener: 'munch-shop-tile' },
}

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
