import { UiSchema } from '@effect/ui'

import { Calling } from '#shared/records/playerData.ts'

export const Message = UiSchema.TaggedEnum({
  ClickedCard: { calling: Calling },
  ClickedBuyButton: { calling: Calling },
  ClickedCloseButton: {},
  PressedCloseKey: {},
})
export type Message = typeof Message.Type

export const Events = UiSchema.TaggedEnum({
  Picked: { calling: Calling },
  RequestedBuy: { calling: Calling },
  RequestedClose: {},
})
export type Events = typeof Events.Type
