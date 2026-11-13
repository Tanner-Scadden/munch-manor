import { defineMessageUnion } from 'foldkit/message'

import { ShelfSpot } from './proof'

// NOTE: the shelf's own facts: a slot tapped, and its focus Command done.
// Nothing in it needs the root, so it has no OutMessage.
export const Message = defineMessageUnion({
  ClickedSlot: { spot: ShelfSpot },
  CompletedFocusSlot: {},
})
export type Message = typeof Message.Type
