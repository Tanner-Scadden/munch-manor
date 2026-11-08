import { defineMessageUnion } from 'foldkit/message'

import { ShopGuideSection } from '../../shared/nameKeys'

// NOTE: the guide's own facts: a section button, its back button, and its
// focus Command done. Nothing in it needs its parent, so it has no
// OutMessage.
export const Message = defineMessageUnion({
  ClickedSectionButton: { section: ShopGuideSection },
  ClickedBackButton: {},
  CompletedFocusControl: {},
})
export type Message = typeof Message.Type
