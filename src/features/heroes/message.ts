import { UiSchema } from '@effect/ui'

import { Calling } from '../../shared/playerData'

// NOTE: the picker's own facts: a card, the BUY pill, the close button, and
// a close key (Escape or Y, its own Subscription).
export const Message = UiSchema.TaggedEnum({
  ClickedCard: { calling: Calling },
  ClickedBuyButton: { calling: Calling },
  ClickedCloseButton: {},
  PressedCloseKey: {},
})
export type Message = typeof Message.Type

// NOTE: what happened in the picker, for its parent to judge: every event
// asks, and the parent owns the rules (rank, ownership, the Bones), whether
// the picker is drawn, and the hero tried on, answering by its props.
export const Events = UiSchema.TaggedEnum({
  Picked: { calling: Calling },
  RequestedBuy: { calling: Calling },
  RequestedClose: {},
})
export type Events = typeof Events.Type
