import { Schema } from 'effect'

import { UiSchema } from '@effect/ui'

import { ShelfSpot } from './proof.ts'

export const Message = UiSchema.TaggedEnum({
  ClickedSlot: { spot: ShelfSpot },
  PressedArrowKey: { code: Schema.String },
})
export type Message = typeof Message.Type
