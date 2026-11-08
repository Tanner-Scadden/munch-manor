import { defineMessageUnion } from 'foldkit/message'

import { ZombieKind } from '../../world/schema/worldSchema'

// NOTE: the Munchopedia's own facts: a zombie's tile, BACK from an entry to
// the list, and the Shop tile.
export const Message = defineMessageUnion({
  ClickedEntryButton: { kind: ZombieKind },
  ClickedListButton: {},
  ClickedShopButton: {},
})
export type Message = typeof Message.Type

// NOTE: what happened that the root keeps: an entry opened, by a tile or by
// the root's NEW ENTRY pop. The root clears its NEW ENTRY and, for a zombie
// already found, saves it as opened.
export const OutMessage = defineMessageUnion({
  OpenedEntry: { kind: ZombieKind },
})
export type OutMessage = typeof OutMessage.Type
