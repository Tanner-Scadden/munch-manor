import { Option, Schema } from 'effect'

import { type Queue, Screen } from '../../domain/coopRoom'
import { Calling, SavedBoughtCosmetics } from '../../shared/playerData'

// NOTE: co-op's own state, the root Model's `coop` field. Its room and
// screens are src/domain/coopRoom.ts.

// NOTE: `name`, `look`, `rank`, and `calling` are what joining sends for
// this player (the look as src/shared/playerData.ts writes it, the rank as
// src/world/heroes/rank.ts works it out from their points, the calling their saved pick
// if their rank reached it). `introSeen` is whether they watched the whole
// intro (their save's onboarding `intro`), so a crew of veterans skips the
// drive up.
export const Model = Schema.Struct({
  screen: Screen,
  name: Schema.String,
  look: Schema.String,
  rank: Schema.Finite,
  calling: Calling,
  introSeen: Schema.Boolean,
  rngState: Schema.Finite,
  // NOTE: the ids of the heroes and looks this player bought, so the lobby's
  // picker offers only the heroes they own.
  bought: SavedBoughtCosmetics,
  // NOTE: the player's Bones, for the BUY pill's price check.
  bones: Schema.Finite,
  // NOTE: the hero picker the lobby's pill opens (src/features/heroes/): co-op
  // owns whether it is drawn and the hero tried on, never stored by the
  // picker. Opening or closing it ends any try-on.
  heroPick: Schema.Struct({
    isOpen: Schema.Boolean,
    maybeTrying: Schema.Option(Calling),
  }),
})
export type Model = typeof Model.Type

// NOTE: co-op as it starts, closed, its picker shut.
export const initialModel: Model = {
  screen: Screen.Closed(),
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
