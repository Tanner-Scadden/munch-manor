import { Array } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { levelOf } from './arena'
import {
  BLOOD_PER_HIT,
  BLOOD_SPRAY_SPREAD,
  CHIPS_PER_STRIKE,
  CHIP_SPREAD,
  COINS_PER_GRAB,
  COINS_PER_PURCHASE,
  DECAL_MAX,
  DUST_HURT_SPEED_MAX,
  DUST_HURT_SPEED_MIN,
  DUST_INTERVAL_MS,
  DUST_PER_BURP,
  DUST_PER_FIZZLE,
  DUST_PER_HURT,
  DUST_PER_PLACEMENT,
  DUST_PER_STRIKE,
  DUST_SPEED_MAX,
  DUST_SPEED_MIN,
  PARTICLE_MAX,
  RATTLE_DUST_PER_WARNING,
  SCORCH_SIZE_PX,
  SPARKS_PER_DROP,
  SPARKS_PER_GRAB,
  SPLINTERS_PER_HIT,
  ZOMBIE_FOOT_OFFSET,
} from './constants'
import { ZERO_VECTOR, vectorLength } from './geometry'
import { type Decal, GameEvent, type Model, type Particle } from './model'
import {
  BLOOD_SPEED,
  CLANG_SPARKS,
  DUD_FOG,
  FLATTEN_SPARKS,
  FREEZE_FROST,
  FREEZE_SPREAD,
  FRIDGE_FOG,
  FROZEN_FROST,
  GOO_BURST_SPEED,
  GRAB_DUST,
  HOME_RUN_SPARKS,
  KNIFE_SPARKS,
  LANDING_CHIPS,
  LANDING_DUST,
  LAUNCH_STEAM,
  LID_DUST,
  LID_SMOKE,
  LID_SPARKS,
  OVEN_SMOKE,
  OVEN_SPARKS,
  PAN_SMASH_DUST,
  POP_SPARKS,
  POP_STEAM,
  RUSH_DUST,
  SHATTER_ICE,
  SLAM_DUST,
  SLIP_SPLASH,
  SPIT_GOO,
  STIR_DUST,
  STOMP_DUST,
  SURFACE_CHIPS,
  SURFACE_DUST,
  SURFACE_SPLINTERS,
  THROW_DUST,
  WIPE_COINS,
  angleOf,
  belchParticles,
  blastParticles,
  bonkParticles,
  breakParticles,
  chain,
  chip,
  clipParticles,
  coin,
  crackParticles,
  droplet,
  dustPuff,
  dustRing,
  fogPuff,
  footfallDust,
  frostBit,
  gib,
  killParticles,
  noParticles,
  playerGround,
  shedParticles,
  shellCasing,
  smashParticles,
  smokePuff,
  sparks,
  splatParticles,
  stompParticles,
  withState,
  woodBit,
  woodBits,
  zombieGround,
} from './particleBursts'
import { stepParticle } from './particlePhysics'
import { type Seeded, generateMany } from './prng'
import { WEAPONS, heldWeapon } from './weapons'
import { ZOMBIE_KINDS } from './zombies'

const eventParticles = (
  state: number,
  event: GameEvent,
): Seeded<ReadonlyArray<Particle>> =>
  GameEvent.match(event, {
    Fired: ({ x, y, direction, weapon }) =>
      generateMany(
        state,
        1,
        shellCasing(playerGround(x, y), direction, WEAPONS[weapon].casing),
      ),
    ZombieHit: ({ x, y, direction, kind }) =>
      generateMany(
        state,
        BLOOD_PER_HIT,
        droplet(
          ZOMBIE_KINDS[kind].hitSpray,
          zombieGround(x, y, kind),
          angleOf(direction),
          BLOOD_SPRAY_SPREAD,
          BLOOD_SPEED,
        ),
      ),
    ZombieKilled: killed => killParticles(state, killed),
    Exploded: exploded => blastParticles(state, exploded),
    Footfall: footfall => footfallDust(state, footfall),
    PlayerHurt: ({ x, y }) =>
      generateMany(
        state,
        DUST_PER_HURT,
        dustPuff(
          playerGround(x, y),
          0,
          Math.PI * 2,
          DUST_HURT_SPEED_MIN,
        )(DUST_HURT_SPEED_MAX),
      ),
    BulletStruck: ({ x, y, direction }) => {
      const ground = { x, y }
      const heading = angleOf(direction) + Math.PI
      return chain(state, [
        drawState =>
          generateMany(drawState, CHIPS_PER_STRIKE, chip(ground, heading)),
        drawState =>
          generateMany(
            drawState,
            DUST_PER_STRIKE,
            dustPuff(
              ground,
              heading,
              CHIP_SPREAD,
              DUST_SPEED_MIN,
            )(DUST_SPEED_MAX),
          ),
      ])
    },
    RanDry: () => noParticles(state),
    DryFired: () => noParticles(state),
    ReloadStarted: ({ x, y, direction, weapon }) =>
      withState(state, clipParticles(x, y, direction, weapon)),
    Reloaded: () => noParticles(state),
    WaveCleared: () => noParticles(state),
    PackWarned: ({ x, y }) =>
      dustRing({ x, y }, RATTLE_DUST_PER_WARNING)(state),
    TrapHit: ({ x, y }) =>
      woodBits('Splinter', { x, y }, SPLINTERS_PER_HIT)(state),
    TrapCracked: cracked => crackParticles(state, cracked),
    TrapBroken: broken => breakParticles(state, broken),
    PickupDropped: ({ x, y }) => sparks({ x, y }, SPARKS_PER_DROP)(state),
    PickupGrabbed: ({ x, y }) =>
      chain(state, [
        sparks({ x, y }, SPARKS_PER_GRAB),
        drawState => generateMany(drawState, COINS_PER_GRAB, coin({ x, y })),
      ]),
    PickupFizzled: ({ x, y }) => dustRing({ x, y }, DUST_PER_FIZZLE)(state),
    BoostFaded: () => noParticles(state),
    Burped: ({ x, y }) => dustRing(playerGround(x, y), DUST_PER_BURP)(state),
    PartShed: shed => shedParticles(state, shed),
    BossRoared: ({ x, y }) =>
      dustRing({ x, y }, RATTLE_DUST_PER_WARNING * 2)(state),
    BossWoundUp: () => noParticles(state),
    BossStomped: stomped => stompParticles(state, stomped),
    BossBelched: belched => belchParticles(state, belched),
    BossRushed: ({ x, y }) =>
      dustRing(zombieGround(x, y, 'Boss'), RUSH_DUST)(state),
    BossRammed: () => noParticles(state),
    BossBonked: bonked => bonkParticles(state, bonked),
    BossSpat: ({ x, y }) =>
      generateMany(
        state,
        SPIT_GOO,
        droplet('Goo', { x, y }, Math.PI / 2, Math.PI, GOO_BURST_SPEED),
      ),
    GlobLanded: landed => splatParticles(state, landed),
    BossEnraged: ({ x, y }) =>
      dustRing(zombieGround(x, y, 'Boss'), STOMP_DUST)(state),
    ZombieGrabbed: () => noParticles(state),
    ShieldRaised: () => noParticles(state),
    ZombieThrown: ({ x, y }) =>
      dustRing(zombieGround(x, y, 'Thrower'), THROW_DUST)(state),
    ZombieLanded: ({ x, y }) =>
      chain(state, [
        dustRing({ x, y }, LANDING_DUST),
        drawState => generateMany(drawState, LANDING_CHIPS, chip({ x, y }, 0)),
      ]),
    CrawlerStirred: ({ x, y }) => dustRing({ x, y }, STIR_DUST)(state),
    CrawlerSurfaced: ({ x, y }) =>
      chain(state, [
        dustRing({ x, y }, SURFACE_DUST),
        drawState =>
          generateMany(
            drawState,
            SURFACE_SPLINTERS,
            woodBit('Splinter', { x, y }),
          ),
        drawState => generateMany(drawState, SURFACE_CHIPS, chip({ x, y }, 0)),
      ]),
    AnklesGrabbed: ({ x, y }) => dustRing(playerGround(x, y), GRAB_DUST)(state),
    PackFrenzied: ({ x, y }) =>
      dustRing({ x, y }, RATTLE_DUST_PER_WARNING)(state),
    PackWiped: ({ x, y }) => generateMany(state, WIPE_COINS, coin({ x, y })),
    OvenBelched: ({ x, y }) =>
      chain(state, [
        drawState =>
          generateMany(drawState, OVEN_SMOKE, smokePuff({ x, y: y + 4 })),
        sparks({ x, y: y + 6 }, OVEN_SPARKS),
      ]),
    Purchased: ({ x, y }) =>
      generateMany(state, COINS_PER_PURCHASE, coin(playerGround(x, y))),
    PurchaseRefused: () => noParticles(state),
    ExitOpened: ({ x, y }) => smashParticles(state, { x, y }),
    FridgeOpened: ({ x, y }) =>
      generateMany(state, FRIDGE_FOG, fogPuff({ x, y: y + 14 })),
    FridgeSlammed: ({ x, y }) => dustRing({ x, y: y + 16 }, SLAM_DUST)(state),
    PrizeTaken: ({ x, y }) => sparks({ x, y: y + 14 }, LID_SPARKS)(state),
    PrizeLeft: ({ x, y }) =>
      generateMany(state, DUD_FOG, fogPuff({ x, y: y + 14 })),
    DudBurped: () => noParticles(state),
    LidLaunched: ({ x, y }) =>
      generateMany(state, LAUNCH_STEAM, smokePuff(playerGround(x, y))),
    LidBlasted: ({ x, y }) =>
      chain(state, [
        drawState => generateMany(drawState, LID_SMOKE, smokePuff({ x, y })),
        sparks({ x, y }, LID_SPARKS),
        dustRing({ x, y }, LID_DUST),
      ]),
    CookerPopped: ({ x, y }) =>
      chain(state, [
        drawState =>
          generateMany(drawState, POP_STEAM, smokePuff(playerGround(x, y))),
        sparks(playerGround(x, y), POP_SPARKS),
      ]),
    PanSwung: () => noParticles(state),
    PanClanged: ({ x, y }) => sparks({ x, y }, CLANG_SPARKS)(state),
    PanSmashed: ({ x, y }) =>
      dustRing(playerGround(x, y), PAN_SMASH_DUST)(state),
    PanFlattened: ({ x, y }) =>
      sparks(playerGround(x, y), FLATTEN_SPARKS)(state),
    KnifeStabbed: () => noParticles(state),
    KnifeHit: ({ x, y }) => sparks({ x, y }, KNIFE_SPARKS)(state),
    HomeRun: ({ x, y }) => sparks({ x, y }, HOME_RUN_SPARKS)(state),
    FreezeSprayed: ({ x, y, direction }) =>
      generateMany(
        state,
        FREEZE_FROST,
        frostBit(playerGround(x, y), angleOf(direction), FREEZE_SPREAD),
      ),
    ZombieFrozen: ({ x, y }) =>
      generateMany(state, FROZEN_FROST, frostBit({ x, y }, 0, Math.PI * 2)),
    ZombieShattered: ({ x, y }) =>
      generateMany(state, SHATTER_ICE, gib('IceGib', { x, y }, ZERO_VECTOR)),
    ZombieSlipped: ({ x, y }) =>
      generateMany(
        state,
        SLIP_SPLASH,
        droplet('Goo', { x, y }, Math.PI / 2, Math.PI * 2, GOO_BURST_SPEED),
      ),
    PlayerDowned: ({ x, y }) =>
      generateMany(
        state,
        DUST_PER_HURT,
        dustPuff(
          playerGround(x, y),
          0,
          Math.PI * 2,
          DUST_HURT_SPEED_MIN,
        )(DUST_HURT_SPEED_MAX),
      ),
    PlayerRevived: ({ x, y }) => dustRing(playerGround(x, y), GRAB_DUST)(state),
    FriendlyFire: ({ x, y }) =>
      generateMany(
        state,
        DUST_PER_HURT,
        dustPuff(
          playerGround(x, y),
          0,
          Math.PI * 2,
          DUST_HURT_SPEED_MIN,
        )(DUST_HURT_SPEED_MAX),
      ),
  })

type Spawn = Readonly<{
  rngState: number
  dustCooldownMs: number
  particles: ReadonlyArray<Particle>
}>

const walkingDust = (
  model: Model,
  deltaMs: number,
  rngState: number,
): Spawn => {
  const { player, intent } = model
  if (vectorLength(intent.move) <= 0) {
    return { rngState, dustCooldownMs: 0, particles: [] }
  }

  const dustCooldownMs = model.dustCooldownMs - deltaMs
  if (dustCooldownMs > 0) {
    return { rngState, dustCooldownMs, particles: [] }
  }

  const heading = angleOf(intent.move) + Math.PI
  const [nextState, particles] = generateMany(
    rngState,
    1,
    dustPuff(
      playerGround(player.x, player.y),
      heading,
      Math.PI / 2,
      DUST_SPEED_MIN,
    )(DUST_SPEED_MAX),
  )
  return {
    rngState: nextState,
    dustCooldownMs: dustCooldownMs + DUST_INTERVAL_MS,
    particles,
  }
}

const scorchDecals = (event: GameEvent): ReadonlyArray<Decal> =>
  GameEvent.isAnyOf(['Exploded', 'LidBlasted'])(event)
    ? [
        {
          kind: 'Scorch',
          x: Math.round(event.x),
          y: Math.round(event.y + ZOMBIE_FOOT_OFFSET),
          width: SCORCH_SIZE_PX,
          height: SCORCH_SIZE_PX / 2,
        },
        {
          kind: 'Scorch',
          x: Math.round(event.x),
          y: Math.round(event.y + ZOMBIE_FOOT_OFFSET),
          width: SCORCH_SIZE_PX / 2,
          height: SCORCH_SIZE_PX * 0.75,
        },
      ]
    : []

// FRAME

const keepNewest = <A>(
  items: ReadonlyArray<A>,
  max: number,
): ReadonlyArray<A> =>
  items.length > max ? Array.takeRight(items, max) : items

export const advanceParticles = (
  model: Model,
  seconds: number,
  deltaMs: number,
): Model => {
  const [stillFlying, leftBehind] = Array.partition(
    model.particles,
    stepParticle(levelOf(model), seconds, deltaMs),
  )
  const landed = [
    ...Array.flatMap(model.frameEvents, scorchDecals),
    ...Array.getSomes(leftBehind),
  ]

  const [eventState, eventBatches] = Array.mapAccum(
    model.frameEvents,
    model.cosmeticRngState,
    eventParticles,
  )
  const dust = walkingDust(model, deltaMs, eventState)

  return modifyFields(model, {
    particles: () =>
      keepNewest(
        [...stillFlying, ...Array.flatten(eventBatches), ...dust.particles],
        PARTICLE_MAX,
      ),
    decals: decals =>
      Array.isReadonlyArrayEmpty(landed)
        ? decals
        : keepNewest([...decals, ...landed], DECAL_MAX),
    cosmeticRngState: () => dust.rngState,
    dustCooldownMs: () => dust.dustCooldownMs,
  })
}

export const burstCoins = (model: Model, x: number, y: number): Model => {
  const [rngState, coins] = generateMany(
    model.cosmeticRngState,
    COINS_PER_PURCHASE,
    coin(playerGround(x, y)),
  )
  return modifyFields(model, {
    particles: particles => keepNewest([...particles, ...coins], PARTICLE_MAX),
    cosmeticRngState: () => rngState,
  })
}

// NOTE: the boards over an exit the player buys open burst into splinters
// and planks with a cloud of dust.

export const puffDust = (model: Model, x: number, y: number): Model => {
  const [rngState, puffs] = dustRing(
    { x, y },
    DUST_PER_PLACEMENT,
  )(model.cosmeticRngState)
  return modifyFields(model, {
    particles: particles => keepNewest([...particles, ...puffs], PARTICLE_MAX),
    cosmeticRngState: () => rngState,
  })
}

export const dropClip = (model: Model): Model => {
  const { player } = model
  const clips = clipParticles(
    player.x,
    player.y,
    player.facing,
    heldWeapon(player.arsenal),
  )
  return Array.isReadonlyArrayEmpty(clips)
    ? model
    : modifyFields(model, {
        particles: particles =>
          keepNewest([...particles, ...clips], PARTICLE_MAX),
      })
}
