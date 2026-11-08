import { Schema } from 'effect'
import { defineInMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'

import { Calling } from '../../shared/playerData'

// NOTE: what the parent made of a card or BUY, by the rules it owns (rank,
// ownership, the Bones): the hero worn, so the picker closes; one for sale
// tried on; the try-on ended (a locked card, a hero no longer for sale); or
// nothing to change (too few Bones keeps the try-on, so BUY stays for when
// there are enough).
export const PickOutcome = defineTaggedUnion({
  Worn: { calling: Calling },
  TriedOn: { calling: Calling },
  TryOnEnded: {},
  Unchanged: {},
})
export type PickOutcome = typeof PickOutcome.Type

// NOTE: the parent's requests, each a Binding method
// (`HeroPickerBinding.requestOpen()`), handled in inMessageUpdate.ts. Escape
// and the hero key close an open picker (`requestPressKey({ code })`) and
// say so.
export const InMessage = defineInMessageUnion({
  RequestedOpen: {},
  RequestedClose: {},
  RequestedPressKey: { code: Schema.String },
  InformedOfOutcome: { outcome: PickOutcome },
})
export type InMessage = typeof InMessage.Type
