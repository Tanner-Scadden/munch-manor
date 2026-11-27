import { Effect, Option } from 'effect'

import { Command, Component, UiStruct } from '@effect/ui'
import { Html, HtmlSubscription } from '@effect/ui/html'

import { Message } from './message.ts'
import { Model, ProofShelfProps, initialModel } from './model.ts'
import { FIRST_SPOT, ShelfSpot, maybeSteppedSpot, slotId } from './proof.ts'
import { proofShelfView } from './view.ts'

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
