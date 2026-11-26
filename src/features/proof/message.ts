import { Schema } from 'effect'

import { UiSchema } from '@effect/ui'

import { ShelfSpot } from './proof'

// NOTE: the shelf's own facts: a slot tapped, and an arrow key pressed
// while it is up (its own Subscription), which walks its slots. Nothing in
// it needs the root, so it has no events.
export const Message = UiSchema.TaggedEnum({
  ClickedSlot: { spot: ShelfSpot },
  PressedArrowKey: { code: Schema.String },
})
export type Message = typeof Message.Type
