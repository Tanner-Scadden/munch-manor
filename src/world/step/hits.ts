import { Array, Function, Option, Result } from 'effect'
import { modifyFields } from 'foldkit/struct'

import {
  BULLET_RADIUS,
  FIXED_STEP_MS,
  PLAYER_RADIUS,
  ZOMBIE_BUMP_SPEED,
} from '../../shared/constants'
import { creditGunKills, killerSlotOf } from '../gear/gunLevels'
import { TURRET_WEAPON } from '../gear/traps'
import {
  atSeat,
  creditKills,
  creditShots,
  focusOf,
  isCoop,
  maybePlayerAt,
  maybeShooterOf,
  modifySeatRecord,
  seatStateAt,
} from '../party/party'
import { resolveFriendlyFire } from '../party/revive'
import { biteDamage, biteGraceScale } from '../run/difficulty'
import { countHits } from '../run/stats'
import type { World } from '../schema/world'
import {
  type Boss,
  type Bullet,
  GameEvent,
  Invulnerability,
  Pierce,
  type Player,
  type PlayerSlot,
  type Vector,
  type WeaponKind,
  type Zombie,
  ZombieState,
} from '../schema/worldSchema'
import { woundScaleOf } from '../zombies/bossFight'
import { maybeShieldFor } from '../zombies/chucker'
import { MAX_BODY_RADIUS_PX, groundedGrid } from '../zombies/zombieGrid'
import { Behavior, bodyRadiusOf, isFree, statsOf } from '../zombies/zombies'
import {
  bulletDirection,
  creditKillEvents,
  hitEvent,
  killEvent,
  strikeZombie,
  woundPlayer,
} from './combat'
import {
  ZERO_VECTOR,
  circlesOverlap,
  closestPointOnSegment,
  directionBetween,
  scaleVector,
} from './geometry'
import { queryBox, queryBuffer } from './grid'

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

const struckBy = (bullet: Bullet): ReadonlyArray<number> =>
  Pierce.match(bullet.pierce, {
    Stops: () => [],
    Skewers: ({ struck }) => struck,
  })

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

// NOTE: a bullet only meets the grounded zombies in the cells its sweep (grown
// by the widest reach) crosses, taken in list order, so the first nearest
// contact wins a tie as it did over the whole list.
const findBulletHits = (
  bullets: ReadonlyArray<Bullet>,
  zombies: ReadonlyArray<Zombie>,
  boss: Boss,
  seconds: number,
  freshShots: FreshShots,
): ReadonlyArray<BulletHit> => {
  if (Array.isReadonlyArrayEmpty(bullets)) {
    return []
  }

  const grid = groundedGrid(zombies)
  const near = queryBuffer(grid)
  const growPx = BULLET_RADIUS + MAX_BODY_RADIUS_PX
  const hits: Array<BulletHit> = []
  for (const bullet of bullets) {
    const from = sweepStart(bullet, seconds, freshShots)
    const struck = struckBy(bullet)
    const count = queryBox(
      grid,
      near,
      Math.min(from.x, bullet.x) - growPx,
      Math.min(from.y, bullet.y) - growPx,
      Math.max(from.x, bullet.x) + growPx,
      Math.max(from.y, bullet.y) + growPx,
    )
    let nearest: Contact | undefined = undefined
    for (let at = 0; at < count; at++) {
      const zombie = zombies[near[at] ?? 0]
      // NOTE: the zombies one bullet already struck, a few (its pierce).
      // oxlint-disable-next-line munch/no-nested-scan
      if (zombie !== undefined && !Array.contains(struck, zombie.id)) {
        const contact = maybeContact(from, bullet, zombie)
        if (
          Option.isSome(contact) &&
          (nearest === undefined || contact.value.reach < nearest.reach)
        ) {
          nearest = contact.value
        }
      }
    }
    if (nearest !== undefined) {
      hits.push({
        bulletId: bullet.id,
        zombieId: shieldedTarget(bullet, nearest.zombie),
        x: nearest.point.x,
        y: nearest.point.y,
        direction: bulletDirection(bullet),
        weapon: bullet.weapon,
        damage: bullet.damage * woundScaleOf(boss, nearest.zombie),
        knockback: bullet.knockback,
        maybeShooter: maybeShooterOf(bullet),
      })
    }
  }
  return hits
}

const totalDamage = (hits: ReadonlyArray<BulletHit>): number =>
  Array.reduce(hits, 0, (sum, hit) => sum + hit.damage)

const strongestKnockback = (hits: ReadonlyArray<BulletHit>): number =>
  Array.reduce(hits, 0, (strongest, hit) => Math.max(strongest, hit.knockback))

// NOTE: a frame's hits by the zombie they land on, and each bullet's first,
// in the order they were found. Every zombie, kill, and bullet reads them,
// so each frame's hits are grouped once rather than scanned for each.
type HitIndex = Readonly<{
  byZombie: ReadonlyMap<number, ReadonlyArray<BulletHit>>
  firstByBullet: ReadonlyMap<number, BulletHit>
}>

const hitIndexes = new WeakMap<ReadonlyArray<BulletHit>, HitIndex>()

const hitIndexOf = (hits: ReadonlyArray<BulletHit>): HitIndex => {
  const cached = hitIndexes.get(hits)
  if (cached !== undefined) {
    return cached
  }
  const byZombie = new Map<number, Array<BulletHit>>()
  const firstByBullet = new Map<number, BulletHit>()
  for (const hit of hits) {
    const landed = byZombie.get(hit.zombieId)
    if (landed === undefined) {
      byZombie.set(hit.zombieId, [hit])
    } else {
      landed.push(hit)
    }
    if (!firstByBullet.has(hit.bulletId)) {
      firstByBullet.set(hit.bulletId, hit)
    }
  }
  const index: HitIndex = { byZombie, firstByBullet }
  hitIndexes.set(hits, index)
  return index
}

const hitsOn = (
  hits: ReadonlyArray<BulletHit>,
  zombieId: number,
): ReadonlyArray<BulletHit> => hitIndexOf(hits).byZombie.get(zombieId) ?? []

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

// NOTE: a bullet's kill is the last hit's: its shooter (none for a gnome's
// pea) and its gun.
const killEventsOn =
  (hits: ReadonlyArray<BulletHit>) =>
  (zombie: Zombie): ReadonlyArray<GameEvent> =>
    Option.match(Array.last(hitsOn(hits, zombie.id)), {
      onNone: () => [killEvent(zombie, ZERO_VECTOR)],
      onSome: ({ direction, maybeShooter, weapon }) =>
        creditKillEvents([killEvent(zombie, direction)], maybeShooter, weapon),
    })

const skewer =
  (hits: ReadonlyArray<BulletHit>) =>
  (bullet: Bullet): Result.Result<Bullet, void> =>
    Option.match(
      Option.fromNullishOr(hitIndexOf(hits).firstByBullet.get(bullet.id)),
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

export const resolveBulletHits: {
  (seconds: number, firstFreshId: number): (model: World) => World
  (model: World, seconds: number, firstFreshId: number): World
} = Function.dual(
  3,
  (model: World, seconds: number, firstFreshId: number): World => {
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

    const { byZombie } = hitIndexOf(hits)
    const zombies = Array.map(model.zombies, applyHits(hits))
    const killedZombies = Array.filter(
      zombies,
      zombie => zombie.hp <= 0 && byZombie.has(zombie.id),
    )
    const hitZombies = Array.filter(zombies, zombie => byZombie.has(zombie.id))
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
        ...Array.flatMap(killedZombies, killEventsOn(hits)),
      ],
    })
    return resolveFriendlyFire(
      creditGuns(
        isCoop(model)
          ? creditKillers(creditLanded(struck, hits), hits, killedZombies)
          : struck,
        hits,
        killedZombies,
      ),
      seconds,
      freshShots.from,
      firstFreshId,
    )
  },
)

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
            onNone: (): Vector => focusOf(model).player,
            onSome: ({ player }): Vector => player,
          },
        )
    : () => focusOf(model).player,
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
      // NOTE: at most 4 shooting seats.
      // oxlint-disable-next-line munch/no-nested-scan
      Array.filter(shooters, shooter => shooter === slot).length,
    ),
  )
}

const creditKillers = (
  model: World,
  hits: ReadonlyArray<BulletHit>,
  killed: ReadonlyArray<Zombie>,
): World =>
  Array.reduce(killed, model, (current, zombie) => {
    const maybeKiller = Option.flatMap(
      Array.last(hitsOn(hits, zombie.id)),
      ({ maybeShooter }) => maybeShooter,
    )
    return Option.match(maybeKiller, {
      onNone: () => current,
      onSome: slot => creditKills(current, slot, 1),
    })
  })

// NOTE: each kill levels the gun whose shot landed last on it, in its
// shooter's hands (src/world/gear/gunLevels.ts). A gnome's peas level nothing.
const creditGuns = (
  model: World,
  hits: ReadonlyArray<BulletHit>,
  killed: ReadonlyArray<Zombie>,
): World =>
  Array.reduce(killed, model, (current, zombie) =>
    Option.match(Array.last(hitsOn(hits, zombie.id)), {
      onNone: () => current,
      onSome: ({ weapon, maybeShooter }) =>
        weapon === TURRET_WEAPON
          ? current
          : creditGunKills(
              current,
              killerSlotOf(current, maybeShooter),
              weapon,
              1,
            ),
    }),
  )

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

const bitePlayer = (
  model: World,
  slot: PlayerSlot,
  attacker: Zombie,
): World => {
  const { player } = seatStateAt(model, slot)
  const direction = Option.getOrElse(directionBetween(attacker, player), () =>
    scaleVector(player.facing, -1),
  )
  return modifyFields(model, {
    seats: atSeat(slot, {
      player: () =>
        woundPlayer(
          player,
          biteDamage(model.difficulty.chosen, statsOf(attacker).contactDamage),
          direction,
          biteGraceScale(model.difficulty.chosen),
        ),
    }),
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

const popBombers = (model: World, slot: PlayerSlot): World =>
  modifyFields(model, {
    zombies: Array.map(popOnContact(seatStateAt(model, slot).player)),
  })

// NOTE: in co-op a zombie must keep touching a player for their seat's
// bite grace before it bites (see Seat); single player bites at once.
const biteOnContact = (model: World, slot: PlayerSlot): World => {
  const { player, seat } = seatStateAt(model, slot)
  if (Invulnerability.isAnyOf(['Invulnerable'])(player.invulnerability)) {
    return model
  }

  const isTouched = isTouching(player)
  const maybeAttacker = Array.findFirst(
    model.zombies,
    zombie => isBrawler(zombie) && isTouched(zombie),
  )
  if (!isCoop(model)) {
    return Option.match(maybeAttacker, {
      onNone: () => model,
      onSome: attacker => bitePlayer(model, slot, attacker),
    })
  }
  return Option.match(maybeAttacker, {
    onNone: () =>
      seat.touchedMs === 0
        ? model
        : modifySeatRecord(model, slot, current =>
            modifyFields(current, { touchedMs: () => 0 }),
          ),
    onSome: attacker =>
      seat.touchedMs >= seat.graceMs
        ? bitePlayer(model, slot, attacker)
        : modifySeatRecord(model, slot, current =>
            modifyFields(current, {
              touchedMs: touched => touched + FIXED_STEP_MS,
            }),
          ),
  })
}

export const resolvePlayerContact: {
  (slot: PlayerSlot): (model: World) => World
  (model: World, slot: PlayerSlot): World
} = Function.dual(2, (model: World, slot: PlayerSlot): World =>
  popBombers(biteOnContact(model, slot), slot),
)
