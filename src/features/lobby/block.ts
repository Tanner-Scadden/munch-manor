import { Schema } from 'effect'

import { Html } from '@effect/ui/html'

import { Events, Message } from './message'
import { LobbyProps } from './model'
import { lobbyCardView } from './view'

// The single player lobby PLAY opens (GAME_DESIGN.md, "The single player
// lobby"). It holds no state: the root owns the picks and the lobby's state
// (src/app/update/lobby.ts), hands them down as props, and makes each event
// it raises. Its keys are the root's too (`lobbyFromKey`), so a controller's
// menu presses reach it the same way.

// NOTE: a component is called as `Lobby(h, { props, onEmit })`, a function
// Effect UI makes, with no data-last form to give it.
// @effect-diagnostics-next-line missingPipeableSignature:off
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
