import { Schema } from 'effect'

import { type Queue, Screen } from '../../domain/coopRoom'
import { Calling, SavedBoughtCosmetics } from '../../shared/playerData'
import { HeroPickerBlock } from '../heroes/block'

// NOTE: co-op's own state, a Block the root Model holds. Its room and
// screens are src/domain/coopRoom.ts.

// NOTE: `name`, `look`, `rank`, and `calling` are what joining sends for
// this player (the look as src/shared/playerData.ts writes it, the rank as
// src/world/heroes/rank.ts works it out from their points, the calling their saved pick
// if their rank reached it).
export const Model = Schema.Struct({
  screen: Screen,
  name: Schema.String,
  look: Schema.String,
  rank: Schema.Finite,
  calling: Calling,
  rngState: Schema.Finite,
  // NOTE: the ids of the heroes and looks this player bought, so the lobby's
  // picker offers only the heroes they own.
  bought: SavedBoughtCosmetics,
  // NOTE: the player's Bones, for the BUY pill's price check.
  bones: Schema.Finite,
  // NOTE: the hero picker the lobby's pill opens, a child Block.
  heroPicker: HeroPickerBlock.Model,
})
export type Model = typeof Model.Type

// NOTE: co-op's own fields as it starts, closed; the picker starts from its
// own init through its Binding.
export const initialModel: Omit<Model, 'heroPicker'> = {
  screen: Screen.Closed(),
  name: '',
  look: '',
  rank: 1,
  calling: 'You',
  rngState: 0,
  bought: [],
  bones: 0,
}

export const emptyQueue: Queue = {
  names: [],
  waiting: 0,
  position: 0,
  groupSize: 4,
  offerPlayers: 0,
  accepted: 0,
  answer: 'Unanswered',
}
