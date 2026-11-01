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

// NOTE: a player (a co-op seat already at its spot in the room, or the
// first one a run starts with) made over as a calling: its hearts, and its
// gun. Everyone holds the Pop Pistol except the Line Cook, who holds the
// Pressure Cooker in its place. A magazine is its calling's size. Its place
// and the rest of it are kept.
export const seatedAs = (player: Player, calling: Calling): Player =>
  modifyFields(player, {
    calling: () => calling,
    hp: () => maxHpOf({ calling }),
    arsenal: () =>
      Arsenal.OneGun({
        first: startsWithCooker(calling)
          ? cookerOfCook(calling)
          : freshGun('Pistol', calling),
      }),
  })

// NOTE: the player a run starts with for a calling.
export const playerOfCalling = (calling: Calling): Player =>
  seatedAs(initialPlayer, calling)
