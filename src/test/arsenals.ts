import { Array, Function, Option } from 'effect'

import { UiStruct } from '@effect/ui'

import {
  STARTING_PISTOL,
  freshGun,
  gunsOf,
  magazineOf,
  mapGuns,
  maybeCarried,
} from '#world/gear/weapons.ts'
import {
  Arsenal,
  type CarriedGun,
  type Player,
  type WeaponKind,
} from '#world/schema/worldSchema.ts'

export const pistolOnly = (pistol: CarriedGun = STARTING_PISTOL): Arsenal =>
  Arsenal.OneGun({ first: pistol })

export const holdingSecond = (second: CarriedGun): Arsenal =>
  Arsenal.HoldingSecond({ first: STARTING_PISTOL, second })

export const holdingFirst = (second: CarriedGun): Arsenal =>
  Arsenal.HoldingFirst({ first: STARTING_PISTOL, second })

export const withPistol: {
  (change: (pistol: CarriedGun) => CarriedGun): (player: Player) => Player
  (player: Player, change: (pistol: CarriedGun) => CarriedGun): Player
} = Function.dual(
  2,
  (player: Player, change: (pistol: CarriedGun) => CarriedGun): Player =>
    UiStruct.evolve(player, {
      arsenal: arsenal =>
        mapGuns(arsenal, gun => (gun.kind === 'Pistol' ? change(gun) : gun)),
    }),
)

export const pistolOf = (player: Player): CarriedGun =>
  Option.getOrThrow(maybeCarried(player, 'Pistol'))

export const maybeSpareGun = (arsenal: Arsenal): Option.Option<CarriedGun> =>
  Array.findFirst(gunsOf(arsenal), gun => gun.kind !== 'Pistol')

export const SHOTGUN: CarriedGun = {
  kind: 'Shotgun',
  loaded: 6,
  tier: 0,
  kills: 0,
}

export const gunAt: {
  (tier: number, kills: number): (kind: WeaponKind) => CarriedGun
  (kind: WeaponKind, tier: number, kills: number): CarriedGun
} = Function.dual(
  3,
  (kind: WeaponKind, tier: number, kills: number): CarriedGun => ({
    ...freshGun(kind),
    loaded: magazineOf(kind, tier),
    tier,
    kills,
  }),
)
