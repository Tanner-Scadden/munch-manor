import { Schema } from 'effect'

import { UiSchema } from '@effect/ui'

import { HomeMode } from '#domain/clientSchema.ts'
import { Calling, Difficulty } from '#shared/playerData.ts'
import { Modifier } from '#world/run/modifiers.ts'

import { LobbyControl } from './model.ts'

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
