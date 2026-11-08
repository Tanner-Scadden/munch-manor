import { Function, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'

import type { Model } from '../../app/model'
import { type Calling, heroIdOf } from '../../shared/playerData'
import {
  callingForRun,
  callingPriceOf,
  isCallingOwned,
} from '../../world/heroes/calling'
import { playerOfCalling } from '../../world/heroes/callingPlayer'
import { modifyFocus } from '../../world/party/party'
import { callingUnlockId } from '../unlocks/unlocks'
import { withoutFresh } from '../unlocks/update'

// NOTE: the calling picked before a run (GAME_DESIGN.md, "Rank and Bones").
// The pick is saved and synced, but a run starts with it only if this
// device's save owns it (bought with Bones), so a synced pick from another
// device can never start a hero this one has not bought.

const isPickable = (model: Model, calling: Calling): boolean =>
  isCallingOwned(calling, model.boughtCosmetics)

// NOTE: the calling the next run starts with.
export const startingCallingOf = (model: Model): Calling =>
  callingForRun(model.calling, model.boughtCosmetics)

// NOTE: the pick, if owned. The player at home is dressed in
// it at once, so the menu shows the prop, and its NEW badge goes.
export const chooseCalling: {
  (calling: Calling): (model: Model) => Model
  (model: Model, calling: Calling): Model
} = Function.dual(2, (model: Model, calling: Calling): Model =>
  isPickable(model, calling)
    ? modifyFocus(
        modifyFields(withoutFresh(model, callingUnlockId(calling)), {
          calling: () => calling,
        }),
        { player: () => playerOfCalling(calling) },
      )
    : model,
)

// NOTE: the Bones spent on a hero for sale, which is then the pick.
// The spend and the bought id are what the sync mutation `BoughtCosmetic`
// (src/platform/playerScope.ts) repeats on every device. Nothing if the hero is owned
// already, so a stale click buys nothing.
export const buyCalling: {
  (calling: Calling): (model: Model) => Model
  (model: Model, calling: Calling): Model
} = Function.dual(2, (model: Model, calling: Calling): Model =>
  isCallingOwned(calling, model.boughtCosmetics)
    ? model
    : chooseCalling(
        modifyFields(model, {
          rank: rank =>
            modifyFields(rank, {
              spentBones: spent =>
                spent + Option.getOrElse(callingPriceOf(calling), () => 0),
            }),
          boughtCosmetics: bought => [...bought, heroIdOf(calling)],
        }),
        calling,
      ),
)
