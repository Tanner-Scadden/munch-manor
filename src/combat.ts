import { Array, Function, Option, Order, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { type Level, levelOf } from './arena'
import { woundGraceScaleOf } from './calling'
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
import { kitchenBounty } from './kitchenPay'
import {
  atSeat,
  forEachSeatWhere,
  isStanding,
  payKillShared,
  seatStateAt,
} from './party'
import { trapBlastTarget } from './traps'
import type { World } from './world'
import {
  type Bullet,
  GameEvent,
  Invulnerability,
  type Player,
  type PlayerSlot,
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
// kind: it takes SHATTER_SCALE times the damage and the ice is gone. Only
// Brain Freeze freezes (src/fridgeWeapons.ts).
export const SHATTER_SCALE = 4

export const isIcedSolid = ZombieAction.isAnyOf(['Frozen'])

export const strikeZombie: {
  (arg1: Strike, cause: DeathCause): (zombie: Zombie) => Zombie
  (zombie: Zombie, arg1: Strike, cause: DeathCause): Zombie
} = Function.dual(
  3,
  (
    zombie: Zombie,
    { damage, direction, knockbackSpeed }: Strike,
    cause: DeathCause,
  ): Zombie => {
    const isIced = isIcedSolid(zombie.action)
    const hp = Math.max(
      0,
      zombie.hp - (isIced ? damage * SHATTER_SCALE : damage),
    )
    return modifyFields(zombie, {
      hp: () => hp,
      knockback: () =>
        scaleVector(direction, knockbackSpeed * statsOf(zombie).knockbackScale),
      hitRemainingMs: () => ZOMBIE_HIT_PULSE_MS,
      state: state =>
        hp > 0 ? state : deathState(zombie.kind, direction, cause),
      action: action => (isIced ? ZombieAction.Roaming() : action),
    })
  },
)

export const hitEvent: {
  (
    at: Vector,
    direction: Vector,
    damage: number,
    maybeShooter?: Option.Option<number>,
  ): (zombie: Zombie) => GameEvent
  (
    zombie: Zombie,
    at: Vector,
    direction: Vector,
    damage: number,
    maybeShooter?: Option.Option<number>,
  ): GameEvent
} = Function.dual(
  // NOTE: data-first has the damage fourth; data-last has the shooter there or nothing.
  (args: IArguments): boolean => typeof args[3] === 'number',
  (
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
    }),
)

export const killEvent: {
  (direction: Vector): (zombie: Zombie) => GameEvent
  (zombie: Zombie, direction: Vector): GameEvent
} = Function.dual(2, (zombie: Zombie, direction: Vector): GameEvent =>
  GameEvent.ZombieKilled({
    x: zombie.x,
    y: zombie.y,
    direction,
    bounty: statsOf(zombie).bounty,
    kind: zombie.kind,
  }),
)

const invulnerableMsAt = (hp: number): number =>
  hp === 1 ? LAST_HEART_INVULNERABLE_MS : PLAYER_INVULNERABLE_MS

// NOTE: graceScale stretches the blink after the wound; a bite passes the
// level's (src/difficulty.ts), so Easy and Normal forgive a crowd's bites
// longer.
export const woundPlayer: {
  (
    damage: number,
    direction: Vector,
    graceScale?: number,
  ): (player: Player) => Player
  (
    player: Player,
    damage: number,
    direction: Vector,
    graceScale?: number,
  ): Player
} = Function.dual(
  // NOTE: data-first has the damage second; data-last has the direction there.
  (args: IArguments): boolean => typeof args[1] === 'number',
  (
    player: Player,
    damage: number,
    direction: Vector,
    graceScale: number = 1,
  ): Player => {
    const hp = Math.max(0, player.hp - damage)
    const durationMs =
      invulnerableMsAt(hp) * graceScale * woundGraceScaleOf(player)
    return modifyFields(player, {
      hp: () => hp,
      knockback: () => scaleVector(direction, PLAYER_KNOCKBACK_SPEED),
      invulnerability: () =>
        Invulnerability.Invulnerable({ remainingMs: durationMs, durationMs }),
    })
  },
)

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

// NOTE: an interface, not a Readonly alias, so the checker can match
// blastAll's two call signatures over its type parameter.
export interface BlastTarget<A> {
  readonly center: (target: A) => Vector
  readonly radius: (target: A) => number
  readonly isExposed: (target: A) => boolean
  readonly damageFrom: (blast: BlastSpec) => number
  readonly hurt: (target: A, strike: Strike) => Blasted<A>
}

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

type BlastedAll<A> = Readonly<{
  targets: ReadonlyArray<A>
  events: ReadonlyArray<GameEvent>
}>

export const blastAll: {
  <A>(
    targets: ReadonlyArray<A>,
    kind: BlastTarget<A>,
  ): (blast: BlastSpec) => BlastedAll<A>
  <A>(
    blast: BlastSpec,
    targets: ReadonlyArray<A>,
    kind: BlastTarget<A>,
  ): BlastedAll<A>
} = Function.dual(
  3,
  <A>(
    blast: BlastSpec,
    targets: ReadonlyArray<A>,
    kind: BlastTarget<A>,
  ): BlastedAll<A> => {
    const outcomes = Array.map(targets, blastOne(blast, kind))
    return {
      targets: Array.map(outcomes, ({ target }) => target),
      events: Array.flatMap(outcomes, ({ events }) => events),
    }
  },
)

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
const blastSeated = (
  model: World,
  slot: PlayerSlot,
  blast: BlastSpec,
): World => {
  const playerOutcome = blastOne(
    blast,
    PLAYER_BLAST_TARGET,
  )(seatStateAt(model, slot).player)
  return modifyFields(model, {
    seats: atSeat(slot, { player: () => playerOutcome.target }),
    frameEvents: frameEvents => [...frameEvents, ...playerOutcome.events],
  })
}

const blastPlayers = (model: World, blast: BlastSpec): World =>
  forEachSeatWhere(model, isStanding, (current, slot) =>
    blastSeated(current, slot, blast),
  )

// NOTE: a player's own blast on every standing teammate it reaches, never
// on the player who set it off (the owner, 2026-11-02: "it sucks that it
// hurts you").
export const blastTeammates: {
  (thrower: PlayerSlot, blast: BlastSpec): (model: World) => World
  (model: World, thrower: PlayerSlot, blast: BlastSpec): World
} = Function.dual(
  3,
  (model: World, thrower: PlayerSlot, blast: BlastSpec): World =>
    forEachSeatWhere(model, isStanding, (current, slot) =>
      slot === thrower ? current : blastSeated(current, slot, blast),
    ),
)

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

// NOTE: what the kills among `events` pay, a kitchen kill a quarter more
// (src/kitchenPay.ts).
export const bountyOf: {
  (events: ReadonlyArray<GameEvent>): (level: Level) => number
  (level: Level, events: ReadonlyArray<GameEvent>): number
} = Function.dual(2, (level: Level, events: ReadonlyArray<GameEvent>): number =>
  Array.reduce(events, 0, (sum, event) =>
    GameEvent.isAnyOf(['ZombieKilled'])(event)
      ? sum + kitchenBounty(level, event, event.bounty)
      : sum,
  ),
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
      return payKillShared(
        modifyFields(scorched, {
          zombies: () => zombieOutcome.targets,
          traps: () => trapOutcome.targets,
          frameEvents: frameEvents => [
            ...frameEvents,
            ...zombieOutcome.events,
            ...trapOutcome.events,
          ],
        }),
        bountyOf(levelOf(model), zombieOutcome.events),
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
