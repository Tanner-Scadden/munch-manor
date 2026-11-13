import { Schema } from 'effect'
import { defineInMessageUnion } from 'foldkit/message'

import { ShelfThing } from './proof'

// NOTE: the root's requests, each a Binding method
// (`ProofShelfBinding.requestOpen()`), handled in inMessageUpdate.ts: open
// afresh with nothing picked, and a key pressed while the shelf is up (the
// arrows walk its slots, the things along a row as the shelf shows them).
export const InMessage = defineInMessageUnion({
  RequestedOpen: {},
  RequestedPressKey: {
    code: Schema.String,
    things: Schema.NonEmptyArray(ShelfThing),
  },
})
export type InMessage = typeof InMessage.Type
