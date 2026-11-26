import { Option, Schema } from 'effect'

import { type Queue, Screen } from '../../domain/coopRoom'
import { Calling, SavedBoughtCosmetics } from '../../shared/playerData'

export const Model = Schema.Struct({
  screen: Screen,
  name: Schema.String,
  look: Schema.String,
  rank: Schema.Finite,
  calling: Calling,
  introSeen: Schema.Boolean,
  rngState: Schema.Finite,
  bought: SavedBoughtCosmetics,
  bones: Schema.Finite,
  heroPick: Schema.Struct({
    isOpen: Schema.Boolean,
    maybeTrying: Schema.Option(Calling),
  }),
})
export type Model = typeof Model.Type

export const initialModel: Model = {
  screen: Screen.Closed,
  name: '',
  look: '',
  rank: 1,
  calling: 'You',
  introSeen: false,
  rngState: 0,
  bought: [],
  bones: 0,
  heroPick: { isOpen: false, maybeTrying: Option.none() },
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
