import { Array, Option, Result, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { woundScaleOf } from './boss'
import { maybeShieldFor } from './chucker'
import {
  bulletDirection,
  hitEvent,
  killEvent,
  strikeZombie,
  woundPlayer,
} from './combat'
import {
  BULLET_RADIUS,
  FIXED_STEP_MS,
  PLAYER_RADIUS,
  ZOMBIE_BUMP_SPEED,
} from './constants'
import { biteDamage, biteGraceScale } from './difficulty'
import {
  ZERO_VECTOR,
  circlesOverlap,
  closestPointOnSegment,
  directionBetween,
  scaleVector,
} from './geometry'
import {
  creditKills,
  creditShots,
  isCoop,
  leadSeatOf,
  maybePlayerAt,
  maybeShooterOf,
  modifyLeadSeat,
  payTo,
} from './party'
import { resolveFriendlyFire } from './revive'
import { earn } from './shop'
import { countHits } from './stats'
import { TURRET_WEAPON } from './traps'
import type { World } from './world'
import {
  type Boss,
  type Bullet,
  GameEvent,
  Invulnerability,
  Pierce,
  type Player,
  type Vector,
  type WeaponKind,
  type Zombie,
  ZombieState,
} from './worldSchema'
import { Behavior, bodyRadiusOf, isFree, isGrounded, statsOf } from './zombies'

type BulletHit = Readonly<{
  bulletId: number
  zombieId: number
  x: number
  y: number
  direction: Vector
  weapon: WeaponKind
  damage: number
  knockback: number
  maybeShooter: Option.Option<number>
}>

type Contact = Readonly<{ zombie: Zombie; point: Vector; reach: number }>

const maybeContact = (
  from: Vector,
  to: Vector,
  zombie: Zombie,
): Option.Option<Contact> => {
  const point = closestPointOnSegment(zombie, from, to)
  return circlesOverlap(point, BULLET_RADIUS, zombie, bodyRadiusOf(zombie))
    ? Option.some({
        zombie,
        point,
        reach: Math.hypot(point.x - from.x, point.y - from.y),
      })
    : Option.none()
}

const nearerContact = (
  nearest: Option.Option<Contact>,
  contact: Contact,
): Option.Option<Contact> =>
  Option.match(nearest, {
    onNone: () => Option.some(contact),
    onSome: current =>
      contact.reach < current.reach ? Option.some(contact) : nearest,
  })

const struckBy = (bullet: Bullet): ReadonlyArray<number> =>
  Pierce.match(bullet.pierce, {
    Stops: () => [],
    Skewers: ({ struck }) => struck,
  })

const targetsFor = (
  bullet: Bullet,
  targets: ReadonlyArray<Zombie>,
): ReadonlyArray<Zombie> => {
  const struck = struckBy(bullet)
  return Array.isReadonlyArrayEmpty(struck)
    ? targets
    : Array.filter(targets, ({ id }) => !Array.contains(struck, id))
}

const shieldedTarget = (bullet: Bullet, zombie: Zombie): number =>
  Pierce.isAnyOf(['Stops'])(bullet.pierce)
    ? Option.getOrElse(
        maybeShieldFor(zombie, bulletDirection(bullet)),
        () => zombie.id,
      )
    : zombie.id

// NOTE: the player's shots fired this frame. Their sweep starts at the
// player's center, not the muzzle, so a zombie hugging the player, closer than
// the muzzle, is still the first thing a point-blank shot hits.
type FreshShots = Readonly<{
  firstId: number
  endId: number
  from: (bullet: Bullet) => Vector
}>

const sweepStart = (
  bullet: Bullet,
  seconds: number,
  freshShots: FreshShots,
): Vector =>
  bullet.id >= freshShots.firstId && bullet.id < freshShots.endId
    ? freshShots.from(bullet)
    : {
        x: bullet.x - bullet.velocityX * seconds,
        y: bullet.y - bullet.velocityY * seconds,
      }

const findBulletHits = (
  bullets: ReadonlyArray<Bullet>,
  zombies: ReadonlyArray<Zombie>,
  boss: Boss,
  seconds: number,
  freshShots: FreshShots,
): ReadonlyArray<BulletHit> => {
  const targets = Array.filter(zombies, isGrounded)
  return Array.getSomes(
    Array.map(bullets, bullet => {
      const from = sweepStart(bullet, seconds, freshShots)
      return pipe(
        targetsFor(bullet, targets),
        Array.map(zombie => maybeContact(from, bullet, zombie)),
        Array.getSomes,
        Array.reduce(Option.none<Contact>(), nearerContact),
        Option.map(({ zombie, point }) => ({
          bulletId: bullet.id,
          zombieId: shieldedTarget(bullet, zombie),
          x: point.x,
          y: point.y,
          direction: bulletDirection(bullet),
          weapon: bullet.weapon,
          damage: bullet.damage * woundScaleOf(boss, zombie),
          knockback: bullet.knockback,
          maybeShooter: maybeShooterOf(bullet),
        })),
      )
    }),
  )
}

const totalDamage = (hits: ReadonlyArray<BulletHit>): number =>
  Array.reduce(hits, 0, (sum, hit) => sum + hit.damage)

const strongestKnockback = (hits: ReadonlyArray<BulletHit>): number =>
  Array.reduce(hits, 0, (strongest, hit) => Math.max(strongest, hit.knockback))

const hitsOn = (
  hits: ReadonlyArray<BulletHit>,
  zombieId: number,
): ReadonlyArray<BulletHit> =>
  Array.filter(hits, hit => hit.zombieId === zombieId)

const applyHits =
  (hits: ReadonlyArray<BulletHit>) =>
  (zombie: Zombie): Zombie => {
    const zombieHits = hitsOn(hits, zombie.id)
    return Option.match(Array.last(zombieHits), {
      onNone: () => zombie,
      onSome: lastHit =>
        strikeZombie(
          zombie,
          {
            damage: totalDamage(zombieHits),
            direction: lastHit.direction,
            knockbackSpeed: strongestKnockback(zombieHits),
          },
          'Shot',
        ),
    })
  }

const hitEventOn =
  (hits: ReadonlyArray<BulletHit>) =>
  (zombie: Zombie): Option.Option<GameEvent> => {
    const zombieHits = hitsOn(hits, zombie.id)
    return Option.map(
      Array.last(zombieHits),
      ({ x, y, direction, maybeShooter }) =>
        hitEvent(
          zombie,
          { x, y },
          direction,
          totalDamage(zombieHits),
          maybeShooter,
        ),
    )
  }

const killEventOn =
  (hits: ReadonlyArray<BulletHit>) =>
  (zombie: Zombie): GameEvent =>
    killEvent(
      zombie,
      Option.match(Array.last(hitsOn(hits, zombie.id)), {
        onNone: () => ZERO_VECTOR,
        onSome: ({ direction }) => direction,
      }),
    )

const skewer =
  (hits: ReadonlyArray<BulletHit>) =>
  (bullet: Bullet): Result.Result<Bullet, void> =>
    Option.match(
      Array.findFirst(hits, ({ bulletId }) => bulletId === bullet.id),
      {
        onNone: () => Result.succeed(bullet),
        onSome: ({ zombieId }) =>
          Pierce.match(bullet.pierce, {
            Stops: () => Result.failVoid,
            Skewers: ({ left, struck }) =>
              left > 0
                ? Result.succeed(
                    modifyFields(bullet, {
                      pierce: () =>
                        Pierce.Skewers({
                          left: left - 1,
                          struck: [...struck, zombieId],
                        }),
                    }),
                  )
                : Result.failVoid,
          }),
      },
    )

export const resolveBulletHits = (
  model: World,
  seconds: number,
  firstFreshId: number,
): World => {
  const freshShots = freshShotsOf(model, firstFreshId)
  const hits = findBulletHits(
    model.bullets,
    model.zombies,
    model.boss,
    seconds,
    freshShots,
  )
  if (Array.isReadonlyArrayEmpty(hits)) {
    return resolveFriendlyFire(model, seconds, freshShots.from, firstFreshId)
  }

  const hitZombieIds = Array.dedupe(Array.map(hits, ({ zombieId }) => zombieId))
  const zombies = Array.map(model.zombies, applyHits(hits))
  const killedZombies = Array.filter(
    zombies,
    zombie => zombie.hp <= 0 && Array.contains(hitZombieIds, zombie.id),
  )
  const hitZombies = Array.filter(zombies, zombie =>
    Array.contains(hitZombieIds, zombie.id),
  )
  const bounty = Array.reduce(
    killedZombies,
    0,
    (sum, zombie) => sum + statsOf(zombie).bounty,
  )
  const struck = modifyFields(model, {
    bullets: Array.filterMap(skewer(hits)),
    zombies: () => zombies,
    stats: stats =>
      countHits(
        stats,
        Array.filter(hits, ({ weapon }) => weapon !== TURRET_WEAPON).length,
      ),
    frameEvents: frameEvents => [
      ...frameEvents,
      ...Array.getSomes(Array.map(hitZombies, hitEventOn(hits))),
      ...Array.map(killedZombies, killEventOn(hits)),
    ],
  })
  return resolveFriendlyFire(
    isCoop(model)
      ? payKillers(creditLanded(struck, hits), hits, killedZombies)
      : modifyFields(struck, { wallet: wallet => earn(wallet, bounty) }),
    seconds,
    freshShots.from,
    firstFreshId,
  )
}

// NOTE: in co-op a shot's sweep starts at its shooter's center, and a kill
// pays the player whose shot landed last (decided 5).
const freshShotsOf = (model: World, firstFreshId: number): FreshShots => ({
  firstId: firstFreshId,
  endId: model.nextEntityId,
  from: isCoop(model)
    ? bullet =>
        Option.match(
          Option.flatMap(maybeShooterOf(bullet), slot =>
            maybePlayerAt(model, slot),
          ),
          {
            onNone: (): Vector => model.player,
            onSome: ({ player }): Vector => player,
          },
        )
    : () => model.player,
})

// NOTE: each shooter's shots that landed, for their aim on the crew
// board. A gnome's peas are its owner's trap, not their aim.
const creditLanded = (model: World, hits: ReadonlyArray<BulletHit>): World => {
  const shooters = Array.filterMap(hits, ({ weapon, maybeShooter }) =>
    weapon === TURRET_WEAPON
      ? Result.failVoid
      : Result.fromOption(maybeShooter, () => undefined),
  )
  return Array.reduce(Array.dedupe(shooters), model, (current, slot) =>
    creditShots(
      current,
      slot,
      0,
      Array.filter(shooters, shooter => shooter === slot).length,
    ),
  )
}

const payKillers = (
  model: World,
  hits: ReadonlyArray<BulletHit>,
  killed: ReadonlyArray<Zombie>,
): World =>
  Array.reduce(killed, model, (current, zombie) => {
    const maybeKiller = Option.flatMap(
      Array.last(hitsOn(hits, zombie.id)),
      ({ maybeShooter }) => maybeShooter,
    )
    const paid = payTo(current, maybeKiller, statsOf(zombie).bounty)
    return Option.match(maybeKiller, {
      onNone: () => paid,
      onSome: slot => creditKills(paid, slot, 1),
    })
  })

const bumpAttacker =
  (attacker: Zombie, direction: Vector) =>
  (zombie: Zombie): Zombie =>
    zombie.id === attacker.id
      ? modifyFields(zombie, {
          knockback: () =>
            scaleVector(
              direction,
              -ZOMBIE_BUMP_SPEED * statsOf(attacker).knockbackScale,
            ),
        })
      : zombie

const bitePlayer = (model: World, attacker: Zombie): World => {
  const { player } = model
  const direction = Option.getOrElse(directionBetween(attacker, player), () =>
    scaleVector(player.facing, -1),
  )
  return modifyFields(model, {
    player: () =>
      woundPlayer(
        player,
        biteDamage(model.difficulty.chosen, statsOf(attacker).contactDamage),
        direction,
        biteGraceScale(model.difficulty.chosen),
      ),
    zombies: Array.map(bumpAttacker(attacker, direction)),
    frameEvents: Array.append(
      GameEvent.PlayerHurt({
        x: player.x,
        y: player.y,
        direction,
        source: attacker.kind,
      }),
    ),
  })
}

const isTouching =
  (player: Player) =>
  (zombie: Zombie): boolean =>
    isFree(zombie) &&
    circlesOverlap(zombie, bodyRadiusOf(zombie), player, PLAYER_RADIUS)

const isBrawler = (zombie: Zombie): boolean =>
  Behavior.isAnyOf(['Brawler', 'Thrower'])(statsOf(zombie).behavior)

const popOnContact =
  (player: Player) =>
  (zombie: Zombie): Zombie =>
    isTouching(player)(zombie)
      ? Behavior.match(statsOf(zombie).behavior, {
          Brawler: () => zombie,
          Bomber: ({ contactFuseMs }) =>
            modifyFields(zombie, {
              state: () => ZombieState.Fusing({ remainingMs: contactFuseMs }),
            }),
          Thrower: () => zombie,
          Crawler: () => zombie,
        })
      : zombie

const popBombers = (model: World): World =>
  modifyFields(model, { zombies: Array.map(popOnContact(model.player)) })

// NOTE: in co-op a zombie must keep touching a player for their seat's
// bite grace before it bites (see Seat); single player bites at once.
const biteOnContact = (model: World): World => {
  if (Invulnerability.isAnyOf(['Invulnerable'])(model.player.invulnerability)) {
    return model
  }

  const maybeAttacker = Array.findFirst(
    model.zombies,
    zombie => isBrawler(zombie) && isTouching(model.player)(zombie),
  )
  if (!isCoop(model)) {
    return Option.match(maybeAttacker, {
      onNone: () => model,
      onSome: attacker => bitePlayer(model, attacker),
    })
  }
  const seat = leadSeatOf(model)
  return Option.match(maybeAttacker, {
    onNone: () =>
      seat.touchedMs === 0
        ? model
        : modifyLeadSeat(model, current =>
            modifyFields(current, { touchedMs: () => 0 }),
          ),
    onSome: attacker =>
      seat.touchedMs >= seat.graceMs
        ? bitePlayer(model, attacker)
        : modifyLeadSeat(model, current =>
            modifyFields(current, {
              touchedMs: touched => touched + FIXED_STEP_MS,
            }),
          ),
  })
}

export const resolvePlayerContact = (model: World): World =>
  popBombers(biteOnContact(model))
