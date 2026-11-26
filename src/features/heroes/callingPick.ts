import { Function, Option } from 'effect'

import { UiStruct } from '@effect/ui'

import type { Model } from '../../app/model'
import { callingUnlockId, withoutFresh } from '../../domain/unlocks'
import { type Calling, heroIdOf } from '../../shared/playerData'
import {
  callingForRun,
  callingPriceOf,
  isCallingOwned,
} from '../../world/heroes/calling'
import { playerOfCalling } from '../../world/heroes/callingPlayer'
import { modifyFocus } from '../../world/party/party'

const isPickable = (model: Model, calling: Calling): boolean =>
  isCallingOwned(calling, model.boughtCosmetics)

export const startingCallingOf = (model: Model): Calling =>
  callingForRun(model.calling, model.boughtCosmetics)

export const chooseCalling: {
  (calling: Calling): (model: Model) => Model
  (model: Model, calling: Calling): Model
} = Function.dual(2, (model: Model, calling: Calling): Model =>
  isPickable(model, calling)
    ? modifyFocus(
        UiStruct.evolve(withoutFresh(model, callingUnlockId(calling)), {
          calling: () => calling,
        }),
        { player: () => playerOfCalling(calling) },
      )
    : model,
)

export const buyCalling: {
  (calling: Calling): (model: Model) => Model
  (model: Model, calling: Calling): Model
} = Function.dual(2, (model: Model, calling: Calling): Model =>
  isCallingOwned(calling, model.boughtCosmetics)
    ? model
    : chooseCalling(
        UiStruct.evolve(model, {
          rank: rank =>
            UiStruct.evolve(rank, {
              spentBones: spent =>
                spent + Option.getOrElse(callingPriceOf(calling), () => 0),
            }),
          boughtCosmetics: bought => [...bought, heroIdOf(calling)],
        }),
        calling,
      ),
)
