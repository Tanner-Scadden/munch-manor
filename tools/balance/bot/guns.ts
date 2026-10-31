import { Option } from 'effect'

import { isFridgeWeapon } from '../../../src/fridgeWeapons'
import { gunsOf, heldGun, maybePanOf } from '../../../src/weapons'
import { type Model, tapKey } from './basics'

// THE GUNS

export type Gun = ReturnType<typeof heldGun>

export const gunsOfBot = (model: Model): ReadonlyArray<Gun> =>
  gunsOf(model.player.arsenal)

// The Clang Pan in the melee slot, if the fridge has given one.
export const panOf = (model: Model): Gun | undefined =>
  Option.getOrUndefined(maybePanOf(model.player))

// The fridge weapon the bot carries in a gun slot (the Cooker or Brain
// Freeze; the Pan is in the melee slot).
export const fridgeSpareOf = (model: Model): Gun | undefined =>
  gunsOfBot(model).find(gun => isFridgeWeapon(gun.kind))

export type FridgeSpare = Gun

// The gun the bot bought from Rattles (the Barn Buster or the Chatterbox).
export const firearmOf = (model: Model): Gun | undefined =>
  gunsOfBot(model).find(gun => gun.kind === 'Smg' || gun.kind === 'Shotgun')

export const pistolOf = (model: Model): Gun | undefined =>
  gunsOfBot(model).find(gun => gun.kind === 'Pistol')

// What the bot used to call its spare: the gun it bought, else its fridge
// weapon. The pistol is never the spare.
export const spareOf = (model: Model): Gun | undefined =>
  firearmOf(model) ?? fridgeSpareOf(model)

// A fridge weapon with nothing left to throw or spray.
export const isSpent = (gun: Gun): boolean =>
  (gun.kind === 'Freeze' || gun.kind === 'Cooker') && gun.rounds <= 0

// How much the bot values a gun in a slot, to choose which one a new gun
// replaces: a spent fridge weapon is worth nothing, the pistol little, and
// an upgraded Chatterbox the most.
export const gunValue = (gun: Gun): number => {
  if (isSpent(gun)) {
    return 0
  }
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
export const holdToReplace = (model: Model, gun: Gun | undefined): Model =>
  gun !== undefined && heldGun(model.player.arsenal).kind !== gun.kind
    ? tapKey(model, 'KeyQ')
    : model
