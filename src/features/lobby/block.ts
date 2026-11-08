import { Schema } from 'effect'
import { Block } from 'foldkit'

import type {
  Appearance,
  Calling,
  SavedBoughtCosmetics,
} from '../../shared/playerData'
import { InMessage } from './inMessage'
import { Message, OutMessage } from './message'
import { LobbyPicks, Model } from './model'

// NOTE: what the root hands the lobby's view: the picks, the player as their
// seat shows them (name, look, rank, the hero the next run starts with, and
// whether a hero is new), what the hero picker's cards read (the heroes
// bought, the Bones, the unlocks that wear a NEW badge), and whether key
// caps show.
export type ViewInputs = Readonly<{
  picks: LobbyPicks
  name: string
  look: Appearance
  rank: number
  calling: Calling
  isHeroNew: boolean
  bought: SavedBoughtCosmetics
  bones: number
  fresh: ReadonlyArray<string>
  isKeyboard: boolean
}>

// NOTE: the single player lobby's public contract. The root's picks are its
// update context (LobbyBinding's delivery) and its InMessages' context. The
// root opens it, hands it the keys, and answers its hero asks through the
// InMessages; it tells the root each pick through its OutMessages.
const LobbyKey = Symbol('Lobby')
export const LobbyBlock = Block.make('Lobby', {
  key: LobbyKey,
  InitArgs: Schema.Tuple([]),
  Context: Schema.Tuple([LobbyPicks]),
  InMessageContext: Schema.Tuple([LobbyPicks]),
  view: { kind: 'Element', Inputs: Block.makeInputContract<ViewInputs>() },
  Model,
  Message,
  InMessage,
  OutMessage,
  inMessageOutputs: {
    RequestedPressKey: { outMessage: OutMessage },
  },
})

// NOTE: Commands and OutMessage folds are made through the Block itself
// (`LobbyBlock.makeCommand(...)`): exported alone, each is a two-argument
// function with no pipeable form.
export const {
  makeComposition,
  makeNoopStep,
  makeOutMessageStep,
  makeRequiredFieldBinding,
  makeStep,
} = LobbyBlock
