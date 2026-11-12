import { Function } from 'effect'

import type { Tone } from '../art/sprite'
import {
  BossMove,
  type PlantedAttack,
  type Vector,
  type Zombie,
} from '../world/schema/entitySchema'
import { Boss } from '../world/schema/worldSchema'

// BOSS POSES

const BOSS_RISE_STRETCH = 0.16
const BOSS_CROUCH_SQUASH = 0.12
const BOSS_BELCH_SWELL = 0.18
const BOSS_SPIT_SWELL = 0.1
const BOSS_TELL_FAST_MS = 60
const BOSS_TELL_SLOW_MS = 180
const BOSS_LANDING_SQUASH = 0.2
const BOSS_STAMP_MS = 200
const BOSS_STAMP_SQUASH = 0.08
const BOSS_BRACE_LEAN = 0.12
const BOSS_RUSH_LEAN = 0.3
const BOSS_RUSH_STRETCH = 0.1
const BOSS_DAZE_SWAY = 0.14
const BOSS_DAZE_SWAY_MS = 140

type Pose = Readonly<{
  scale: Vector
  tone: Tone
  isGaping: boolean
  shakePx: number
  leanRadians: number
}>

export const STANDING_POSE: Pose = {
  scale: { x: 1, y: 1 },
  tone: 'Normal',
  isGaping: false,
  shakePx: 0,
  leanRadians: 0,
}

const tellTone = (remainingMs: number, durationMs: number): Tone => {
  const urgency = 1 - remainingMs / Math.max(1, durationMs)
  const periodMs =
    BOSS_TELL_SLOW_MS + (BOSS_TELL_FAST_MS - BOSS_TELL_SLOW_MS) * urgency
  return Math.floor(remainingMs / periodMs) % 2 === 0 ? 'Flash' : 'Normal'
}

const leanToward = (fromX: number, toX: number): number =>
  toX < fromX ? -1 : 1

const windUpPose = (
  attack: PlantedAttack,
  remainingMs: number,
  durationMs: number,
): Pose => {
  const progress = 1 - remainingMs / Math.max(1, durationMs)
  if (attack === 'Stomp') {
    const rise = Math.sin(Math.PI * Math.min(1, progress * 1.2))
    return {
      scale: {
        x: 1 - BOSS_CROUCH_SQUASH * rise * 0.5,
        y: 1 + BOSS_RISE_STRETCH * rise,
      },
      tone: tellTone(remainingMs, durationMs),
      isGaping: true,
      shakePx: 0,
      leanRadians: 0,
    }
  } else {
    const swell =
      (attack === 'Belch' ? BOSS_BELCH_SWELL : BOSS_SPIT_SWELL) * progress
    return {
      scale: { x: 1 + swell, y: 1 - swell * 0.4 },
      tone: 'Normal',
      isGaping: progress > 0.5,
      shakePx: progress > 0.5 ? 1 : 0,
      leanRadians: 0,
    }
  }
}

export const bossPose: {
  (zombie: Zombie): (boss: Boss) => Pose
  (boss: Boss, zombie: Zombie): Pose
} = Function.dual(2, (boss: Boss, zombie: Zombie): Pose =>
  Boss.isAnyOf(['Fighting'])(boss) && boss.id === zombie.id
    ? BossMove.match(boss.move, {
        Stalking: (): Pose => STANDING_POSE,
        WindingUp: ({ attack, remainingMs, durationMs }): Pose =>
          windUpPose(attack, remainingMs, durationMs),
        Bracing: ({ target, remainingMs, durationMs }): Pose => {
          const isStamping = Math.floor(remainingMs / BOSS_STAMP_MS) % 2 === 0
          return {
            scale: {
              x: 1 + (isStamping ? BOSS_STAMP_SQUASH : 0),
              y: 1 - (isStamping ? BOSS_STAMP_SQUASH : 0),
            },
            tone: tellTone(remainingMs, durationMs),
            isGaping: true,
            shakePx: isStamping ? 1 : 0,
            leanRadians: -BOSS_BRACE_LEAN * leanToward(zombie.x, target.x),
          }
        },
        Rushing: ({ direction }): Pose => ({
          scale: { x: 1 + BOSS_RUSH_STRETCH, y: 1 - BOSS_RUSH_STRETCH * 0.6 },
          tone: 'Normal',
          isGaping: true,
          shakePx: 1,
          leanRadians: BOSS_RUSH_LEAN * (direction.x < 0 ? -1 : 1),
        }),
        Dazed: ({ remainingMs }): Pose => ({
          scale: { x: 1, y: 1 },
          tone: 'Normal',
          isGaping: true,
          shakePx: 0,
          leanRadians:
            BOSS_DAZE_SWAY * Math.sin(remainingMs / BOSS_DAZE_SWAY_MS),
        }),
        Recovering: ({ remainingMs }): Pose => ({
          scale: {
            x: 1 + BOSS_LANDING_SQUASH * Math.min(1, remainingMs / 400),
            y: 1 - BOSS_LANDING_SQUASH * Math.min(1, remainingMs / 400),
          },
          tone: 'Normal',
          isGaping: false,
          shakePx: 0,
          leanRadians: 0,
        }),
      })
    : STANDING_POSE,
)
