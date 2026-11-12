import { Array, Function, Result } from 'effect'
import { Canvas } from 'foldkit'

import {
  SHADOW_COLOR,
  SHADOW_FADED_COLOR,
  SHADOW_FADE_START,
  SHADOW_HIDE_START,
  ZOMBIE_FOOT_OFFSET,
} from '../shared/constants'
import {
  type Vector,
  type Zombie,
  ZombieAction,
  ZombieState,
} from '../world/schema/entitySchema'
import { clamp } from '../world/step/geometry'
import { CHUCKER_RULES } from '../world/zombies/chucker'
import { surfacingProgress } from '../world/zombies/crawler'
import { Behavior, statsOf } from '../world/zombies/zombies'
import { footShadow, tellAlpha } from './drawing'

// DEPTH AND SHADOW

const CARRIED_DEPTH_PX = 2
const FLYING_DEPTH_PX = 1000

// NOTE: a Groaner held overhead draws just after its Big Leaguer, and one in the
// air draws after everything standing, since it flies over their heads.
export const zombieFootY = (zombie: Zombie): number =>
  zombie.y +
  statsOf(zombie).footOffset +
  ZombieAction.match(zombie.action, {
    Roaming: () => 0,
    Winded: () => 0,
    Hefting: () => 0,
    Carried: () => CARRIED_DEPTH_PX,
    Flying: () => FLYING_DEPTH_PX,
    Dazed: () => 0,
    Shielding: () => 0,
    Shielded: () => 0,
    Burrowed: () => 0,
    Clinging: () => 0,
    Frozen: () => 0,
    Chilled: () => 0,
    Reeling: () => 0,
  })

const zombieFootShadow = (zombie: Zombie, fill: string): Canvas.Shape => {
  const stats = statsOf(zombie)
  return footShadow(
    zombie,
    stats.footOffset,
    Math.round(stats.radius * 2),
    fill,
  )
}

const hasShadow = ZombieAction.isAnyOf([
  'Roaming',
  'Shielding',
  'Winded',
  'Hefting',
  'Flying',
  'Dazed',
  'Clinging',
  'Frozen',
  'Chilled',
  'Reeling',
])

export const zombieShadow = (
  zombie: Zombie,
): Result.Result<Canvas.Shape, void> =>
  ZombieState.match(zombie.state, {
    Walking: (): Result.Result<Canvas.Shape, void> =>
      hasShadow(zombie.action)
        ? Result.succeed(zombieFootShadow(zombie, SHADOW_COLOR))
        : Result.failVoid,
    Fusing: (): Result.Result<Canvas.Shape, void> =>
      Result.succeed(zombieFootShadow(zombie, SHADOW_COLOR)),
    Dying: ({ remainingMs }): Result.Result<Canvas.Shape, void> => {
      const progress = 1 - remainingMs / Math.max(1, statsOf(zombie).dyingMs)
      if (progress < SHADOW_FADE_START) {
        return Result.succeed(zombieFootShadow(zombie, SHADOW_COLOR))
      } else if (progress < SHADOW_HIDE_START) {
        return Result.succeed(zombieFootShadow(zombie, SHADOW_FADED_COLOR))
      } else {
        return Result.failVoid
      }
    },
  })

// FLOOR TELLS

const TELL_EDGE_COLOR = '#ff4a4f'
const TELL_SWEEP_COLOR = '#ffe066'

const tellFill = (progress: number): string =>
  `rgba(255, 58, 63, ${tellAlpha(0.1, 0.3, progress)})`

const tellRingShapes = (
  at: Vector,
  radius: number,
  progress: number,
): ReadonlyArray<Canvas.Shape> => {
  const x = Math.round(at.x)
  const y = Math.round(at.y)
  return [
    Canvas.Circle({
      x,
      y,
      radius,
      fill: tellFill(progress),
      stroke: TELL_EDGE_COLOR,
      lineWidth: 1,
    }),
    Canvas.Circle({
      x,
      y,
      radius: Math.max(1, Math.round(radius * progress)),
      stroke: TELL_SWEEP_COLOR,
      lineWidth: 1,
    }),
  ]
}

const blastRadiusOf = (zombie: Zombie): number =>
  Behavior.match(statsOf(zombie).behavior, {
    Brawler: () => 0,
    Bomber: ({ blastRadius }) => blastRadius,
    Thrower: () => 0,
    Crawler: () => 0,
  })

const fuseLengthOf = (zombie: Zombie): number =>
  Behavior.match(statsOf(zombie).behavior, {
    Brawler: () => 1,
    Bomber: ({ contactFuseMs }) => contactFuseMs,
    Thrower: () => 1,
    Crawler: () => 1,
  })

const fuseRingShapes = (
  zombie: Zombie,
  remainingMs: number,
): ReadonlyArray<Canvas.Shape> => {
  const radius = blastRadiusOf(zombie)
  return radius > 0
    ? tellRingShapes(
        zombie,
        radius,
        clamp(1 - remainingMs / Math.max(1, fuseLengthOf(zombie)), 0, 1),
      )
    : []
}

const landingShapes = (zombie: Zombie): ReadonlyArray<Canvas.Shape> => {
  if (!ZombieAction.isAnyOf(['Flying'])(zombie.action)) {
    return []
  }
  const { to, remainingMs, durationMs } = zombie.action
  return tellRingShapes(
    { x: to.x, y: to.y + ZOMBIE_FOOT_OFFSET },
    CHUCKER_RULES.landRadius,
    clamp(1 - remainingMs / Math.max(1, durationMs), 0, 1),
  )
}

const CRACK_COLOR = '#f0c27a'
const HOLE_COLOR = '#140c10'
const CLAW_COLOR = '#dcf5b8'
const CRACK_RING_COLOR = 'rgba(240, 194, 122, 0.55)'
const CRACK_DUST_COLOR = 'rgba(214, 196, 160, 0.8)'
const CRACK_JUMP_MS = 90
const CRACK_RING_MIN_PX = 3
const CRACK_RING_GROW_PX = 8

type Crack = Readonly<{ dx: number; dy: number; length: number }>

const CRACKS: ReadonlyArray<Crack> = [
  { dx: 1, dy: 0, length: 7 },
  { dx: -1, dy: 0, length: 6 },
  { dx: 0, dy: 1, length: 3 },
  { dx: 0, dy: -1, length: 4 },
]

// NOTE: the floor tells where an Ankle Biter is coming up: a ring of dust
// spreads, pale cracks split the boards, a hole opens, and a leg pokes
// through just before the spider climbs out over its middle.
const crackShapes = (
  zombie: Zombie,
  elapsedMs: number,
): ReadonlyArray<Canvas.Shape> => {
  const progress = surfacingProgress(zombie)
  const x = Math.round(zombie.x)
  const y = Math.round(zombie.y)
  const jump = Math.floor((elapsedMs + zombie.id * 53) / CRACK_JUMP_MS) % 2
  const ring = Canvas.Circle({
    x,
    y,
    radius: CRACK_RING_MIN_PX + Math.round(CRACK_RING_GROW_PX * progress),
    stroke: CRACK_RING_COLOR,
    lineWidth: 1,
  })
  const cracks = Array.map(CRACKS, ({ dx, dy, length }) => {
    const reach = Math.max(1, Math.round(length * Math.min(1, progress * 1.4)))
    return Canvas.Rect({
      x: dx < 0 ? x - reach : x + (dx > 0 ? 1 : 0),
      y: dy < 0 ? y - reach : y + (dy > 0 ? 1 : 0),
      width: dx === 0 ? 1 : reach,
      height: dy === 0 ? 1 : reach,
      fill: CRACK_COLOR,
    })
  })
  const hole =
    progress > 0.4
      ? [
          Canvas.Rect({
            x: x - 2,
            y: y - 1,
            width: progress > 0.7 ? 5 : 3,
            height: progress > 0.7 ? 3 : 2,
            fill: HOLE_COLOR,
          }),
        ]
      : []
  const claw =
    progress > 0.8 && jump === 0
      ? [Canvas.Rect({ x, y: y - 2, width: 1, height: 2, fill: CLAW_COLOR })]
      : []
  const dust =
    progress > 0.2
      ? [
          Canvas.Rect({
            x: x - 4 + jump * 7,
            y: y - 2 - Math.round(progress * 4),
            width: 2,
            height: 1,
            fill: CRACK_DUST_COLOR,
          }),
        ]
      : []
  return [ring, ...cracks, ...hole, ...claw, ...dust]
}

const groundTellShapes =
  (elapsedMs: number) =>
  (zombie: Zombie): ReadonlyArray<Canvas.Shape> =>
    ZombieState.match(zombie.state, {
      Walking: () =>
        ZombieAction.isAnyOf(['Burrowed'])(zombie.action)
          ? crackShapes(zombie, elapsedMs)
          : landingShapes(zombie),
      Fusing: ({ remainingMs }) => fuseRingShapes(zombie, remainingMs),
      Dying: () => [],
    })

export const zombieGroundShapes: {
  (
    elapsedMs: number,
  ): (zombies: ReadonlyArray<Zombie>) => ReadonlyArray<Canvas.Shape>
  (
    zombies: ReadonlyArray<Zombie>,
    elapsedMs: number,
  ): ReadonlyArray<Canvas.Shape>
} = Function.dual(
  2,
  (
    zombies: ReadonlyArray<Zombie>,
    elapsedMs: number,
  ): ReadonlyArray<Canvas.Shape> =>
    Array.flatMap(zombies, groundTellShapes(elapsedMs)),
)
