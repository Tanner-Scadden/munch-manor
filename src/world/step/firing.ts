import { Array, Function, Option, Result } from 'effect'
import { modifyFields } from 'foldkit/struct'

import {
  BULLET_MAX,
  FIXED_STEP_MS,
  IDLE_RELOAD_MS,
  MS_PER_SECOND,
} from '../../shared/constants'
import {
  type Seeded,
  between,
  generateMany,
  nextRandom,
} from '../../shared/prng'
import {
  dropCharge,
  fireFridgeWeapon,
  maybeHeldFridgeWeapon,
} from '../fridge/fridgeWeapons'
import {
  bulletGlaze,
  bulletPierce,
  firingStats,
  isAmmoFree,
  keepTopped,
} from '../gear/powerups'
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
} from '../gear/weapons'
import { type Level, levelOf } from '../level/arena'
import { findStrike, isInsideRoomAt } from '../level/tileQueries'
import {
  atSeat,
  creditShots,
  firedBy,
  modifySeat,
  seatStateAt,
  shooterOf,
} from '../party/party'
import { reloadsWhenIdle } from '../run/difficulty'
import { countShots } from '../run/stats'
import type { World } from '../schema/world'
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
  type Vector,
  type WeaponKind,
  type Zombie,
} from '../schema/worldSchema'
import { isFree, radiusOf } from '../zombies/zombies'
import { bulletDirection } from './combat'
import { addVectors, scaleVector } from './geometry'
import { resolveBulletHits } from './hits'

// FIRING

const pelletVelocity = (
  facing: Vector,
  stats: WeaponStats,
  angleRoll: number,
  speedRoll: number,
): Vector => {
  const angle =
    Math.atan2(facing.y, facing.x) + (angleRoll - 0.5) * stats.spread
  const speed =
    stats.bulletSpeed *
    between(speedRoll, 1 - stats.speedJitter, 1 + stats.speedJitter)
  return { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed }
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

// NOTE: a cooked gun's perk (src/world/kitchen/stove.ts) rides on its load: Spicy hits
// harder and glows hot when no boost tints the shot, and Crispy skewers one
// zombie more. Old Thunder's own pierce adds on top.
const withPierce = (pierce: Pierce, extra: number): Pierce =>
  extra <= 0
    ? pierce
    : Pierce.match(pierce, {
        Stops: () => Pierce.Skewers({ left: extra, struck: [] }),
        Skewers: ({ left, struck }) =>
          Pierce.Skewers({ left: left + extra, struck }),
      })

const loadOf = (boosts: Boosts, gun: CarriedGun): Load => {
  const boosted = firingStats(boosts, gun.kind, gun.tier)
  const glaze = bulletGlaze(boosts)
  return {
    stats: modifyFields(boosted, {
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
  const { player, boosts } = seatStateAt(model, slot)
  const load = loadOf(boosts, gun)
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
  const fired = modifyFields(model, {
    bullets: bullets => Array.takeRight([...bullets, ...pellets], BULLET_MAX),
    nextEntityId: id => id + pellets.length,
    rngState: () => rngState,
    stats: runStats => countShots(runStats, pellets.length),
    seats: atSeat(slot, {
      player: () => {
        const cycled = modifyFields(player, {
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

// NOTE: no gun runs dry: an empty magazine reloads before the trigger is
// pulled (fire, below), so an empty one here fires nothing.
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
      modifyFields(player, {
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
  return modifyFields(model, {
    seats: atSeat(slot, {
      player: () =>
        beginReload(modifyFields(player, { fireCooldownMs: () => 0 })),
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

// NOTE: the trigger's rest starts over while fire is held or the melee
// weapon is out, and otherwise counts up to IDLE_RELOAD_MS, where it stays.
const restTrigger = (
  model: World,
  slot: PlayerSlot,
  deltaMs: number,
): World => {
  const { intent } = seatStateAt(model, slot)
  return modifySeat(model, slot, {
    player: player =>
      modifyFields(player, {
        triggerRestMs: rest =>
          intent.trigger === 'Held' || isWieldingMelee(player)
            ? 0
            : Math.min(IDLE_RELOAD_MS, rest + deltaMs),
      }),
  })
}

// NOTE: below Hard (src/world/run/difficulty.ts), a gun with room in its magazine
// reloads by itself once the trigger has rested
// IDLE_RELOAD_MS (GAME_DESIGN.md, "Reloading"). Hard and Nightmare wait
// for an empty magazine or R.
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

// NOTE: a fridge weapon fires no bullets, so its trigger is its own
// (src/world/fridge/fridgeWeapons.ts). The stall and a reload let go of a charge. With
// the knife in hand the trigger stabs (src/world/gear/knife.ts) and the gun rests;
// with the Clang Pan drawn from the melee slot it swings, and a reload of
// the last gun carries on meanwhile. Below Hard a rested trigger reloads
// a gun that has room for more (isIdleReloadDue).
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

// RELOADING

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
                modifyFields(player, {
                  reload: () =>
                    Reload.Reloading({
                      remainingMs: remainingMs - deltaMs,
                      durationMs,
                    }),
                }),
            })
          : modifyFields(model, {
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

// BULLETS

// NOTE: a bullet flies on until it leaves the house: past the map's edge or
// out a door into the yard, where nothing is drawn.
const isInsideArena = (level: Level, point: Vector): boolean =>
  isInsideRoomAt(level, point)

const advanceBullet =
  (seconds: number, deltaMs: number) =>
  (bullet: Bullet): Bullet =>
    modifyFields(bullet, {
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

export const advanceBullets: {
  (seconds: number, deltaMs: number): (model: World) => World
  (model: World, seconds: number, deltaMs: number): World
} = Function.dual(
  3,
  (model: World, seconds: number, deltaMs: number): World => {
    const [flying, stopped] = Array.partition(
      model.bullets,
      flyBullet(levelOf(model), seconds, deltaMs),
    )
    return modifyFields(model, {
      bullets: () => flying,
      frameEvents: frameEvents => [...frameEvents, ...Array.getSomes(stopped)],
    })
  },
)

// LAG COMPENSATION

// NOTE: where each zombie stood after one tick, for the room's history.
export type ZombieAt = Readonly<{ id: number; x: number; y: number }>

export const zombiesAt = (model: World): ReadonlyArray<ZombieAt> =>
  Array.map(model.zombies, ({ id, x, y }) => ({ id, x, y }))

// NOTE: favor the shooter (MULTIPLAYER.md, "Latency"). A shot fired by a
// player who saw the room `pasts.length` ticks ago flies those ticks now,
// one tick against each past, oldest first, with every zombie where it
// stood then, so it lands where the player aimed. Its hits apply to the
// zombies as they are now (hearts, deaths, money, events); only the
// positions are rewound, then put back. Pure, so the room replays the
// same everywhere.
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
      const rewound = modifyFields(current, {
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
      return modifyFields(struck, {
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

// TRACERS

// NOTE: a co-op client's own shot, drawn the instant it fires (src/app/update/coopPlay.ts):
// the pellets the gun it holds would fire from where it stands, aimed as
// it aims, with the client's cosmetic stream for the spread. They hurt
// nothing; the room's own copy of the shot decides every hit.
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
    const { player, boosts } = seatStateAt(model, slot)
    const load = loadOf(boosts, heldGun(player.arsenal))
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

// NOTE: tracers fly as bullets do and stop at a wall, the arena's edge, the
// end of their life, or the first zombie they touch; a zombie the room says
// was missed is simply not hurt, and nothing is rewound.
// NOTE: `struck` counts the tracers that stopped on a zombie: the hits a
// player saw, which the audit sets beside the hits the room confirmed.
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
  ): FlownTracers =>
    Array.reduce(
      tracers,
      { tracers: Array.empty<Bullet>(), struck: 0 },
      (flown, tracer) =>
        Result.match(
          flyBullet(level, deltaMs / MS_PER_SECOND, deltaMs)(tracer),
          {
            onFailure: () => flown,
            onSuccess: moved =>
              Array.some(
                zombies,
                zombie =>
                  isFree(zombie) &&
                  Math.hypot(zombie.x - moved.x, zombie.y - moved.y) <=
                    radiusOf(zombie),
              )
                ? { ...flown, struck: flown.struck + 1 }
                : { ...flown, tracers: Array.append(flown.tracers, moved) },
          },
        ),
    ),
)
