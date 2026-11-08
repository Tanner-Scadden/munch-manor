import { defineInMessageUnion } from 'foldkit/message'

import { ShopGuideSection } from '../../shared/nameKeys'

// NOTE: the parent's requests, each a Binding method
// (`ShopGuideBinding.requestOpen({ section })`), handled in
// inMessageUpdate.ts. Open and toggle (the shop's ? key) move focus as BACK
// does; a plain close is quiet, for a parent that puts something else in
// focus (the shop dialog opening again on Escape, the counter reached, the
// Munchopedia opened afresh).
export const InMessage = defineInMessageUnion({
  RequestedOpen: { section: ShopGuideSection },
  RequestedToggle: { section: ShopGuideSection },
  RequestedClose: {},
})
export type InMessage = typeof InMessage.Type
