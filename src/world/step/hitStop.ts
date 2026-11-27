import { Array, Function } from 'effect'

import { UiStruct } from '@effect/ui'

import {
  HIT_STOP_BLAST_MS,
  HIT_STOP_COOLDOWN_MS,
  HIT_STOP_EXTRA_KILL_MS,
  HIT_STOP_HURT_MS,
  HIT_STOP_KILL_MAX_MS,
  HIT_STOP_KILL_MS,
  HIT_STOP_MAX_MS,
  HIT_STOP_WAVE_CLEAR_MS,
  STEP_EPSILON_MS,
} from '#shared/constants.ts'
import type { World } from '#world/schema/world.ts'
import { GameEvent, HitStop } from '#world/schema/worldSchema.ts'

type Thaw = Readonly<{ hitStop: HitStop; worldMs: number }>

const BOSS_SLOW_MOTION_MS = 1400
const BOSS_SLOW_MOTION_RATE = 0.25

export const thawTick: {
  (tickMs: number): (hitStop: HitStop) => Thaw
  (hitStop: HitStop, tickMs: number): Thaw
} = Function.dual(2, (hitStop: HitStop, tickMs: number): Thaw =>
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
  }),
)

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
      if (freezeMs > 0) {
        return HitStop.Frozen({ remainingMs: freezeMs })
      }
      return Object.is(cooledMs, cooldownMs)
        ? hitStop
        : HitStop.Running({ cooldownMs: cooledMs })
    },
  })

const clearingBlow = (hitStop: HitStop): HitStop =>
  HitStop.match(hitStop, {
    Running: () => HitStop.Frozen({ remainingMs: HIT_STOP_WAVE_CLEAR_MS }),
    Frozen: ({ remainingMs }) =>
      HitStop.Frozen({
        remainingMs: Math.max(remainingMs, HIT_STOP_WAVE_CLEAR_MS),
      }),
    Slowed: () => hitStop,
  })

export const countWhere: {
  (
    isMatch: (event: GameEvent) => boolean,
  ): (events: ReadonlyArray<GameEvent>) => number
  (
    events: ReadonlyArray<GameEvent>,
    isMatch: (event: GameEvent) => boolean,
  ): number
} = Function.dual(
  2,
  (
    events: ReadonlyArray<GameEvent>,
    isMatch: (event: GameEvent) => boolean,
  ): number => Array.filter(events, isMatch).length,
)

export const stopForHits: {
  (worldMs: number): (model: World) => World
  (model: World, worldMs: number): World
} = Function.dual(2, (model: World, worldMs: number): World => {
  const events = model.frameEvents
  const isBossFelled = Array.some(
    events,
    event =>
      GameEvent.isAnyOf(['ZombieKilled'])(event) && event.kind === 'Boss',
  )
  const isWaveCleared = Array.some(events, GameEvent.isAnyOf(['WaveCleared']))
  return UiStruct.evolve(model, {
    hitStop: hitStop =>
      isBossFelled
        ? HitStop.Slowed({ remainingMs: BOSS_SLOW_MOTION_MS, carryMs: 0 })
        : isWaveCleared
          ? clearingBlow(hitStop)
          : triggerHitStop(
              hitStop,
              countWhere(events, GameEvent.isAnyOf(['ZombieKilled'])),
              countWhere(events, GameEvent.isAnyOf(['PlayerHurt'])),
              countWhere(events, GameEvent.isAnyOf(['Exploded'])),
              worldMs,
            ),
  })
})
