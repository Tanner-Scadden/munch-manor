// The boss fight's shared steps: changing the fight, his move, his events,
// hurting a player, and the plates he throws in flight and pooled. The
// fight itself is src/world/zombies/boss.ts.

import { Array, Function, Option, Result, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { PLAYER_RADIUS } from '../../shared/constants'
import { atSeat, seatStateAt } from '../party/party'
import { bossAttackPace } from '../run/difficulty'
import type { World } from '../schema/world'
import {
  Boss,
  BossMove,
  GameEvent,
  Glob,
  Invulnerability,
  type PlayerSlot,
  type Vector,
  type Zombie,
} from '../schema/worldSchema'
import { woundPlayer } from '../step/combat'
import {
  OUTWARD,
  directionBetween,
  distanceBetween,
  scaleVector,
} from '../step/geometry'
import { BOSS_RULES } from './bossRules'

// FIGHT

export type Fight = typeof Boss.Fighting.Type

export const modifyFight: {
  (change: (fight: Fight) => Fight): (model: World) => World
  (model: World, change: (fight: Fight) => Fight): World
} = Function.dual(2, (model: World, change: (fight: Fight) => Fight): World =>
  modifyFields(model, {
    boss: boss => (Boss.isAnyOf(['Fighting'])(boss) ? change(boss) : boss),
  }),
)

export const setMove: {
  (move: BossMove): (model: World) => World
  (model: World, move: BossMove): World
} = Function.dual(2, (model: World, move: BossMove): World =>
  modifyFight(model, fight => modifyFields(fight, { move: () => move })),
)

export const emit =
  (event: GameEvent) =>
  (model: World): World =>
    modifyFields(model, { frameEvents: Array.append(event) })

export const isEnraged = (boss: Boss): boolean =>
  Boss.isAnyOf(['Fighting'])(boss) && boss.mood === 'Enraged'

// NOTE: the gap between attacks, never a tell's wind-up: rage and the
// difficulty's pace both shorten how long he rests, so a faster boss gives
// the same warning for each attack and less time between them.
export const gapScale: {
  (fight: Fight): (model: World) => number
  (model: World, fight: Fight): number
} = Function.dual(
  2,
  (model: World, fight: Fight): number =>
    (fight.mood === 'Enraged' ? BOSS_RULES.enrageGapScale : 1) *
    bossAttackPace(model.difficulty.chosen),
)

export const isRooted: {
  (zombie: Zombie): (boss: Boss) => boolean
  (boss: Boss, zombie: Zombie): boolean
} = Function.dual(
  2,
  (boss: Boss, zombie: Zombie): boolean =>
    Boss.isAnyOf(['Fighting'])(boss) &&
    boss.id === zombie.id &&
    !BossMove.isAnyOf(['Stalking'])(boss.move),
)

export const woundScaleOf: {
  (zombie: Zombie): (boss: Boss) => number
  (boss: Boss, zombie: Zombie): number
} = Function.dual(2, (boss: Boss, zombie: Zombie): number =>
  Boss.isAnyOf(['Fighting'])(boss) &&
  boss.id === zombie.id &&
  BossMove.isAnyOf(['Dazed'])(boss.move)
    ? BOSS_RULES.dazedWoundScale
    : 1,
)

export const paceOf: {
  (zombie: Zombie, player: Vector): (boss: Boss) => number
  (boss: Boss, zombie: Zombie, player: Vector): number
} = Function.dual(3, (boss: Boss, zombie: Zombie, player: Vector): number => {
  if (!Boss.isAnyOf(['Fighting'])(boss) || boss.id !== zombie.id) {
    return 1
  }

  const rage = boss.mood === 'Enraged' ? BOSS_RULES.enrageSpeedScale : 1
  const chase =
    Math.hypot(player.x - zombie.x, player.y - zombie.y) > BOSS_RULES.farPx
      ? BOSS_RULES.farPace
      : 1
  return rage * chase
})

export const awayFrom: {
  (to: Vector): (from: Vector) => Vector
  (from: Vector, to: Vector): Vector
} = Function.dual(2, (from: Vector, to: Vector): Vector =>
  Option.getOrElse(directionBetween(from, to), () => OUTWARD),
)

export const isVulnerable: {
  (slot: PlayerSlot): (model: World) => boolean
  (model: World, slot: PlayerSlot): boolean
} = Function.dual(2, (model: World, slot: PlayerSlot): boolean =>
  Invulnerability.isAnyOf(['Vulnerable'])(
    seatStateAt(model, slot).player.invulnerability,
  ),
)

// NOTE: hurting a player by the boss's hand: the wound, its knockback
// scaled, and the PlayerHurt event.
const hurt = (
  model: World,
  slot: PlayerSlot,
  damage: number,
  direction: Vector,
  knockbackScale: number,
): World => {
  const { player } = seatStateAt(model, slot)
  const wounded = woundPlayer(player, damage, direction)
  return modifyFields(model, {
    seats: atSeat(slot, {
      player: () =>
        modifyFields(wounded, {
          knockback: knockback => scaleVector(knockback, knockbackScale),
        }),
    }),
    frameEvents: Array.append(
      GameEvent.PlayerHurt({
        x: player.x,
        y: player.y,
        direction,
        source: 'Boss',
      }),
    ),
  })
}

export const hurtPlayer: {
  (
    slot: PlayerSlot,
    damage: number,
    direction: Vector,
    knockbackScale: number,
  ): (model: World) => World
  (
    model: World,
    slot: PlayerSlot,
    damage: number,
    direction: Vector,
    knockbackScale: number,
  ): World
} = Function.dual(5, hurt)

// GLOBS

const isFlying = Glob.isAnyOf(['Flying'])

export const isGlobInFlight = (fight: Fight): boolean =>
  Array.some(fight.globs, isFlying)

const tickGlob =
  (deltaMs: number) =>
  (glob: Glob): Option.Option<Glob> =>
    Glob.match(glob, {
      Flying: ({ from, to, remainingMs, durationMs }) =>
        Option.some(
          remainingMs > deltaMs
            ? Glob.Flying({
                from,
                to,
                remainingMs: remainingMs - deltaMs,
                durationMs,
              })
            : Glob.Pooled({
                at: to,
                remainingMs: BOSS_RULES.puddleMs,
                durationMs: BOSS_RULES.puddleMs,
              }),
        ),
      Pooled: ({ at, remainingMs, durationMs }) =>
        remainingMs > deltaMs
          ? Option.some(
              Glob.Pooled({
                at,
                remainingMs: remainingMs - deltaMs,
                durationMs,
              }),
            )
          : Option.none(),
    })

const isLanding =
  (deltaMs: number) =>
  (glob: Glob): boolean =>
    isFlying(glob) && glob.remainingMs <= deltaMs

const landGlob = (model: World, slot: PlayerSlot, at: Vector): World => {
  const splashed = emit(
    GameEvent.GlobLanded({ x: at.x, y: at.y, radius: BOSS_RULES.spitRadius }),
  )(model)
  return isVulnerable(splashed, slot) &&
    distanceBetween(at, seatStateAt(splashed, slot).player) <=
      BOSS_RULES.spitRadius + PLAYER_RADIUS
    ? hurt(
        splashed,
        slot,
        BOSS_RULES.spitDamage,
        awayFrom(at, seatStateAt(splashed, slot).player),
        1,
      )
    : splashed
}

const globsAdvanced = (
  model: World,
  slot: PlayerSlot,
  fight: Fight,
  deltaMs: number,
): World => {
  const landed = pipe(
    fight.globs,
    Array.filter(isLanding(deltaMs)),
    Array.filterMap(glob =>
      isFlying(glob) ? Result.succeed(glob.to) : Result.failVoid,
    ),
  )
  return Array.reduce(
    landed,
    modifyFight(model, current =>
      modifyFields(current, {
        globs: globs =>
          pipe(
            globs,
            Array.filterMap(glob =>
              Result.fromOption(tickGlob(deltaMs)(glob), () => undefined),
            ),
            Array.takeRight(BOSS_RULES.globMax),
          ),
      }),
    ),
    (current, at) => landGlob(current, slot, at),
  )
}

export const puddleSlowAt: {
  (at: Vector): (boss: Boss) => number
  (boss: Boss, at: Vector): number
} = Function.dual(2, (boss: Boss, at: Vector): number =>
  Boss.isAnyOf(['Fighting'])(boss) &&
  Array.some(
    boss.globs,
    glob =>
      Glob.isAnyOf(['Pooled'])(glob) &&
      distanceBetween(glob.at, at) <= BOSS_RULES.puddleRadius,
  )
    ? BOSS_RULES.puddleSlow
    : 1,
)

export const advanceGlobs: {
  (slot: PlayerSlot, fight: Fight, deltaMs: number): (model: World) => World
  (model: World, slot: PlayerSlot, fight: Fight, deltaMs: number): World
} = Function.dual(4, globsAdvanced)
