import { Array, Function } from 'effect'

import { isObjectFirst } from '#shared/dualArgs.ts'
import type { Calling } from '#shared/playerData.ts'
import { carriedMagazine, heldGun, isReloadable } from '#world/gear/weapons.ts'
import {
  type CarriedGun,
  GameEvent,
  type Player,
} from '#world/schema/worldSchema.ts'

const TICK_ROUNDS = 5

const lastShotsOf = (gun: CarriedGun, calling: Calling): number =>
  Math.min(TICK_ROUNDS, Math.ceil(carriedMagazine(calling, gun) / 4))

export const isOnLastShots: {
  (calling?: Calling): (gun: CarriedGun) => boolean
  (gun: CarriedGun, calling?: Calling): boolean
} = Function.dual(
  isObjectFirst,
  (gun: CarriedGun, calling: Calling = 'You'): boolean =>
    isReloadable(gun.kind) &&
    gun.loaded > 0 &&
    gun.loaded < lastShotsOf(gun, calling),
)

export const isTickingShot: {
  (events: ReadonlyArray<GameEvent>): (player: Player) => boolean
  (player: Player, events: ReadonlyArray<GameEvent>): boolean
} = Function.dual(
  2,
  (player: Player, events: ReadonlyArray<GameEvent>): boolean => {
    const gun = heldGun(player.arsenal)
    return (
      isReloadable(gun.kind) &&
      gun.loaded < lastShotsOf(gun, player.calling) &&
      Array.some(
        events,
        event =>
          GameEvent.isAnyOf(['Fired'])(event) && event.weapon === gun.kind,
      )
    )
  },
)
