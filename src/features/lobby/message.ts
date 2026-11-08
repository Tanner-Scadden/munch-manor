import { Schema } from 'effect'
import { defineMessageUnion } from 'foldkit/message'

import { HomeMode } from '../../domain/clientSchema'
import { Calling, Difficulty } from '../../shared/playerData'
import { Modifier } from '../../world/run/modifiers'
import { LobbyControl } from './model'

// NOTE: the lobby's own facts. The root's requests are its InMessages
// (inMessage.ts).
export const Message = defineMessageUnion({
  ClickedBackButton: {},
  ClickedStartButton: {},
  ClickedHeroButton: {},
  ClickedAddBotButton: {},
  ClickedDropBotButton: { index: Schema.Finite },
  ClickedBotHeroButton: { index: Schema.Finite },
  ClickedModeButton: { mode: HomeMode },
  ClickedDifficultyButton: { difficulty: Difficulty },
  ClickedModifierButton: { modifier: Modifier },
  FocusedControl: { control: LobbyControl },
  BlurredControl: {},
  CompletedFocusControl: {},
})
export type Message = typeof Message.Type

// NOTE: what happened in the lobby that the root acts on. The picks are the
// root's (it saves the difficulty, and a run reads them all), so each pick
// goes up for the root to make and to tap: the mode, the difficulty, a
// modifier, + BOT (the root's seeded generator rolls the bot), and a bot
// sent home. START and BACK close the lobby. The picker opening plays the
// root's tap and marks the heroes seen. A hero card and BUY ask the root,
// which owns the rank, the heroes bought, and the Bones
// (`InformedOfHeroOutcome` answers); a card chosen for a bot says which.
export const OutMessage = defineMessageUnion({
  Started: {},
  Left: {},
  ChoseMode: { mode: HomeMode },
  ChoseDifficulty: { difficulty: Difficulty },
  ToggledModifier: { modifier: Modifier },
  ClickedAddBot: {},
  DroppedBot: { index: Schema.Finite },
  OpenedHeroPicker: {},
  PickedHero: { calling: Calling, maybeBot: Schema.Option(Schema.Finite) },
  ClickedBuyHero: { calling: Calling },
})
export type OutMessage = typeof OutMessage.Type
