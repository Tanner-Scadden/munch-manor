import { Function } from 'effect'

import { UiStruct } from '@effect/ui'

import type { Calling } from '#shared/playerData.ts'
import { freshGun } from '#world/gear/weapons.ts'
import {
  Arsenal,
  type Player,
  initialPlayer,
} from '#world/schema/worldSchema.ts'

import { maxHpOf, startsWithCooker } from './calling.ts'

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
