import { Array, Function, Option } from 'effect'

import { isFridgeWeapon } from '../../../src/world/fridge/fridgeWeapons'
import { gunsOf, heldGun, maybePanOf } from '../../../src/world/gear/weapons'
import { focusOf } from '../../../src/world/party/party'
import { type Model, tapKey } from './basics'

export type Gun = ReturnType<typeof heldGun>

export const gunsOfBot = (model: Model): ReadonlyArray<Gun> =>
  gunsOf(focusOf(model).player.arsenal)

export const panOf = (model: Model): Gun | undefined =>
  Option.getOrUndefined(maybePanOf(focusOf(model).player))

export const fridgeSpareOf = (model: Model): Gun | undefined =>
  Option.getOrUndefined(
    Array.findFirst(gunsOfBot(model), gun => isFridgeWeapon(gun.kind)),
  )

export type FridgeSpare = Gun

const firearmOf = (model: Model): Gun | undefined =>
  Option.getOrUndefined(
    Array.findFirst(
      gunsOfBot(model),
      gun => gun.kind === 'Smg' || gun.kind === 'Shotgun',
    ),
  )

export const pistolOf = (model: Model): Gun | undefined =>
  Option.getOrUndefined(
    Array.findFirst(gunsOfBot(model), gun => gun.kind === 'Pistol'),
  )

export const spareOf = (model: Model): Gun | undefined =>
  firearmOf(model) ?? fridgeSpareOf(model)

export const gunValue = (gun: Gun): number =>
  baseGunValue(gun) + (gun.perk === undefined ? 0 : 1)

const baseGunValue = (gun: Gun): number => {
  if (gun.kind === 'Pistol') {
    return 1 + gun.tier
  }
  if (gun.kind === 'Shotgun') {
    return 2 + gun.tier
  }
  if (gun.kind === 'Smg') {
    return 3 + gun.tier * 1.5
  }
  if (gun.kind === 'Freeze') {
    return 3
  }
  if (gun.kind === 'Rifle') {
    return 2.75 + gun.tier * 1.25
  }
  if (gun.kind === 'Blunderbuss') {
    return 2.5 + gun.tier
  }
  return 4 + gun.tier
}

export const weakerGun = (model: Model): Gun | undefined => {
  const guns = gunsOfBot(model)
  return guns.length < 2
    ? undefined
    : [...guns].sort((a, b) => gunValue(a) - gunValue(b))[0]
}

export const holdToReplace: {
  (gun: Gun | undefined): (model: Model) => Model
  (model: Model, gun: Gun | undefined): Model
} = Function.dual(2, (model: Model, gun: Gun | undefined): Model =>
  gun !== undefined && heldGun(focusOf(model).player.arsenal).kind !== gun.kind
    ? tapKey(model, 'KeyQ')
    : model,
)
