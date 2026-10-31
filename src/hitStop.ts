// Hit-stop: a tick's kills, hurts, and blasts freeze the world for a few
// ticks, and the boss's fall slows it, so a hit lands. It is the World's: a
// co-op room runs it too. The cosmetics a hit makes are in src/juice.ts.

import { Array } from 'effect'
import { modifyFields } from 'foldkit/struct'

import {
  HIT_STOP_BLAST_MS,
  HIT_STOP_COOLDOWN_MS,
  HIT_STOP_EXTRA_KILL_MS,
  HIT_STOP_HURT_MS,
  HIT_STOP_KILL_MAX_MS,
  HIT_STOP_KILL_MS,
  HIT_STOP_MAX_MS,
  STEP_EPSILON_MS,
} from './constants'
import type { World } from './world'
import { GameEvent, HitStop } from './worldSchema'

// HIT-STOP

type Thaw = Readonly<{ hitStop: HitStop; worldMs: number }>

const BOSS_SLOW_MOTION_MS = 1400
const BOSS_SLOW_MOTION_RATE = 0.25

// NOTE: hit-stop counts whole ticks. A frozen tick runs no world, and a
// freeze lasts its length rounded to whole ticks. Slow motion runs one world
// tick each time its scaled time adds up to a whole tick.
export const thawTick = (hitStop: HitStop, tickMs: number): Thaw =>
  HitStop.match(hitStop, {
    Running: () => ({ hitStop, worldMs: tickMs }),
    Slowed: ({ remainingMs, carryMs }) => {
      const scaledMs = carryMs + tickMs * BOSS_SLOW_MOTION_RATE
      const isStepping = scaledMs >= tickMs - STEP_EPSILON_MS
      const leftMs = remainingMs - tickMs
      return {
        hitStop:
          leftMs > tickMs / 2
            ? HitStop.Slowed({
                remainingMs: leftMs,
                carryMs: isStepping ? Math.max(0, scaledMs - tickMs) : scaledMs,
              })
            : HitStop.Running({ cooldownMs: HIT_STOP_COOLDOWN_MS }),
        worldMs: isStepping ? tickMs : 0,
      }
    },
    Frozen: ({ remainingMs }) => {
      const leftMs = remainingMs - tickMs
      return {
        hitStop:
          leftMs > tickMs / 2
            ? HitStop.Frozen({ remainingMs: leftMs })
            : HitStop.Running({ cooldownMs: HIT_STOP_COOLDOWN_MS }),
        worldMs: 0,
      }
    },
  })

const killFreezeMs = (kills: number, cooldownMs: number): number =>
  kills > 0 && cooldownMs <= 0
    ? Math.min(
        HIT_STOP_KILL_MAX_MS,
        HIT_STOP_KILL_MS + (kills - 1) * HIT_STOP_EXTRA_KILL_MS,
      )
    : 0

const triggerHitStop = (
  hitStop: HitStop,
  kills: number,
  hurts: number,
  blasts: number,
  worldMs: number,
): HitStop =>
  HitStop.match(hitStop, {
    Frozen: () => hitStop,
    Slowed: () => hitStop,
    Running: ({ cooldownMs }) => {
      const cooledMs = Math.max(0, cooldownMs - worldMs)
      const freezeMs = Math.min(
        HIT_STOP_MAX_MS,
        Math.max(
          killFreezeMs(kills, cooledMs),
          hurts > 0 ? HIT_STOP_HURT_MS : 0,
          blasts > 0 && cooledMs <= 0 ? HIT_STOP_BLAST_MS : 0,
        ),
      )
      return freezeMs > 0
        ? HitStop.Frozen({ remainingMs: freezeMs })
        : HitStop.Running({ cooldownMs: cooledMs })
    },
  })

// HITS

export const countWhere = (
  events: ReadonlyArray<GameEvent>,
  isMatch: (event: GameEvent) => boolean,
): number => Array.filter(events, isMatch).length

// NOTE: hit-stop is decided on each tick's own events, since it decides
// how much world time the next ticks get.
export const stopForHits = (model: World, worldMs: number): World => {
  const events = model.frameEvents
  const isBossFelled = Array.some(
    events,
    event =>
      GameEvent.isAnyOf(['ZombieKilled'])(event) && event.kind === 'Boss',
  )
  return modifyFields(model, {
    hitStop: hitStop =>
      isBossFelled
        ? HitStop.Slowed({ remainingMs: BOSS_SLOW_MOTION_MS, carryMs: 0 })
        : triggerHitStop(
            hitStop,
            countWhere(events, GameEvent.isAnyOf(['ZombieKilled'])),
            countWhere(events, GameEvent.isAnyOf(['PlayerHurt'])),
            countWhere(events, GameEvent.isAnyOf(['Exploded'])),
            worldMs,
          ),
  })
}
