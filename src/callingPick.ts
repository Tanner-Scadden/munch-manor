import { modifyFields } from 'foldkit/struct'

import { callingForRun, isCallingUnlocked } from './calling'
import { playerOfCalling } from './callingPlayer'
import type { Model } from './model'
import type { Calling } from './playerData'
import { rankOf, totalPointsOf } from './rank'
import { callingUnlockId } from './unlocks'
import { withoutFresh } from './update/unlocks'

// NOTE: the calling picked before a run (GAME_DESIGN.md, "Rank and Bones").
// The pick is saved and synced, but a run starts with it only if the
// player's own rank has reached it, so a synced save from another device
// can never start a calling this one has not unlocked.

const rankOfPlayer = (model: Model): number => rankOf(totalPointsOf(model.rank))

export const isPickable = (model: Model, calling: Calling): boolean =>
  isCallingUnlocked(calling, rankOfPlayer(model))

// NOTE: the calling the next run starts with.
export const startingCallingOf = (model: Model): Calling =>
  callingForRun(model.calling, rankOfPlayer(model))

// NOTE: the pick, if the rank is reached. The player at home is dressed in
// it at once, so the menu shows the prop, and its NEW badge goes.
export const chooseCalling = (model: Model, calling: Calling): Model =>
  isPickable(model, calling)
    ? modifyFields(withoutFresh(model, callingUnlockId(calling)), {
        calling: () => calling,
        player: () => playerOfCalling(calling),
      })
    : model
