import { Schema } from 'effect'
import { defineInMessageUnion } from 'foldkit/message'

import { ShopGuideSection } from '../../shared/nameKeys'
import { ShopItemId } from '../../world/schema/worldSchema'

// NOTE: the root's requests, each a ShopDialogBinding method
// (`ShopDialogBinding.requestPressKey({ code, section })`), handled in
// inMessageUpdate.ts. The root opens the dialog as the player reaches the
// counter (and again when Escape only put the guide away), closes it when
// the World has them away, hands it every key at the counter with the tab
// they are looking at, and asks it to focus a row the World moved focus to.
export const InMessage = defineInMessageUnion({
  RequestedOpen: {},
  RequestedClose: {},
  RequestedPressKey: { code: Schema.String, section: ShopGuideSection },
  RequestedFocusItem: { item: ShopItemId },
})
export type InMessage = typeof InMessage.Type
