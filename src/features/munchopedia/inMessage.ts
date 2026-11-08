import { defineInMessageUnion } from 'foldkit/message'

import { MunchopediaPage } from './model'

// NOTE: the root's request, a MunchopediaBinding method
// (`MunchopediaBinding.requestOpen({ page })`): the Munchopedia opens
// afresh on a page, the list from the MANOR hand and the Z key, an entry
// from the NEW ENTRY pop.
export const InMessage = defineInMessageUnion({
  RequestedOpen: { page: MunchopediaPage },
})
export type InMessage = typeof InMessage.Type
