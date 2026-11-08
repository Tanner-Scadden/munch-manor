import { Schema } from 'effect'
import { defineInMessageUnion } from 'foldkit/message'

import { PickOutcome } from '../heroes/inMessage'

// NOTE: the root's requests and answers, each a LobbyBinding method taking
// the picks after its payload (`LobbyBinding.requestPressKey({ code },
// picks)`), handled in inMessageUpdate.ts. The root hands every key to the
// open lobby, which may start, leave, or pick.
export const InMessage = defineInMessageUnion({
  RequestedOpen: {},
  RequestedPressKey: { code: Schema.String },
  InformedOfHeroOutcome: { outcome: PickOutcome },
})
export type InMessage = typeof InMessage.Type
