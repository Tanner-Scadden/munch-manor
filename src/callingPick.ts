import { Option } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { callingForRun, callingPriceOf, isCallingOwned } from './calling'
import { playerOfCalling } from './callingPlayer'
import type { Model } from './model'
import { type Calling, heroIdOf } from './playerData'
import { callingUnlockId } from './unlocks'
import { withoutFresh } from './update/unlocks'

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
export const chooseCalling = (model: Model, calling: Calling): Model =>
  isPickable(model, calling)
    ? modifyFields(withoutFresh(model, callingUnlockId(calling)), {
        calling: () => calling,
        player: () => playerOfCalling(calling),
      })
    : model

// NOTE: a hero for sale is tried on in the picker; its BUY pill buys it.
export const tryOnCalling = (model: Model, calling: Calling): Model =>
  modifyFields(model, {
    home: home =>
      modifyFields(home, { maybeTryingCalling: () => Option.some(calling) }),
  })

export const withoutTryOn = (model: Model): Model =>
  modifyFields(model, {
    home: home =>
      modifyFields(home, { maybeTryingCalling: () => Option.none() }),
  })

// NOTE: the Bones spent on the hero being tried on, which is then the pick.
// The spend and the bought id are what the sync mutation `BoughtCosmetic`
// (src/playerScope.ts) repeats on every device. Nothing if the hero is owned
// already, so a stale click buys nothing.
export const buyCalling = (model: Model, calling: Calling): Model =>
  isCallingOwned(calling, model.boughtCosmetics)
    ? withoutTryOn(model)
    : chooseCalling(
        withoutTryOn(
          modifyFields(model, {
            rank: rank =>
              modifyFields(rank, {
                spentBones: spent =>
                  spent + Option.getOrElse(callingPriceOf(calling), () => 0),
              }),
            boughtCosmetics: bought => [...bought, heroIdOf(calling)],
          }),
        ),
        calling,
      )
