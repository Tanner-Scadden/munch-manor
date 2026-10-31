import { Array, Option, Result } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { type Level, findStrike, isInsideRoomAt, levelOf } from './arena'
import { bulletDirection } from './combat'
import {
  BULLET_MAX,
  DRY_FIRE_DELAY_MS,
  FIXED_STEP_MS,
  MS_PER_SECOND,
} from './constants'
import {
  dropCharge,
  fireFridgeWeapon,
  maybeHeldFridgeWeapon,
} from './fridgeWeapons'
import { addVectors, scaleVector } from './geometry'
import { resolveBulletHits } from './hits'
import { firedBy, forEachSeat, shooterOf } from './party'
import {
  bulletGlaze,
  bulletPierce,
  firingStats,
  isAmmoFree,
  keepTopped,
} from './powerups'
import { type Seeded, between, generateMany, nextRandom } from './prng'
import { isAtCounter } from './shop'
import { countShots } from './stats'
import {
  type WeaponStats,
  beginReload,
  canReload,
  finishReload,
  handOverWhenDry,
  heldGun,
  heldLoaded,
  heldWeapon,
  isReloading,
  isWieldingKnife,
  isWieldingMelee,
  spendRound,
} from './weapons'
import type { World } from './world'
import {
  type Bullet,
  type BulletGlaze,
  Charge,
  GameEvent,
  Phase,
  type Pierce,
  Reload,
  ShopState,
  type Vector,
  type WeaponKind,
  type Zombie,
} from './worldSchema'
import { isFree, radiusOf } from './zombies'

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
  weapon: WeaponKind,
  tier: number,
  deltaMs: number,
): World => {
  const { player, nextEntityId, boosts } = model
  const stats = firingStats(boosts, weapon, tier)
  const load: Load = {
    stats,
    weapon,
    glaze: bulletGlaze(boosts),
    pierce: bulletPierce(boosts),
  }
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
      shooterOf(model),
    ),
  )
  return modifyFields(model, {
    bullets: bullets => Array.takeRight([...bullets, ...pellets], BULLET_MAX),
    nextEntityId: id => id + pellets.length,
    rngState: () => rngState,
    stats: runStats => countShots(runStats, pellets.length),
    player: () => {
      const cycled = modifyFields(player, {
        fireCooldownMs: cooldown => cooldown + stats.fireIntervalMs - deltaMs,
        recoilRemainingMs: () => stats.recoilMs,
      })
      return isAmmoFree(boosts) ? cycled : spendRound(cycled)
    },
    frameEvents: Array.append(
      GameEvent.Fired({
        x: muzzle.x,
        y: muzzle.y,
        direction: player.facing,
        weapon,
        maybeShooter: shooterOf(model),
      }),
    ),
  })
}

const runDry = (model: World): World =>
  modifyFields(model, {
    player: player =>
      handOverWhenDry(
        modifyFields(player, { fireCooldownMs: () => DRY_FIRE_DELAY_MS }),
      ),
    frameEvents: Array.append(
      GameEvent.RanDry({ x: model.player.x, y: model.player.y }),
    ),
  })

const pullTrigger = (model: World, deltaMs: number): World => {
  const gun = heldGun(model.player.arsenal)
  return gun.loaded > 0
    ? shoot(model, gun.kind, gun.tier, deltaMs)
    : runDry(model)
}

const coolTrigger = (
  model: World,
  deltaMs: number,
  isTriggerHeld: boolean,
): World =>
  modifyFields(model, {
    player: player =>
      modifyFields(player, {
        fireCooldownMs: cooldown =>
          nextFireCooldown(cooldown, deltaMs, isTriggerHeld),
      }),
  })

const autoReload = (model: World, isTriggerHeld: boolean): World => {
  const { player } = model
  const started = GameEvent.ReloadStarted({
    x: player.x,
    y: player.y,
    direction: player.facing,
    weapon: heldWeapon(player.arsenal),
  })
  return modifyFields(model, {
    player: () =>
      beginReload(modifyFields(player, { fireCooldownMs: () => 0 })),
    frameEvents: frameEvents => [
      ...frameEvents,
      ...(isTriggerHeld
        ? [GameEvent.DryFired({ x: player.x, y: player.y })]
        : []),
      started,
    ],
  })
}

// NOTE: the stall shuts outside the break. A player still at the counter
// when the wave starts (in co-op the break runs on while one shops) or the
// run ends is sent off it, and their shop dialog follows
// (src/update/shop.ts, syncShopDialog).
export const shutStallOutsideBreak = (model: World): World =>
  Phase.isAnyOf(['Preparation'])(model.phase)
    ? model
    : forEachSeat(model, seatWorld =>
        isAtCounter(seatWorld.shop)
          ? modifyFields(seatWorld, { shop: () => ShopState.Dismissed() })
          : seatWorld,
      )

const topUp = (model: World): World =>
  isAtCounter(model.shop)
    ? model
    : modifyFields(model, {
        player: player => keepTopped(player, model.boosts),
      })

const withoutCharge = (model: World): World =>
  Charge.isAnyOf(['Idle'])(model.player.charge)
    ? model
    : modifyFields(model, { player: dropCharge })

// NOTE: a fridge weapon fires no bullets, so its trigger is its own
// (src/fridgeWeapons.ts). The stall and a reload let go of a charge. With
// the knife in hand the trigger stabs (src/knife.ts) and the gun rests;
// with the Clang Pan drawn from the melee slot it swings, and a reload of
// the last gun carries on meanwhile.
export const fire = (stocked: World, deltaMs: number): World => {
  const topped = topUp(stocked)
  if (isWieldingKnife(topped.player)) {
    return coolTrigger(withoutCharge(topped), deltaMs, false)
  }
  const maybeFridgeWeapon = maybeHeldFridgeWeapon(topped.player)
  const model = Option.isSome(maybeFridgeWeapon)
    ? topped
    : withoutCharge(topped)
  const { player, intent } = model
  const isTriggerHeld = intent.trigger === 'Held'

  if (
    isAtCounter(model.shop) ||
    (isReloading(player) && !isWieldingMelee(player))
  ) {
    return coolTrigger(withoutCharge(model), deltaMs, false)
  } else if (Option.isSome(maybeFridgeWeapon)) {
    return fireFridgeWeapon(model, maybeFridgeWeapon.value, deltaMs)
  } else if (player.fireCooldownMs > 0) {
    return coolTrigger(model, deltaMs, isTriggerHeld && !isReloading(player))
  } else if (heldLoaded(player) <= 0 && canReload(player)) {
    return autoReload(model, isTriggerHeld)
  } else if (isTriggerHeld) {
    return pullTrigger(model, deltaMs)
  } else {
    return coolTrigger(model, deltaMs, isTriggerHeld)
  }
}

// RELOADING

export const tickReload = (model: World, deltaMs: number): World => {
  const { player } = model
  if (isAtCounter(model.shop)) {
    return model
  }

  return Reload.match(player.reload, {
    Ready: () => model,
    Reloading: ({ remainingMs, durationMs }) =>
      remainingMs > deltaMs
        ? modifyFields(model, {
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
            player: () => finishReload(player),
            frameEvents: Array.append(
              GameEvent.Reloaded({
                x: player.x,
                y: player.y,
                weapon: heldWeapon(player.arsenal),
              }),
            ),
          }),
  })
}

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

export const advanceBullets = (
  model: World,
  seconds: number,
  deltaMs: number,
): World => {
  const [flying, stopped] = Array.partition(
    model.bullets,
    flyBullet(levelOf(model), seconds, deltaMs),
  )
  return modifyFields(model, {
    bullets: () => flying,
    frameEvents: frameEvents => [...frameEvents, ...Array.getSomes(stopped)],
  })
}

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
export const catchUpShots = (
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
  })

// TRACERS

// NOTE: a co-op client's own shot, drawn the instant it fires (src/coopPlay.ts):
// the pellets the gun it holds would fire from where it stands, aimed as
// it aims, with the client's cosmetic stream for the spread. They hurt
// nothing; the room's own copy of the shot decides every hit.
export const aimTracers = (
  model: World,
  seed: number,
  firstId: number,
): Seeded<ReadonlyArray<Bullet>> => {
  const { player, boosts } = model
  const { kind: weapon, tier } = heldGun(player.arsenal)
  const stats = firingStats(boosts, weapon, tier)
  const load: Load = {
    stats,
    weapon,
    glaze: bulletGlaze(boosts),
    pierce: bulletPierce(boosts),
  }
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
}

// NOTE: tracers fly as bullets do and stop at a wall, the arena's edge, the
// end of their life, or the first zombie they touch; a zombie the room says
// was missed is simply not hurt, and nothing is rewound.
// NOTE: `struck` counts the tracers that stopped on a zombie: the hits a
// player saw, which the audit sets beside the hits the room confirmed.
export type FlownTracers = Readonly<{
  tracers: ReadonlyArray<Bullet>
  struck: number
}>

export const flyTracers = (
  level: Level,
  zombies: ReadonlyArray<Zombie>,
  tracers: ReadonlyArray<Bullet>,
  deltaMs: number,
): FlownTracers =>
  Array.reduce(
    tracers,
    { tracers: Array.empty<Bullet>(), struck: 0 },
    (flown, tracer) =>
      Result.match(flyBullet(level, deltaMs / MS_PER_SECOND, deltaMs)(tracer), {
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
      }),
  )
