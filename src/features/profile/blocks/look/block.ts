import { Html } from '@effect/ui/html'

import { Events, Message, isLookSection } from './message'
import { CharacterProps, Model } from './model'
import { lookTabView } from './view'

// The Look tab, a child of the Profile: the figure on its stage, its little
// tabs, and a row of options per part. It keeps only which little tab is
// showing. The look, what is owned, the try-on, and the effects are its
// props, and every pick goes up as an event for the root to judge.

// NOTE: a component is called as `Character(h, { props, onEmit })`, a
// function Effect UI makes, with no data-last form to give it.
// @effect-diagnostics-next-line missingPipeableSignature:off
export const Character = Html.component({
  name: 'Character',
  props: CharacterProps,
  model: Model,
  message: Message,
  events: Events,
}).make({
  // NOTE: the Look tab opens on Body each time it is drawn.
  init: (): Model => ({ section: 'Body' }),
  update: {
    // NOTE: a little tab only changes which parts show. It plays no poof,
    // since the look itself is the same.
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
