import { Schema } from 'effect'
import { defineInMessageUnion } from 'foldkit/message'

// NOTE: the root's requests, each a Binding method
// (`ProofShelfBinding.requestOpen()`), handled in inMessageUpdate.ts: open
// afresh with nothing picked, and a key pressed while the shelf is up (the
// arrows walk its slots).
export const InMessage = defineInMessageUnion({
  RequestedOpen: {},
  RequestedPressKey: { code: Schema.String },
})
export type InMessage = typeof InMessage.Type
