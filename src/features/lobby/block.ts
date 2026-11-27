import { Schema } from 'effect'

import { Html } from '@effect/ui/html'

import { Events, Message } from './message.ts'
import { LobbyProps } from './model.ts'
import { lobbyCardView } from './view.ts'

export const Lobby = Html.component({
  name: 'Lobby',
  props: LobbyProps,
  model: Schema.Struct({}),
  message: Message,
  events: Events,
}).make({
  init: () => ({}),
  update: {
    ClickedBackButton: $ => $.emit(Events.RequestedLeave()),
    ClickedBackdrop: $ => $.emit(Events.RequestedLeave()),
    ClickedStartButton: $ => $.emit(Events.RequestedStart()),
    ClickedHeroButton: $ => $.emit(Events.RequestedHeroPicker()),
    ClickedAddBotButton: $ => $.emit(Events.RequestedAddBot()),
    ClickedDropBotButton: ($, { index }) =>
      $.emit(Events.RequestedDropBot({ index })),
    ClickedBotHeroButton: ($, { index }) =>
      $.emit(Events.RequestedBotHeroPicker({ index })),
    ClickedModeButton: ($, { mode }) => $.emit(Events.PickedMode({ mode })),
    ClickedDifficultyButton: ($, { difficulty }) =>
      $.emit(Events.PickedDifficulty({ difficulty })),
    ClickedModifierButton: ($, { modifier }) =>
      $.emit(Events.ToggledModifier({ modifier })),
    ClickedEasyBreakButton: $ => $.emit(Events.SteppedEasyBreak()),
    ClickedMarkButton: $ => $.emit(Events.SteppedDareMark()),
    FocusedControl: ($, { control }) =>
      $.emit(Events.FocusedControl({ control })),
    BlurredControl: $ => $.emit(Events.BlurredControl()),
    PickedHeroCard: ($, { calling }) => $.emit(Events.PickedHero({ calling })),
    RequestedBuyHero: ($, { calling }) =>
      $.emit(Events.RequestedBuyHero({ calling })),
    RequestedCloseHeroPicker: $ => $.emit(Events.RequestedCloseHeroPicker()),
  },
  view: h => lobbyCardView(h.props, h),
})
