import { Array, Function } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { PLAYER_SPEED } from '../../shared/constants'
import { Finale } from '../dare/dareSchema'
import type { World } from '../schema/world'
import { Boss, Phase, type Zombie } from '../schema/worldSchema'
import { isAlive } from '../waves/pacing'
import { isBoss } from './zombies'

// The last zombie (GAME_DESIGN.md, "The last zombie"): once a wave has
// nothing left to send and one zombie alone still stands, it hurries, so a
// straggler ends the round instead of dragging it out. Over rampMs its pace
// climbs from its own to the players' walk, PLAYER_SPEED, and never slows
// one already faster. It chases as ever, down the flow field; a Big Leaguer
// alone stops keeping his distance and comes straight in, and an Ankle
// Biter hurries once it is up out of the floor. Uncle Chunk never hurries,
// and nor does anything while he is waiting, arriving, or fighting, or once
// the finale is under way. The clock is the World's pacing.loneMs, counted
// while the rule holds and back to 0 the moment it does not.

// RULES

type LastZombieRules = Readonly<{
  rampMs: number
}>

export const LAST_ZOMBIE_RULES: LastZombieRules = {
  rampMs: 2000,
}

// TRIGGER

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
  return alive.length === 1 && !Array.some(alive, isBoss)
}

export const advanceLastZombie: {
  (deltaMs: number): (world: World) => World
  (world: World, deltaMs: number): World
} = Function.dual(2, (world: World, deltaMs: number): World => {
  const loneMs = isLastZombieDue(world) ? world.pacing.loneMs + deltaMs : 0
  return loneMs === world.pacing.loneMs
    ? world
    : modifyFields(world, {
        pacing: pacing => modifyFields(pacing, { loneMs: () => loneMs }),
      })
})

// NOTE: while the clock runs, the one zombie still alive is the last one,
// so asking costs no search of the list.
export const isLastZombie: {
  (loneMs: number): (zombie: Zombie) => boolean
  (zombie: Zombie, loneMs: number): boolean
} = Function.dual(
  2,
  (zombie: Zombie, loneMs: number): boolean => loneMs > 0 && isAlive(zombie),
)

// PACE

export const lastZombieSpeed: {
  (loneMs: number): (speed: number) => number
  (speed: number, loneMs: number): number
} = Function.dual(2, (speed: number, loneMs: number): number => {
  const share = Math.min(1, loneMs / LAST_ZOMBIE_RULES.rampMs)
  return speed + Math.max(0, PLAYER_SPEED - speed) * share
})
