import { Function } from 'effect'

import { UiStruct } from '@effect/ui'

import type { Calling } from '../../shared/playerData'
import { freshGun } from '../gear/weapons'
import { Arsenal, type Player, initialPlayer } from '../schema/worldSchema'
import { maxHpOf, startsWithCooker } from './calling'

export const seatedAs: {
  (calling: Calling): (player: Player) => Player
  (player: Player, calling: Calling): Player
} = Function.dual(2, (player: Player, calling: Calling): Player =>
  UiStruct.evolve(player, {
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

export const playerOfCalling = (calling: Calling): Player =>
  seatedAs(initialPlayer, calling)
