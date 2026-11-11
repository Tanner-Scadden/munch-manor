import { Array, Function, Option } from 'effect'

import { isFridgeWeapon } from '../../../src/world/fridge/fridgeWeapons'
import { gunsOf, heldGun, maybePanOf } from '../../../src/world/gear/weapons'
import { focusOf } from '../../../src/world/party/party'
import { type Model, tapKey } from './basics'

// THE GUNS

export type Gun = ReturnType<typeof heldGun>

export const gunsOfBot = (model: Model): ReadonlyArray<Gun> =>
  gunsOf(focusOf(model).player.arsenal)

// The Clang Pan in the melee slot, if the fridge has given one.
export const panOf = (model: Model): Gun | undefined =>
  Option.getOrUndefined(maybePanOf(focusOf(model).player))

// The fridge weapon the bot carries in a gun slot (the Cooker or Brain
// Freeze; the Pan is in the melee slot).
export const fridgeSpareOf = (model: Model): Gun | undefined =>
  Option.getOrUndefined(
    Array.findFirst(gunsOfBot(model), gun => isFridgeWeapon(gun.kind)),
  )

export type FridgeSpare = Gun

// The gun the bot bought from Rattles (the Barn Buster or the Chatterbox).
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

// What the bot used to call its spare: the gun it bought, else its fridge
// weapon. The pistol is never the spare.
export const spareOf = (model: Model): Gun | undefined =>
  firearmOf(model) ?? fridgeSpareOf(model)

// How much the bot values a gun in a slot, to choose which one a new gun
// replaces: the pistol little, and an upgraded Chatterbox the most. A perk
// the stove cooked onto it adds 1.
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
  // NOTE: the case guns: Old Thunder's slow, hard hits a little under the
  // Chatterbox, the blunderbuss's two barrels a little over the Barn Buster.
  if (gun.kind === 'Rifle') {
    return 2.75 + gun.tier * 1.25
  }
  if (gun.kind === 'Blunderbuss') {
    return 2.5 + gun.tier
  }
  return 4 + gun.tier
}

// The gun a new one would replace: none while a slot is free, else the
// weakest of the two.
export const weakerGun = (model: Model): Gun | undefined => {
  const guns = gunsOfBot(model)
  return guns.length < 2
    ? undefined
    : [...guns].sort((a, b) => gunValue(a) - gunValue(b))[0]
}

// A new gun replaces the one in the player's hands, so before it buys or
// takes one the bot holds the gun it means to give up.
export const holdToReplace: {
  (gun: Gun | undefined): (model: Model) => Model
  (model: Model, gun: Gun | undefined): Model
} = Function.dual(2, (model: Model, gun: Gun | undefined): Model =>
  gun !== undefined && heldGun(focusOf(model).player.arsenal).kind !== gun.kind
    ? tapKey(model, 'KeyQ')
    : model,
)
