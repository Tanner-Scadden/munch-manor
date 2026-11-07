import { Array, Function } from 'effect'
import { modifyFields } from 'foldkit/struct'

import type { World } from './world'
import { type Zombie, ZombieAction } from './worldSchema'

// RECOVERY

// NOTE: how long a zombie the Clang Pan rang stays Winded once it is up,
// so the Pan cannot daze it again at once (src/fridgeWeapons.ts).
export const REELING_GUARD_MS = 1200

const isRecovering = ZombieAction.isAnyOf([
  'Winded',
  'Dazed',
  'Frozen',
  'Chilled',
  'Reeling',
])

const recover =
  (deltaMs: number) =>
  (zombie: Zombie): Zombie => {
    const action = zombie.action
    if (ZombieAction.isAnyOf(['Winded'])(action)) {
      return modifyFields(zombie, {
        action: () =>
          action.remainingMs > deltaMs
            ? ZombieAction.Winded({ remainingMs: action.remainingMs - deltaMs })
            : ZombieAction.Roaming(),
      })
    } else if (ZombieAction.isAnyOf(['Dazed'])(action)) {
      return modifyFields(zombie, {
        action: () =>
          action.remainingMs > deltaMs
            ? ZombieAction.Dazed({
                remainingMs: action.remainingMs - deltaMs,
                durationMs: action.durationMs,
              })
            : ZombieAction.Roaming(),
      })
    } else if (ZombieAction.isAnyOf(['Frozen'])(action)) {
      return modifyFields(zombie, {
        action: () =>
          action.remainingMs > deltaMs
            ? ZombieAction.Frozen({
                remainingMs: action.remainingMs - deltaMs,
                durationMs: action.durationMs,
              })
            : ZombieAction.Roaming(),
      })
    } else if (ZombieAction.isAnyOf(['Chilled'])(action)) {
      return modifyFields(zombie, {
        action: () =>
          action.remainingMs > deltaMs
            ? ZombieAction.Chilled({
                remainingMs: action.remainingMs - deltaMs,
              })
            : ZombieAction.Roaming(),
      })
    } else if (ZombieAction.isAnyOf(['Reeling'])(action)) {
      return modifyFields(zombie, {
        action: () =>
          action.remainingMs > deltaMs
            ? ZombieAction.Reeling({
                remainingMs: action.remainingMs - deltaMs,
                durationMs: action.durationMs,
              })
            : ZombieAction.Winded({ remainingMs: REELING_GUARD_MS }),
      })
    } else {
      return zombie
    }
  }

export const recoverActions: {
  (deltaMs: number): (model: World) => World
  (model: World, deltaMs: number): World
} = Function.dual(2, (model: World, deltaMs: number): World =>
  Array.some(model.zombies, zombie => isRecovering(zombie.action))
    ? modifyFields(model, {
        zombies: Array.map(recover(deltaMs)),
      })
    : model,
)
