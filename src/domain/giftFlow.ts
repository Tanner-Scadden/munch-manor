import { Event, Machine } from 'effect-machine'

import { UpdateGift } from './clientSchema.ts'
import { machineStepOf } from './machineStep.ts'

export const GiftEvent = Event({
  Unwrapped: {},
  Rewrapped: {},
})
export type GiftEvent = typeof GiftEvent.Type

export const giftMachine = Machine.make({
  state: UpdateGift,
  event: GiftEvent,
  initial: UpdateGift.Wrapped,
})
  .on(UpdateGift.Wrapped, GiftEvent.Unwrapped, () => UpdateGift.Unwrapping)
  .on(UpdateGift.Unwrapping, GiftEvent.Rewrapped, () => UpdateGift.Wrapped)

export const stepGift = machineStepOf(giftMachine)
