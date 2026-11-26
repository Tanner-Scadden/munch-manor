import { Schema } from 'effect'

import { UiSchema } from '@effect/ui'

import { HomeMode } from '../../domain/clientSchema'
import { Calling, Difficulty } from '../../shared/playerData'
import { Modifier } from '../../world/run/modifiers'
import { LobbyControl } from './model'

// NOTE: the Lobby component's own facts: its taps and focus, and its hero
// picker's and Dialog's events.
export const Message = UiSchema.TaggedEnum({
  ClickedBackButton: {},
  ClickedBackdrop: {},
  ClickedStartButton: {},
  ClickedHeroButton: {},
  ClickedAddBotButton: {},
  ClickedDropBotButton: { index: Schema.Finite },
  ClickedBotHeroButton: { index: Schema.Finite },
  ClickedModeButton: { mode: HomeMode },
  ClickedDifficultyButton: { difficulty: Difficulty },
  ClickedModifierButton: { modifier: Modifier },
  ClickedEasyBreakButton: {},
  ClickedMarkButton: {},
  FocusedControl: { control: LobbyControl },
  BlurredControl: {},
  PickedHeroCard: { calling: Calling },
  RequestedBuyHero: { calling: Calling },
  RequestedCloseHeroPicker: {},
})
export type Message = typeof Message.Type

// NOTE: what happened in the lobby, for the root to judge and make: the
// picks, the lobby's state, and the rules are all the root's (it saves the
// difficulty, a run reads the picks, and menuState and the keys read the
// rest). BACK and a tap outside the card ask to leave; the mode,
// difficulty, and modifier tiles ask for theirs; the break clock and the
// mark ask to step; + BOT and a bot's x ask for a bot seated or sent home;
// the hero cards ask for the picker; a card, BUY, and the picker's close
// come up as they are.
export const Events = UiSchema.TaggedEnum({
  RequestedLeave: {},
  RequestedStart: {},
  RequestedHeroPicker: {},
  RequestedBotHeroPicker: { index: Schema.Finite },
  RequestedAddBot: {},
  RequestedDropBot: { index: Schema.Finite },
  PickedMode: { mode: HomeMode },
  PickedDifficulty: { difficulty: Difficulty },
  ToggledModifier: { modifier: Modifier },
  SteppedEasyBreak: {},
  SteppedDareMark: {},
  FocusedControl: { control: LobbyControl },
  BlurredControl: {},
  PickedHero: { calling: Calling },
  RequestedBuyHero: { calling: Calling },
  RequestedCloseHeroPicker: {},
})
export type Events = typeof Events.Type

// NOTE: the root's Messages for the lobby, each a Lobby event as
// src/app/lobbyView.ts maps it, and the fold back into PLAY finished
// (FoldLobby). Their handlers are `lobbyHandlers` in src/app/update/lobby.ts.
export const lobbyCases = {
  RequestedLeaveLobby: {},
  RequestedStartFromLobby: {},
  RequestedLobbyHeroPicker: {},
  RequestedLobbyBotHeroPicker: { index: Schema.Finite },
  RequestedAddLobbyBot: {},
  RequestedDropLobbyBot: { index: Schema.Finite },
  PickedLobbyMode: { mode: HomeMode },
  PickedLobbyDifficulty: { difficulty: Difficulty },
  ToggledLobbyModifier: { modifier: Modifier },
  SteppedLobbyEasyBreak: {},
  SteppedLobbyDareMark: {},
  FocusedLobbyControl: { control: LobbyControl },
  BlurredLobbyControl: {},
  PickedLobbyHero: { calling: Calling },
  RequestedBuyLobbyHero: { calling: Calling },
  RequestedCloseLobbyHeroPicker: {},
  CompletedLobbyFold: {},
}

export const LobbyMessage = UiSchema.TaggedEnum(lobbyCases)
export type LobbyMessage = typeof LobbyMessage.Type
