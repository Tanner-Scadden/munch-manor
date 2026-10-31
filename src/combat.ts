import { Array, Option, Order, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { levelOf } from './arena'
import {
  LAST_HEART_INVULNERABLE_MS,
  MAX_BLASTS_PER_FRAME,
  PLAYER_INVULNERABLE_MS,
  PLAYER_KNOCKBACK_SPEED,
  PLAYER_RADIUS,
  ZOMBIE_HIT_PULSE_MS,
} from './constants'
import {
  OUTWARD,
  ZERO_VECTOR,
  circlesOverlap,
  directionBetween,
  normalize,
  scaleVector,
} from './geometry'
import { forEachSeatWhere, isStanding, payShared } from './party'
import { trapBlastTarget } from './traps'
import type { World } from './world'
import {
  type Bullet,
  GameEvent,
  Invulnerability,
  type Player,
  type Vector,
  type Zombie,
  ZombieAction,
  ZombieState,
} from './worldSchema'
import {
  Behavior,
  type DeathCause,
  bodyRadiusOf,
  deathState,
  isGrounded,
  statsOf,
} from './zombies'

// STRIKES

type Strike = Readonly<{
  damage: number
  direction: Vector
  knockbackSpeed: number
}>

// NOTE: a zombie Brain Freeze iced solid shatters at the next hit of any
// kind: it takes SHATTER_SCALE times the damage and the ice is gone.
export const SHATTER_SCALE = 3

const isIcedSolid = ZombieAction.isAnyOf(['Frozen'])

export const strikeZombie = (
  zombie: Zombie,
  { damage, direction, knockbackSpeed }: Strike,
  cause: DeathCause,
): Zombie => {
  const isIced = isIcedSolid(zombie.action)
  const hp = Math.max(0, zombie.hp - (isIced ? damage * SHATTER_SCALE : damage))
  return modifyFields(zombie, {
    hp: () => hp,
    knockback: () =>
      scaleVector(direction, knockbackSpeed * statsOf(zombie).knockbackScale),
    hitRemainingMs: () => ZOMBIE_HIT_PULSE_MS,
    state: state =>
      hp > 0 ? state : deathState(zombie.kind, direction, cause),
    action: action => (isIced ? ZombieAction.Roaming() : action),
  })
}

export const hitEvent = (
  zombie: Zombie,
  at: Vector,
  direction: Vector,
  damage: number,
  maybeShooter: Option.Option<number> = Option.none(),
): GameEvent =>
  GameEvent.ZombieHit({
    x: at.x,
    y: at.y,
    direction,
    damage,
    kind: zombie.kind,
    maybeShooter,
  })

export const killEvent = (zombie: Zombie, direction: Vector): GameEvent =>
  GameEvent.ZombieKilled({
    x: zombie.x,
    y: zombie.y,
    direction,
    bounty: statsOf(zombie).bounty,
    kind: zombie.kind,
  })

const invulnerableMsAt = (hp: number): number =>
  hp === 1 ? LAST_HEART_INVULNERABLE_MS : PLAYER_INVULNERABLE_MS

// NOTE: graceScale stretches the blink after the wound; a bite passes the
// level's (src/difficulty.ts), so Easy and Normal forgive a crowd's bites
// longer.
export const woundPlayer = (
  player: Player,
  damage: number,
  direction: Vector,
  graceScale = 1,
): Player => {
  const hp = Math.max(0, player.hp - damage)
  const durationMs = invulnerableMsAt(hp) * graceScale
  return modifyFields(player, {
    hp: () => hp,
    knockback: () => scaleVector(direction, PLAYER_KNOCKBACK_SPEED),
    invulnerability: () =>
      Invulnerability.Invulnerable({ remainingMs: durationMs, durationMs }),
  })
}

// BLASTS

export type BlastSpec = Readonly<{
  x: number
  y: number
  radius: number
  playerDamage: number
  zombieDamage: number
  trapDamage: number
  knockback: number
}>

type Blasted<A> = Readonly<{ target: A; events: ReadonlyArray<GameEvent> }>

export type BlastTarget<A> = Readonly<{
  center: (target: A) => Vector
  radius: (target: A) => number
  isExposed: (target: A) => boolean
  damageFrom: (blast: BlastSpec) => number
  hurt: (target: A, strike: Strike) => Blasted<A>
}>

// NOTE: the way a bullet flies, or none for a bullet that stands still.
export const bulletDirection = (bullet: Bullet): Vector =>
  Option.getOrElse(
    normalize({ x: bullet.velocityX, y: bullet.velocityY }),
    () => ZERO_VECTOR,
  )

const blastOne =
  <A>(blast: BlastSpec, kind: BlastTarget<A>) =>
  (target: A): Blasted<A> => {
    const center = kind.center(target)
    if (
      !kind.isExposed(target) ||
      !circlesOverlap(blast, blast.radius, center, kind.radius(target))
    ) {
      return { target, events: [] }
    }

    return kind.hurt(target, {
      damage: kind.damageFrom(blast),
      direction: Option.getOrElse(
        directionBetween(blast, center),
        () => OUTWARD,
      ),
      knockbackSpeed: blast.knockback,
    })
  }

export const blastAll = <A>(
  blast: BlastSpec,
  targets: ReadonlyArray<A>,
  kind: BlastTarget<A>,
): Readonly<{
  targets: ReadonlyArray<A>
  events: ReadonlyArray<GameEvent>
}> => {
  const outcomes = Array.map(targets, blastOne(blast, kind))
  return {
    targets: Array.map(outcomes, ({ target }) => target),
    events: Array.flatMap(outcomes, ({ events }) => events),
  }
}

export const ZOMBIE_BLAST_TARGET: BlastTarget<Zombie> = {
  center: zombie => zombie,
  radius: bodyRadiusOf,
  isExposed: isGrounded,
  damageFrom: ({ zombieDamage }) => zombieDamage,
  hurt: (zombie, blastStrike) => {
    const strike = Behavior.isAnyOf(['Bomber'])(statsOf(zombie).behavior)
      ? { ...blastStrike, damage: Math.max(blastStrike.damage, zombie.hp) }
      : blastStrike
    const struck = strikeZombie(zombie, strike, 'Blast')
    return {
      target: struck,
      events: [
        hitEvent(zombie, zombie, strike.direction, strike.damage),
        ...(struck.hp <= 0 ? [killEvent(struck, strike.direction)] : []),
      ],
    }
  },
}

// NOTE: only an Exploder's blast reaches the player, so its hurt names the
// Exploder as the source.
const PLAYER_BLAST_TARGET: BlastTarget<Player> = {
  center: player => player,
  radius: () => PLAYER_RADIUS,
  isExposed: player =>
    Invulnerability.isAnyOf(['Vulnerable'])(player.invulnerability),
  damageFrom: ({ playerDamage }) => playerDamage,
  hurt: (player, { damage, direction }) => ({
    target: woundPlayer(player, damage, direction),
    events: [
      GameEvent.PlayerHurt({
        x: player.x,
        y: player.y,
        direction,
        source: 'Exploder',
      }),
    ],
  }),
}

// NOTE: a blast on every standing player it reaches.
export const blastPlayers = (model: World, blast: BlastSpec): World =>
  forEachSeatWhere(model, isStanding, seatWorld => {
    const playerOutcome = blastOne(blast, PLAYER_BLAST_TARGET)(seatWorld.player)
    return modifyFields(seatWorld, {
      player: () => playerOutcome.target,
      frameEvents: frameEvents => [...frameEvents, ...playerOutcome.events],
    })
  })

const maybeBlastOf = (zombie: Zombie): Option.Option<BlastSpec> =>
  Behavior.match(statsOf(zombie).behavior, {
    Brawler: () => Option.none(),
    Bomber: ({
      blastRadius,
      playerDamage,
      zombieDamage,
      trapDamage,
      blastKnockback,
    }) =>
      Option.some({
        x: zombie.x,
        y: zombie.y,
        radius: blastRadius,
        playerDamage,
        zombieDamage,
        trapDamage,
        knockback: blastKnockback,
      }),
    Thrower: () => Option.none(),
    Crawler: () => Option.none(),
  })

export const bountyOf = (events: ReadonlyArray<GameEvent>): number =>
  Array.reduce(events, 0, (sum, event) =>
    GameEvent.isAnyOf(['ZombieKilled'])(event) ? sum + event.bounty : sum,
  )

const detonate = (model: World, bomberId: number): World => {
  const rest = Array.filter(model.zombies, ({ id }) => id !== bomberId)
  const maybeBlast = pipe(
    model.zombies,
    Array.findFirst(({ id }) => id === bomberId),
    Option.flatMap(maybeBlastOf),
  )
  return Option.match(maybeBlast, {
    onNone: () => modifyFields(model, { zombies: () => rest }),
    onSome: blast => {
      const zombieOutcome = blastAll(blast, rest, ZOMBIE_BLAST_TARGET)
      const trapOutcome = blastAll(
        blast,
        model.traps,
        trapBlastTarget(levelOf(model)),
      )
      const scorched = blastPlayers(
        modifyFields(model, {
          frameEvents: Array.append(
            GameEvent.Exploded({
              x: blast.x,
              y: blast.y,
              radius: blast.radius,
            }),
          ),
        }),
        blast,
      )
      return payShared(
        modifyFields(scorched, {
          zombies: () => zombieOutcome.targets,
          traps: () => trapOutcome.targets,
          frameEvents: frameEvents => [
            ...frameEvents,
            ...zombieOutcome.events,
            ...trapOutcome.events,
          ],
        }),
        bountyOf(zombieOutcome.events),
      )
    },
  })
}

type SpentFuse = Readonly<{ id: number; remainingMs: number }>

const maybeSpentFuse = (zombie: Zombie): Option.Option<SpentFuse> =>
  ZombieState.match(zombie.state, {
    Walking: () => Option.none(),
    Fusing: ({ remainingMs }) =>
      remainingMs <= 0
        ? Option.some({ id: zombie.id, remainingMs })
        : Option.none(),
    Dying: () => Option.none(),
  })

const byOverdue = Order.combine(
  Order.mapInput(Order.Number, ({ remainingMs }: SpentFuse) => remainingMs),
  Order.mapInput(Order.Number, ({ id }: SpentFuse) => id),
)

export const resolveBlasts = (model: World): World =>
  pipe(
    model.zombies,
    Array.map(maybeSpentFuse),
    Array.getSomes,
    Array.sort(byOverdue),
    Array.take(MAX_BLASTS_PER_FRAME),
    Array.reduce(model, (current, { id }) => detonate(current, id)),
  )
