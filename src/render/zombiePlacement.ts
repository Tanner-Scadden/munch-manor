import { Function } from 'effect'

import type { Tone } from '../art/sprite'
import { type Zombie, ZombieAction } from '../world/schema/entitySchema'
import { CHUCKER_RULES, THROWER_KIND } from '../world/zombies/chucker'
import { FULL_TURN, QUARTER_TURN } from './drawing'

// ACTIONS

const HEFT_TELL_SLOW_MS = 200
const HEFT_TELL_FAST_MS = 60
const CARRY_LIFT_PX = 28
const CARRY_WIGGLE_MS = 90
const FLIGHT_PEAK_PX = 34
const FLIGHT_LIFT_PX = 15
const FLIGHT_SPIN_MS = 260
export const DAZE_STAR_MS = 700
export const DAZE_STAR_COLOR = '#ffe066'
const CLING_SHAKE_MS = 60
const SHIELD_LIFT_PX = 2
const SQUIRM_MS = 110
const SQUIRM_RADIANS = 0.18

const TAUNT_MS = 500
export const TAUNT_PUMP_MS = 120

// NOTE: right after a throw the Big Leaguer pumps his fist. His wind after a
// throw is the only one long enough to start inside the taunt, so arriving
// winded or cooling down from a shield never shows it.
export const isTauntingAt = (zombie: Zombie): boolean =>
  zombie.kind === THROWER_KIND &&
  ZombieAction.isAnyOf(['Winded'])(zombie.action) &&
  zombie.action.remainingMs > CHUCKER_RULES.windedMs - TAUNT_MS

export const heftTone = (zombie: Zombie): Tone => {
  if (!ZombieAction.isAnyOf(['Hefting'])(zombie.action)) {
    return 'Normal'
  }
  const { remainingMs, durationMs } = zombie.action
  const urgency = 1 - remainingMs / Math.max(1, durationMs)
  const periodMs =
    HEFT_TELL_SLOW_MS + (HEFT_TELL_FAST_MS - HEFT_TELL_SLOW_MS) * urgency
  return Math.floor(remainingMs / periodMs) % 2 === 0 ? 'Flash' : 'Normal'
}

type Placement = Readonly<{
  lift: number
  rotate: number
  nudgeX: number
  isStill: boolean
}>

const ON_FEET: Placement = { lift: 0, rotate: 0, nudgeX: 0, isStill: false }

// NOTE: a Groaner held overhead hangs upside down by its ankles in the
// Big Leaguer's raised hands, kicking. A half turn hangs its body below its feet,
// so its feet are lifted above the Big Leaguer's head by its own height.

export const placementOf: {
  (elapsedMs: number): (zombie: Zombie) => Placement
  (zombie: Zombie, elapsedMs: number): Placement
} = Function.dual(2, (zombie: Zombie, elapsedMs: number): Placement =>
  ZombieAction.match(zombie.action, {
    Roaming: () => ON_FEET,
    Winded: () => ON_FEET,
    Hefting: () => ({
      lift: 0,
      rotate: 0,
      nudgeX: Math.floor(elapsedMs / 50) % 2 === 0 ? 1 : 0,
      isStill: true,
    }),
    Carried: () => ({
      lift: CARRY_LIFT_PX,
      rotate:
        Math.PI +
        (Math.floor(elapsedMs / CARRY_WIGGLE_MS) % 2 === 0 ? 0.12 : -0.12),
      nudgeX: 0,
      isStill: false,
    }),
    Flying: ({ remainingMs, durationMs }) => {
      const progress = 1 - remainingMs / Math.max(1, durationMs)
      return {
        lift:
          4 * FLIGHT_PEAK_PX * progress * (1 - progress) +
          FLIGHT_LIFT_PX * (1 - progress),
        rotate: (FULL_TURN * (durationMs - remainingMs)) / FLIGHT_SPIN_MS,
        nudgeX: 0,
        isStill: false,
      }
    },
    Dazed: () => ({
      lift: 0,
      rotate: QUARTER_TURN,
      nudgeX: 0,
      isStill: true,
    }),
    Burrowed: () => ON_FEET,
    Frozen: () => ({ lift: 0, rotate: 0, nudgeX: 0, isStill: true }),
    Chilled: () => ON_FEET,
    Reeling: () => ({
      lift: 0,
      rotate: QUARTER_TURN,
      nudgeX: 0,
      isStill: true,
    }),
    Shielding: () => ({ lift: 0, rotate: 0, nudgeX: 0, isStill: true }),
    Shielded: () => ({
      lift: SHIELD_LIFT_PX,
      rotate:
        Math.floor(elapsedMs / SQUIRM_MS) % 2 === 0
          ? SQUIRM_RADIANS
          : -SQUIRM_RADIANS,
      nudgeX: 0,
      isStill: false,
    }),
    Clinging: () => ({
      lift: 0,
      rotate: 0,
      nudgeX: Math.floor(elapsedMs / CLING_SHAKE_MS) % 2 === 0 ? 1 : -1,
      isStill: true,
    }),
  }),
)
