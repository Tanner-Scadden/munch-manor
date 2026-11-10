import { Array, Function } from 'effect'

import { isObjectFirst } from '../../shared/dualArgs'
import type { Calling } from '../../shared/playerData'
import {
  carriedMagazine,
  heldGun,
  isReloadable,
} from '../../world/gear/weapons'
import {
  type CarriedGun,
  GameEvent,
  type Player,
} from '../../world/schema/worldSchema'

// NOTE: no gun runs out (docs/ESCAPE_PLAN.md, "Endless ammo"), but a
// magazine still does, and the reload is the risky moment. The last few
// shots of a magazine tick and blink red, so the ear and the eye hear the
// reload coming before the click: up to five shots, or a quarter of the
// magazine the player's own calling gives the gun (the Track Star's are
// smaller), whichever is fewer. The Clang Pan's dents are never reloaded,
// so it never ticks.
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

// NOTE: a shot that leaves the magazine on its last few rounds, or empty,
// ticks.
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
