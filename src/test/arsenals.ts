import { Array, Function, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'

import {
  STARTING_PISTOL,
  gunsOf,
  mapGuns,
  maybeCarried,
} from '../world/gear/weapons'
import {
  Arsenal,
  type CarriedGun,
  type Player,
} from '../world/schema/worldSchema'

// The arsenals tests build, apart from src/test/testing.ts.

// NOTE: the arsenals tests reach for most: the pistol alone, or the pistol
// in the first slot and another gun in the second, held either way.
export const pistolOnly = (pistol: CarriedGun = STARTING_PISTOL): Arsenal =>
  Arsenal.OneGun({ first: pistol })

// NOTE: with the Pop Pistol in the first slot; a test with another gun
// there builds the Arsenal itself.
export const holdingSecond = (second: CarriedGun): Arsenal =>
  Arsenal.HoldingSecond({ first: STARTING_PISTOL, second })

export const holdingFirst = (second: CarriedGun): Arsenal =>
  Arsenal.HoldingFirst({ first: STARTING_PISTOL, second })

// NOTE: changes the carried Pop Pistol, wherever it sits.
export const withPistol: {
  (change: (pistol: CarriedGun) => CarriedGun): (player: Player) => Player
  (player: Player, change: (pistol: CarriedGun) => CarriedGun): Player
} = Function.dual(
  2,
  (player: Player, change: (pistol: CarriedGun) => CarriedGun): Player =>
    modifyFields(player, {
      arsenal: arsenal =>
        mapGuns(arsenal, gun => (gun.kind === 'Pistol' ? change(gun) : gun)),
    }),
)

export const pistolOf = (player: Player): CarriedGun =>
  Option.getOrThrow(maybeCarried(player, 'Pistol'))

// NOTE: the carried gun that is not the Pop Pistol, if any: what the old
// spare slot held.
export const maybeSpareGun = (arsenal: Arsenal): Option.Option<CarriedGun> =>
  Array.findFirst(gunsOf(arsenal), gun => gun.kind !== 'Pistol')

export const SHOTGUN: CarriedGun = {
  kind: 'Shotgun',
  loaded: 6,
  tier: 0,
  kills: 0,
}
