import { Array, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { AmmoTip } from './clientSchema'
import type { Model } from './model'
import { isCoop } from './party'
import {
  gunsOf,
  hasEndlessRounds,
  heldGun,
  isReloadable,
  magazineOf,
  startingRounds,
} from './weapons'
import { type CarriedGun, GameEvent, Phase, type Player } from './worldSchema'

// NOTE: how close a gun with limited ammo is to running out, from a
// playtest where a player traded up to the Chatterbox and died the first
// time it ran dry. The Pop Pistol and the Clang Pan never run out, so they
// are always Plenty. A reloadable gun is Low with about two magazines (or a
// quarter of what it comes with) left, and Last on its last magazine. Brain
// Freeze, never reloaded, is Low at half its charges and Last at a quarter.
export type AmmoLevel = 'Plenty' | 'Low' | 'Last' | 'Dry'

export const ammoLevelOf = (gun: CarriedGun): AmmoLevel => {
  if (hasEndlessRounds(gun.kind) || gun.kind === 'Pan') {
    return 'Plenty'
  }
  const magazine = magazineOf(gun.kind, gun.tier)
  const lastAt = isReloadable(gun.kind) ? magazine : Math.ceil(magazine / 4)
  const lowAt = isReloadable(gun.kind)
    ? Math.max(magazine * 2, Math.ceil(startingRounds(gun.kind) / 4))
    : Math.ceil(magazine / 2)
  if (gun.rounds <= 0) {
    return 'Dry'
  } else if (gun.rounds <= lastAt) {
    return 'Last'
  } else if (gun.rounds <= lowAt) {
    return 'Low'
  } else {
    return 'Plenty'
  }
}

export const isRunningLow = (gun: CarriedGun): boolean => {
  const level = ammoLevelOf(gun)
  return level === 'Low' || level === 'Last'
}

// NOTE: the last few shots of a gun that can run dry each tick, so the ear
// hears it coming before the click.
const TICK_ROUNDS = 5

export const isTickingShot = (
  player: Player,
  events: ReadonlyArray<GameEvent>,
): boolean => {
  const gun = heldGun(player.arsenal)
  const level = ammoLevelOf(gun)
  return (
    (level === 'Last' || level === 'Dry') &&
    gun.rounds < TICK_ROUNDS &&
    Array.some(
      events,
      event => GameEvent.isAnyOf(['Fired'])(event) && event.weapon === gun.kind,
    )
  )
}

// NOTE: no gun the player carries has anything left to fire, so the melee
// slot (the knife or the Pan) is the way out.
export const isOutOfGuns = (player: Player): boolean =>
  pipe(
    gunsOf(player.arsenal),
    Array.every(gun => ammoLevelOf(gun) === 'Dry'),
  )

// RATTLES' CALL

export const AMMO_TIP_MS = 4500

const isTipWorthy = (model: Model): boolean =>
  Phase.isAnyOf(['Wave', 'Preparation'])(model.phase) &&
  !isCoop(model) &&
  isRunningLow(heldGun(model.player.arsenal))

// NOTE: the first time ever the held gun runs low, Rattles calls from the
// stall for a few seconds. The frame's own time drains it, so a pause holds
// it.
export const noteAmmoTip = (model: Model, deltaMs: number): Model =>
  AmmoTip.match(model.ammoTip, {
    Unseen: () =>
      isTipWorthy(model)
        ? modifyFields(model, {
            ammoTip: () => AmmoTip.Showing({ remainingMs: AMMO_TIP_MS }),
          })
        : model,
    Showing: ({ remainingMs }) =>
      modifyFields(model, {
        ammoTip: () =>
          remainingMs > deltaMs
            ? AmmoTip.Showing({ remainingMs: remainingMs - deltaMs })
            : AmmoTip.Seen(),
      }),
    Seen: () => model,
  })
