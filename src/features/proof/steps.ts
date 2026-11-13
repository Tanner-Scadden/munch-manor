import { Effect, Option } from 'effect'
import { Dom } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { ProofShelfBlock } from './block'
import { Message } from './message'
import { type Model, initialModel } from './model'
import {
  FIRST_SPOT,
  type Press,
  ShelfSpot,
  maybeSteppedSpot,
  slotId,
} from './proof'

// The shelf's own transitions, shared by its update and its InMessages
// (FOLDKIT.md, "File organization").

// NOTE: a slot reached by the arrows takes focus, so the keyboard, a
// controller, and a screen reader all stand on the slot whose stamp shows.
export const FocusShelfSlot = ProofShelfBlock.makeCommand('FocusShelfSlot', {
  args: { spot: ShelfSpot },
  messages: [Message.CompletedFocusSlot],
  handler: function* () {
    return ({ spot }) =>
      Dom.focus(`#${slotId(spot)}`).pipe(
        Effect.ignore,
        Effect.as(Message.CompletedFocusSlot()),
      )
  },
})

export const pick =
  (spot: ShelfSpot) =>
  (model: Model): Model =>
    modifyFields(model, { maybePicked: () => Option.some(spot) })

export const openAfresh = (): Model => initialModel

// NOTE: an arrow walks from the slot picked (the first, when none is) and
// picks the slot it reaches. Any other key is not the shelf's.
export const pressKey = (press: Press) => (model: Model) =>
  Option.match(
    maybeSteppedSpot(
      Option.getOrElse(model.maybePicked, () => FIRST_SPOT),
      press,
    ),
    {
      onNone: () => ({ model }),
      onSome: spot => ({
        model: pick(spot)(model),
        commands: [FocusShelfSlot({ spot })],
      }),
    },
  )
