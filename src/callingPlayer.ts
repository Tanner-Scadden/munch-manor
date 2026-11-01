import { modifyFields } from 'foldkit/struct'

import { COOK_STARTING_LIDS, maxHpOf, startsWithCooker } from './calling'
import type { Calling } from './playerData'
import { freshGun } from './weapons'
import {
  Arsenal,
  type CarriedGun,
  type Player,
  initialPlayer,
} from './worldSchema'

// NOTE: the Cooker the Line Cook starts with: a fresh one with fewer lids.
const cookerOfCook = (calling: Calling): CarriedGun => {
  const fresh = freshGun('Cooker', calling)
  return {
    ...fresh,
    rounds: COOK_STARTING_LIDS,
    loaded: Math.min(fresh.loaded, COOK_STARTING_LIDS),
  }
}

// NOTE: the player a run starts with for a calling: its hearts, and its
// gun. Everyone holds the Pop Pistol except the Line Cook, who holds the
// Pressure Cooker in its place. A magazine is its calling's size.
export const playerOfCalling = (calling: Calling): Player =>
  modifyFields(initialPlayer, {
    calling: () => calling,
    hp: () => maxHpOf({ calling }),
    arsenal: () =>
      Arsenal.OneGun({
        first: startsWithCooker(calling)
          ? cookerOfCook(calling)
          : freshGun('Pistol', calling),
      }),
  })
