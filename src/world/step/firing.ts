import { Array, Function, Option, Record, Result } from 'effect'

import { UiStruct } from '@effect/ui'

import {
  BULLET_MAX,
  FIXED_STEP_MS,
  IDLE_RELOAD_MS,
  MS_PER_SECOND,
} from '#shared/constants.ts'
import * as DetMath from '#shared/detMath.ts'
import { type Seeded, between, generateMany, nextRandom } from '#shared/prng.ts'
import { appendOrSame, sameIfUnchanged } from '#shared/sameList.ts'
import {
  dropCharge,
  fireFridgeWeapon,
  maybeHeldFridgeWeapon,
} from '#world/fridge/fridgeWeapons.ts'
import {
  bulletGlaze,
  bulletPierce,
  firingStats,
  isAmmoFree,
  keepTopped,
  withLaserSight,
} from '#world/gear/powerups.ts'
import {
  type WeaponStats,
  beginReload,
  canReload,
  finishReload,
  gunPierce,
  heldGun,
  heldLoaded,
  heldWeapon,
  isReloading,
  isWieldingKnife,
  isWieldingMelee,
  perkDamage,
  perkPierce,
  spendRound,
} from '#world/gear/weapons.ts'
import { type Level, levelOf } from '#world/level/arena.ts'
import { findStrike, isInsideRoomAt } from '#world/level/tileQueries.ts'
import {
  atSeat,
  creditShots,
  firedBy,
  modifySeat,
  seatStateAt,
  shooterOf,
} from '#world/party/party.ts'
import { reloadsWhenIdle } from '#world/run/difficulty.ts'
import { countShots } from '#world/run/stats.ts'
import type { World } from '#world/schema/world.ts'
import {
  type Boosts,
  type Bullet,
  type BulletGlaze,
  type CarriedGun,
  Charge,
  GameEvent,
  Pierce,
  type PlayerSlot,
  Reload,
  type SeatState,
  type Vector,
  type WeaponKind,
  type Zombie,
} from '#world/schema/worldSchema.ts'
import { ZOMBIE_KINDS, isFree, radiusOf } from '#world/zombies/zombies.ts'

import { bulletDirection } from './combat.ts'
import { addVectors, scaleVector } from './geometry.ts'
import { buildGrid, queryAround, queryBuffer } from './grid.ts'
import { resolveBulletHits } from './hits.ts'

const pelletVelocity = (
  facing: Vector,
  stats: WeaponStats,
  angleRoll: number,
  speedRoll: number,
): Vector => {
  const angle =
    DetMath.atan2(facing.y, facing.x) + (angleRoll - 0.5) * stats.spread
  const speed =
    stats.bulletSpeed *
    between(speedRoll, 1 - stats.speedJitter, 1 + stats.speedJitter)
  return { x: DetMath.cos(angle) * speed, y: DetMath.sin(angle) * speed }
}

const aimPellets = (
  state: number,
  facing: Vector,
  stats: WeaponStats,
): Seeded<ReadonlyArray<Vector>> => {
  if (stats.spread <= 0 && stats.speedJitter <= 0) {
    return [
      state,
      Array.makeBy(stats.pellets, () => scaleVector(facing, stats.bulletSpeed)),
    ]
  } else {
    return generateMany(state, stats.pellets, drawState => {
      const angleDraw = nextRandom(drawState)
      const speedDraw = nextRandom(angleDraw.nextState)
      return [
        speedDraw.nextState,
        pelletVelocity(facing, stats, angleDraw.value, speedDraw.value),
      ]
    })
  }
}

type Load = Readonly<{
  stats: WeaponStats
  weapon: WeaponKind
  glaze: BulletGlaze
  pierce: Pierce
}>

const makeBullet = (
  id: number,
  muzzle: Vector,
  velocity: Vector,
  { stats, weapon, glaze, pierce }: Load,
): Bullet => ({
  id,
  x: muzzle.x,
  y: muzzle.y,
  velocityX: velocity.x,
  velocityY: velocity.y,
  remainingMs: stats.bulletLifetimeMs,
  weapon,
  damage: stats.damage,
  knockback: stats.knockback,
  glaze,
  pierce,
})

const withPierce = (pierce: Pierce, extra: number): Pierce =>
  extra <= 0
    ? pierce
    : Pierce.match(pierce, {
        Stops: () => Pierce.Skewers({ left: extra, struck: [] }),
        Skewers: ({ left, struck }) =>
          Pierce.Skewers({ left: left + extra, struck }),
      })

const loadOf = (
  {
    boosts,
    laserSight,
  }: Readonly<{ boosts: Boosts; laserSight: SeatState['laserSight'] }>,
  gun: CarriedGun,
): Load => {
  const fired = firingStats(boosts, gun.kind, gun.tier)
  const boosted = laserSight === 'Fitted' ? withLaserSight(fired) : fired
  const glaze = bulletGlaze(boosts)
  return {
    stats: UiStruct.evolve(boosted, {
      damage: damage => perkDamage(gun, damage),
    }),
    weapon: gun.kind,
    glaze: glaze === 'Plain' && gun.perk === 'Spicy' ? 'Spicy' : glaze,
    pierce: withPierce(
      bulletPierce(boosts),
      perkPierce(gun) + gunPierce(gun.kind),
    ),
  }
}

const nextFireCooldown = (
  cooldown: number,
  deltaMs: number,
  isTriggerHeld: boolean,
): number => {
  if (isTriggerHeld) {
    return cooldown - deltaMs
  } else {
    return Math.max(0, cooldown - deltaMs)
  }
}

const shoot = (
  model: World,
  slot: PlayerSlot,
  gun: CarriedGun,
  deltaMs: number,
): World => {
  const { nextEntityId } = model
  const seat = seatStateAt(model, slot)
  const { player, boosts } = seat
  const load = loadOf(seat, gun)
  const { stats, weapon } = load
  const muzzle = addVectors(
    player,
    scaleVector(player.facing, stats.muzzleReach),
  )
  const [rngState, velocities] = aimPellets(
    model.rngState,
    player.facing,
    stats,
  )
  const pellets = Array.map(velocities, (velocity, index) =>
    firedBy(
      makeBullet(nextEntityId + index, muzzle, velocity, load),
      shooterOf(model, slot),
    ),
  )
  const fired = UiStruct.evolve(model, {
    bullets: bullets => Array.takeRight([...bullets, ...pellets], BULLET_MAX),
    nextEntityId: id => id + pellets.length,
    rngState: () => rngState,
    stats: runStats => countShots(runStats, pellets.length),
    seats: atSeat(slot, {
      player: () => {
        const cycled = UiStruct.evolve(player, {
          fireCooldownMs: cooldown => cooldown + stats.fireIntervalMs - deltaMs,
          recoilRemainingMs: () => stats.recoilMs,
        })
        return isAmmoFree(boosts) ? cycled : spendRound(cycled)
      },
    }),
    frameEvents: Array.append(
      GameEvent.Fired({
        x: muzzle.x,
        y: muzzle.y,
        direction: player.facing,
        weapon,
        maybeShooter: shooterOf(model, slot),
      }),
    ),
  })
  return Option.match(shooterOf(model, slot), {
    onNone: () => fired,
    onSome: shooter => creditShots(fired, shooter, pellets.length, 0),
  })
}

const pullTrigger = (
  model: World,
  slot: PlayerSlot,
  deltaMs: number,
): World => {
  const gun = heldGun(seatStateAt(model, slot).player.arsenal)
  return gun.loaded > 0 ? shoot(model, slot, gun, deltaMs) : model
}

const coolTrigger = (
  model: World,
  slot: PlayerSlot,
  deltaMs: number,
  isTriggerHeld: boolean,
): World =>
  modifySeat(model, slot, {
    player: player =>
      UiStruct.evolve(player, {
        fireCooldownMs: cooldown =>
          nextFireCooldown(cooldown, deltaMs, isTriggerHeld),
      }),
  })

const autoReload = (
  model: World,
  slot: PlayerSlot,
  isTriggerHeld: boolean,
): World => {
  const { player } = seatStateAt(model, slot)
  const started = GameEvent.ReloadStarted({
    x: player.x,
    y: player.y,
    direction: player.facing,
    weapon: heldWeapon(player.arsenal),
  })
  return UiStruct.evolve(model, {
    seats: atSeat(slot, {
      player: () =>
        beginReload(UiStruct.evolve(player, { fireCooldownMs: () => 0 })),
    }),
    frameEvents: frameEvents => [
      ...frameEvents,
      ...(isTriggerHeld
        ? [GameEvent.DryFired({ x: player.x, y: player.y })]
        : []),
      started,
    ],
  })
}

const restTrigger = (
  model: World,
  slot: PlayerSlot,
  deltaMs: number,
): World => {
  const { intent } = seatStateAt(model, slot)
  return modifySeat(model, slot, {
    player: player =>
      UiStruct.evolve(player, {
        triggerRestMs: rest =>
          intent.trigger === 'Held' || isWieldingMelee(player)
            ? 0
            : Math.min(IDLE_RELOAD_MS, rest + deltaMs),
      }),
  })
}

const isIdleReloadDue = (model: World, slot: PlayerSlot): boolean => {
  const { player } = seatStateAt(model, slot)
  return (
    reloadsWhenIdle(model.difficulty.chosen) &&
    player.triggerRestMs >= IDLE_RELOAD_MS &&
    canReload(player)
  )
}

const topUp = (model: World, slot: PlayerSlot): World =>
  modifySeat(model, slot, {
    player: player => keepTopped(player, seatStateAt(model, slot).boosts),
  })

const withoutCharge = (model: World, slot: PlayerSlot): World =>
  Charge.isAnyOf(['Idle'])(seatStateAt(model, slot).player.charge)
    ? model
    : modifySeat(model, slot, { player: dropCharge })

export const fire: {
  (slot: PlayerSlot, deltaMs: number): (stocked: World) => World
  (stocked: World, slot: PlayerSlot, deltaMs: number): World
} = Function.dual(
  3,
  (stocked: World, slot: PlayerSlot, deltaMs: number): World => {
    const topped = topUp(restTrigger(stocked, slot, deltaMs), slot)
    if (isWieldingKnife(seatStateAt(topped, slot).player)) {
      return coolTrigger(withoutCharge(topped, slot), slot, deltaMs, false)
    }
    const maybeFridgeWeapon = maybeHeldFridgeWeapon(
      seatStateAt(topped, slot).player,
    )
    const model = Option.isSome(maybeFridgeWeapon)
      ? topped
      : withoutCharge(topped, slot)
    const { player, intent } = seatStateAt(model, slot)
    const isTriggerHeld = intent.trigger === 'Held'

    if (isReloading(player) && !isWieldingMelee(player)) {
      return coolTrigger(withoutCharge(model, slot), slot, deltaMs, false)
    } else if (Option.isSome(maybeFridgeWeapon)) {
      return fireFridgeWeapon(model, slot, maybeFridgeWeapon.value, deltaMs)
    } else if (player.fireCooldownMs > 0) {
      return coolTrigger(
        model,
        slot,
        deltaMs,
        isTriggerHeld && !isReloading(player),
      )
    } else if (heldLoaded(player) <= 0 && canReload(player)) {
      return autoReload(model, slot, isTriggerHeld)
    } else if (isTriggerHeld) {
      return pullTrigger(model, slot, deltaMs)
    } else if (isIdleReloadDue(model, slot)) {
      return autoReload(model, slot, false)
    } else {
      return coolTrigger(model, slot, deltaMs, isTriggerHeld)
    }
  },
)

export const tickReload: {
  (slot: PlayerSlot, deltaMs: number): (model: World) => World
  (model: World, slot: PlayerSlot, deltaMs: number): World
} = Function.dual(
  3,
  (model: World, slot: PlayerSlot, deltaMs: number): World => {
    const { player } = seatStateAt(model, slot)
    return Reload.match(player.reload, {
      Ready: () => model,
      Reloading: ({ remainingMs, durationMs }) =>
        remainingMs > deltaMs
          ? modifySeat(model, slot, {
              player: () =>
                UiStruct.evolve(player, {
                  reload: () =>
                    Reload.Reloading({
                      remainingMs: remainingMs - deltaMs,
                      durationMs,
                    }),
                }),
            })
          : UiStruct.evolve(model, {
              seats: atSeat(slot, { player: () => finishReload(player) }),
              frameEvents: Array.append(
                GameEvent.Reloaded({
                  x: player.x,
                  y: player.y,
                  weapon: heldWeapon(player.arsenal),
                }),
              ),
            }),
    })
  },
)

const isInsideArena = (level: Level, point: Vector): boolean =>
  isInsideRoomAt(level, point)

const advanceBullet =
  (seconds: number, deltaMs: number) =>
  (bullet: Bullet): Bullet =>
    UiStruct.evolve(bullet, {
      x: x => x + bullet.velocityX * seconds,
      y: y => y + bullet.velocityY * seconds,
      remainingMs: remainingMs => remainingMs - deltaMs,
    })

type BulletFlight = Result.Result<Bullet, Option.Option<GameEvent>>

const flyBullet =
  (level: Level, seconds: number, deltaMs: number) =>
  (bullet: Bullet): BulletFlight => {
    const advanced = advanceBullet(seconds, deltaMs)(bullet)
    return Option.match(findStrike(level, bullet, advanced), {
      onSome: point =>
        Result.fail(
          Option.some(
            GameEvent.BulletStruck({
              x: point.x,
              y: point.y,
              direction: bulletDirection(bullet),
            }),
          ),
        ),
      onNone: () =>
        advanced.remainingMs > 0 && isInsideArena(level, advanced)
          ? Result.succeed(advanced)
          : Result.fail(Option.none()),
    })
  }

type BulletChanges = Readonly<{
  bullets: (bullets: ReadonlyArray<Bullet>) => ReadonlyArray<Bullet>
  frameEvents: (
    frameEvents: ReadonlyArray<GameEvent>,
  ) => ReadonlyArray<GameEvent>
}>

export const bulletFlightOf: {
  (seconds: number, deltaMs: number): (model: World) => BulletChanges
  (model: World, seconds: number, deltaMs: number): BulletChanges
} = Function.dual(
  3,
  (model: World, seconds: number, deltaMs: number): BulletChanges => {
    const [flying, stopped] = Array.partition(
      model.bullets,
      flyBullet(levelOf(model), seconds, deltaMs),
    )
    return {
      bullets: bullets => sameIfUnchanged(bullets, flying),
      frameEvents: frameEvents =>
        appendOrSame(frameEvents, Array.getSomes(stopped)),
    }
  },
)

const advanceBullets = (
  model: World,
  seconds: number,
  deltaMs: number,
): World => UiStruct.evolve(model, bulletFlightOf(model, seconds, deltaMs))

export type ZombieAt = Readonly<{ id: number; x: number; y: number }>

export const zombiesAt = (model: World): ReadonlyArray<ZombieAt> =>
  Array.map(model.zombies, ({ id, x, y }) => ({ id, x, y }))

export const catchUpShots: {
  (
    bulletIds: ReadonlySet<number>,
    pasts: ReadonlyArray<ReadonlyArray<ZombieAt>>,
  ): (model: World) => World
  (
    model: World,
    bulletIds: ReadonlySet<number>,
    pasts: ReadonlyArray<ReadonlyArray<ZombieAt>>,
  ): World
} = Function.dual(
  3,
  (
    model: World,
    bulletIds: ReadonlySet<number>,
    pasts: ReadonlyArray<ReadonlyArray<ZombieAt>>,
  ): World =>
    Array.reduce(pasts, model, (current, past) => {
      const mine = Array.filter(current.bullets, bullet =>
        bulletIds.has(bullet.id),
      )
      const others = Array.filter(
        current.bullets,
        bullet => !bulletIds.has(bullet.id),
      )
      if (Array.isReadonlyArrayEmpty(mine)) {
        return current
      }
      const then = new Map(Array.map(past, at => [at.id, at] as const))
      const now = new Map(
        Array.map(current.zombies, zombie => [zombie.id, zombie] as const),
      )
      const rewound = UiStruct.evolve(current, {
        zombies: zombies =>
          Array.map(zombies, zombie =>
            Option.match(Option.fromNullishOr(then.get(zombie.id)), {
              onNone: () => zombie,
              onSome: at => ({ ...zombie, x: at.x, y: at.y }),
            }),
          ),
        bullets: () => mine,
      })
      const seconds = FIXED_STEP_MS / MS_PER_SECOND
      const struck = resolveBulletHits(
        advanceBullets(rewound, seconds, FIXED_STEP_MS),
        seconds,
        current.nextEntityId,
      )
      return UiStruct.evolve(struck, {
        zombies: zombies =>
          Array.map(zombies, zombie =>
            Option.match(Option.fromNullishOr(now.get(zombie.id)), {
              onNone: () => zombie,
              onSome: was => ({ ...zombie, x: was.x, y: was.y }),
            }),
          ),
        bullets: flying => [...others, ...flying],
      })
    }),
)

export const aimTracers: {
  (
    slot: PlayerSlot,
    seed: number,
    firstId: number,
  ): (model: World) => Seeded<ReadonlyArray<Bullet>>
  (
    model: World,
    slot: PlayerSlot,
    seed: number,
    firstId: number,
  ): Seeded<ReadonlyArray<Bullet>>
} = Function.dual(
  4,
  (
    model: World,
    slot: PlayerSlot,
    seed: number,
    firstId: number,
  ): Seeded<ReadonlyArray<Bullet>> => {
    const seat = seatStateAt(model, slot)
    const { player } = seat
    const load = loadOf(seat, heldGun(player.arsenal))
    const { stats } = load
    const muzzle = addVectors(
      player,
      scaleVector(player.facing, stats.muzzleReach),
    )
    const [nextSeed, velocities] = aimPellets(seed, player.facing, stats)
    return [
      nextSeed,
      Array.map(velocities, (velocity, index) =>
        makeBullet(firstId - index, muzzle, velocity, load),
      ),
    ]
  },
)

const MAX_HIT_RADIUS_PX = Math.max(
  ...Array.map(Record.values(ZOMBIE_KINDS), ({ radius }) => radius),
)

export type FlownTracers = Readonly<{
  tracers: ReadonlyArray<Bullet>
  struck: number
}>

export const flyTracers: {
  (
    zombies: ReadonlyArray<Zombie>,
    tracers: ReadonlyArray<Bullet>,
    deltaMs: number,
  ): (level: Level) => FlownTracers
  (
    level: Level,
    zombies: ReadonlyArray<Zombie>,
    tracers: ReadonlyArray<Bullet>,
    deltaMs: number,
  ): FlownTracers
} = Function.dual(
  4,
  (
    level: Level,
    zombies: ReadonlyArray<Zombie>,
    tracers: ReadonlyArray<Bullet>,
    deltaMs: number,
  ): FlownTracers => {
    const flown: Array<Bullet> = []
    let struck = 0
    if (Array.isReadonlyArrayEmpty(tracers)) {
      return { tracers: flown, struck }
    }
    const grid = buildGrid(zombies, isFree, 2 * MAX_HIT_RADIUS_PX)
    const near = queryBuffer(grid)
    for (const tracer of tracers) {
      Result.match(flyBullet(level, deltaMs / MS_PER_SECOND, deltaMs)(tracer), {
        onFailure: () => undefined,
        onSuccess: moved => {
          const count = queryAround(grid, near, moved, MAX_HIT_RADIUS_PX)
          let isHit = false
          for (let at = 0; at < count && !isHit; at++) {
            const zombie = zombies[near[at] ?? 0]
            isHit =
              zombie !== undefined &&
              DetMath.hypot(zombie.x - moved.x, zombie.y - moved.y) <=
                radiusOf(zombie)
          }
          if (isHit) {
            struck++
          } else {
            flown.push(moved)
          }
        },
      })
    }
    return { tracers: flown, struck }
  },
)
