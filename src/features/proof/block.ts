import { Effect, Option } from 'effect'

import { Command, Component, UiStruct } from '@effect/ui'
import { Html, HtmlSubscription } from '@effect/ui/html'

import { Message } from './message'
import { Model, ProofShelfProps, initialModel } from './model'
import { FIRST_SPOT, ShelfSpot, maybeSteppedSpot, slotId } from './proof'
import { proofShelfView } from './view'

// The Proof Shelf in the menu panel. What it holds is the root's, handed
// down as props; the slot picked is its own, and its arrow keys are its own
// Subscription while it is mounted. The panel's Done is the `done` slot.
// Opening afresh is the panel mounting it.

// NOTE: a slot reached by the arrows takes focus, so the keyboard, a
// controller, and a screen reader all stand on the slot whose stamp shows.
// It runs once the render the update caused is in.
export const FocusShelfSlot = Command.make(
  'FocusShelfSlot',
  { args: { spot: ShelfSpot } },
  ({ spot }) =>
    Effect.sync(() => {
      const element = globalThis.document.getElementById(slotId(spot))
      if (element instanceof HTMLElement) {
        element.focus()
      }
    }).pipe(Effect.as(Component.noop)),
)

// NOTE: the arrows walk the shelf (`maybeSteppedSpot`); each is the shelf's
// while it is up, kept from scrolling the page.
const ARROW_KEYS = [
  { key: 'ArrowLeft', message: Message.PressedArrowKey({ code: 'ArrowLeft' }) },
  {
    key: 'ArrowRight',
    message: Message.PressedArrowKey({ code: 'ArrowRight' }),
  },
  { key: 'ArrowUp', message: Message.PressedArrowKey({ code: 'ArrowUp' }) },
  { key: 'ArrowDown', message: Message.PressedArrowKey({ code: 'ArrowDown' }) },
] as const

const pick =
  (spot: ShelfSpot) =>
  (model: Model): Model =>
    UiStruct.evolve(model, { maybePicked: () => Option.some(spot) })

// NOTE: a component is called as `ProofShelf(h, { props, slots })`, a
// function Effect UI makes, with no data-last form to give it.
// @effect-diagnostics-next-line missingPipeableSignature:off
export const ProofShelf = Html.component({
  name: 'ProofShelf',
  props: ProofShelfProps,
  model: Model,
  message: Message,
  slots: ['done'],
}).make({
  init: $ => $.set(initialModel),
  update: {
    ClickedSlot: ($, { spot }) => pick(spot)($.model),
    // NOTE: an arrow walks from the slot picked (the first, when none is)
    // and picks the slot it reaches.
    PressedArrowKey: ($, { code }) =>
      Option.match(
        maybeSteppedSpot(
          Option.getOrElse($.model.maybePicked, () => FIRST_SPOT),
          { code, things: $.props.things },
        ),
        {
          onNone: () => $.model,
          onSome: spot =>
            $.set(pick(spot)($.model)).run(FocusShelfSlot.make({ spot })),
        },
      ),
  },
  subscriptions: () => [HtmlSubscription.shortcuts(ARROW_KEYS)],
  view: (h, model) =>
    proofShelfView({ h, model, props: h.props, done: h.slots.done }),
})
