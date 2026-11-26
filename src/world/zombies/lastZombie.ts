import { Array, Function } from 'effect'

import { UiStruct } from '@effect/ui'

import { PLAYER_SPEED } from '../../shared/constants'
import { Finale } from '../dare/dareSchema'
import type { World } from '../schema/world'
import { Boss, Phase, type Zombie } from '../schema/worldSchema'
import { isAlive } from '../waves/pacing'
import { isBoss } from './zombies'

type LastZombieRules = Readonly<{
  stragglers: number
  delayMs: number
  rampMs: number
}>

export const LAST_ZOMBIE_RULES: LastZombieRules = {
  stragglers: 3,
  delayMs: 3000,
  rampMs: 2000,
}

const isFinaleQuiet = (world: World): boolean =>
  Finale.isAnyOf(['Hunting'])(world.dare.finale)

const isLastZombieDue = (world: World): boolean => {
  if (
    !Phase.isAnyOf(['Wave'])(world.phase) ||
    !Array.isReadonlyArrayEmpty(world.phase.spawns) ||
    !Boss.isAnyOf(['Absent'])(world.boss) ||
    !isFinaleQuiet(world)
  ) {
    return false
  }
  const alive = Array.filter(world.zombies, isAlive)
  return (
    alive.length > 0 &&
    alive.length <= LAST_ZOMBIE_RULES.stragglers &&
    !Array.some(alive, isBoss)
  )
}

export const advanceLastZombie: {
  (deltaMs: number): (world: World) => World
  (world: World, deltaMs: number): World
} = Function.dual(2, (world: World, deltaMs: number): World => {
  const loneMs = isLastZombieDue(world) ? world.pacing.loneMs + deltaMs : 0
  return loneMs === world.pacing.loneMs
    ? world
    : UiStruct.evolve(world, {
        pacing: pacing => UiStruct.evolve(pacing, { loneMs: () => loneMs }),
      })
})

const isHurrying = (loneMs: number): boolean =>
  loneMs > LAST_ZOMBIE_RULES.delayMs

export const isLastZombie: {
  (loneMs: number): (zombie: Zombie) => boolean
  (zombie: Zombie, loneMs: number): boolean
} = Function.dual(
  2,
  (zombie: Zombie, loneMs: number): boolean =>
    isHurrying(loneMs) && isAlive(zombie),
)

export const lastZombieSpeed: {
  (loneMs: number): (speed: number) => number
  (speed: number, loneMs: number): number
} = Function.dual(2, (speed: number, loneMs: number): number => {
  const share = Math.min(
    1,
    Math.max(0, loneMs - LAST_ZOMBIE_RULES.delayMs) / LAST_ZOMBIE_RULES.rampMs,
  )
  return speed + Math.max(0, PLAYER_SPEED - speed) * share
})
