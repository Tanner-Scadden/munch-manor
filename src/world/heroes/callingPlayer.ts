import { Function } from 'effect'
import { modifyFields } from 'foldkit/struct'

import type { Calling } from '../../shared/playerData'
import { freshGun } from '../gear/weapons'
import { Arsenal, type Player, initialPlayer } from '../schema/worldSchema'
import { maxHpOf, startsWithCooker } from './calling'

// NOTE: a player (a co-op seat already at its spot in the room, or the
// first one a run starts with) made over as a calling: its hearts, and its
// gun. Everyone holds the Pop Pistol except the Line Cook, who holds the
// Pressure Cooker in its place. A magazine is its calling's size. Its place
// and the rest of it are kept.
export const seatedAs: {
  (calling: Calling): (player: Player) => Player
  (player: Player, calling: Calling): Player
} = Function.dual(2, (player: Player, calling: Calling): Player =>
  modifyFields(player, {
    calling: () => calling,
    hp: () => maxHpOf({ calling }),
    arsenal: () =>
      Arsenal.OneGun({
        first: freshGun(
          startsWithCooker(calling) ? 'Cooker' : 'Pistol',
          calling,
        ),
      }),
  }),
)

// NOTE: the player a run starts with for a calling.
export const playerOfCalling = (calling: Calling): Player =>
  seatedAs(initialPlayer, calling)
