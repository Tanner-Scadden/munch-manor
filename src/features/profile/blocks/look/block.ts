import { Html } from '@effect/ui/html'

import { Events, Message, isLookSection } from './message.ts'
import { CharacterProps, Model } from './model.ts'
import { lookTabView } from './view.ts'

export const Character = Html.component({
  name: 'Character',
  props: CharacterProps,
  model: Model,
  message: Message,
  events: Events,
}).make({
  init: (): Model => ({ section: 'Body' }),
  update: {
    PickedSection: ($, { value }) =>
      isLookSection(value) ? $.evolve({ section: () => value }) : $.model,
    PickedPart: ($, { part, value }) =>
      $.emit(Events.ChoseLook({ part, value })),
    ClickedGearOption: ($, { part, value }) =>
      $.emit(Events.ChoseLook({ part, value })),
    ClickedToggle: ($, { toggle }) => $.emit(Events.FlippedLook({ toggle })),
    ClickedDiceButton: $ => $.emit(Events.RolledDice()),
    ClickedBuyButton: ($, { part, value }) =>
      $.emit(Events.ClickedBuy({ part, value })),
  },
  view: (h, model) => lookTabView(model, h.props, h),
})
