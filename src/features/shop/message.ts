import { defineMessageUnion } from 'foldkit/message'

import { ShopGuideSection } from '../../shared/nameKeys'
import { ShopCategory, ShopItemId } from '../../world/schema/worldSchema'

// NOTE: the shop dialog's own facts: a row's buy button tapped or its Enter,
// an arrow key moving down the rows, a row focused, its focus Command done,
// and the ? tapped on the tab the player is looking at. The root's requests
// are its InMessages (inMessage.ts).
export const Message = defineMessageUnion({
  ClickedBuyButton: { item: ShopItemId },
  PressedBuyKey: { item: ShopItemId },
  MovedFocus: { item: ShopItemId },
  FocusedItem: { item: ShopItemId },
  CompletedFocusItem: {},
  ClickedGuideButton: { section: ShopGuideSection },
})
export type Message = typeof Message.Type

// NOTE: what the player did at the counter that the root acts on. Buying,
// the row in focus, and the tab are the World's (a seat's `shop` and
// `shopCategory`), so each goes up for the root to make as the seat's
// action: a row picked, an arrow key's next row (which the keyboard's focus
// follows), a row focused, a tab chosen. Closed is the Dialog
// closing, by its X, Escape, or the backdrop, or by the root's own
// `requestClose`: the root judges whether the player left the counter or
// Escape only put the guide away (src/app/update/shop.ts).
export const OutMessage = defineMessageUnion({
  PickedItem: { item: ShopItemId },
  MovedFocus: { item: ShopItemId },
  FocusedItem: { item: ShopItemId },
  ChoseCategory: { category: ShopCategory },
  Closed: {},
})
export type OutMessage = typeof OutMessage.Type
