import { defineMessageUnion } from 'foldkit/message'

import { Calling } from '../../shared/playerData'

// NOTE: the picker's own facts: a card, the BUY pill, the close button.
export const Message = defineMessageUnion({
  ClickedCard: { calling: Calling },
  ClickedBuyButton: {},
  ClickedCloseButton: {},
})
export type Message = typeof Message.Type

// NOTE: what happened in the picker that its parent judges: a card tapped,
// BUY on the hero being tried on, and the picker closed by its own button.
// The parent answers a card and BUY with `InformedOfOutcome`.
export const OutMessage = defineMessageUnion({
  PickedCard: { calling: Calling },
  ClickedBuy: { calling: Calling },
  Closed: {},
})
export type OutMessage = typeof OutMessage.Type
