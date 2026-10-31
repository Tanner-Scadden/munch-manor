import { Array, Option } from 'effect'

import {
  BLOOD_LIFETIME_MS,
  BLOOD_LIFT_MAX,
  BLOOD_LIFT_MIN,
  BLOOD_PER_BLAST,
  BLOOD_SPEED_MAX,
  BLOOD_SPEED_MIN,
  BOMB_SHARDS_PER_BLAST,
  CHIP_HEIGHT,
  CHIP_LIFETIME_MS,
  CHIP_LIFT_MAX,
  CHIP_LIFT_MIN,
  CHIP_SPEED_MAX,
  CHIP_SPEED_MIN,
  CHIP_SPREAD,
  CLIP_DROP_SPEED,
  CLIP_LIFETIME_MS,
  CLIP_LIFT,
  COIN_LIFETIME_MS,
  COIN_LIFT_MAX,
  COIN_LIFT_MIN,
  COIN_SPEED_MAX,
  COIN_SPEED_MIN,
  DUST_HURT_SPEED_MAX,
  DUST_HURT_SPEED_MIN,
  DUST_LIFETIME_MAX_MS,
  DUST_LIFETIME_MIN_MS,
  DUST_LIFT,
  DUST_PER_HURT,
  DUST_SPEED_MAX,
  DUST_SPEED_MIN,
  GIB_FORWARD_PUSH,
  GIB_LIFETIME_MS,
  GIB_LIFT_MAX,
  GIB_LIFT_MIN,
  GIB_SPEED_MAX,
  GIB_SPEED_MIN,
  GOO_SPEED_MAX,
  GOO_SPEED_MIN,
  MEAT_GIBS_PER_BLAST,
  PLANKS_PER_BREAK,
  PLANKS_PER_CRACK,
  PLANK_LIFETIME_MS,
  PLANK_LIFT_MAX,
  PLANK_LIFT_MIN,
  PLANK_SPEED_MAX,
  PLANK_SPEED_MIN,
  PLAYER_FOOT_OFFSET,
  SHELL_EJECT_SPEED_MAX,
  SHELL_EJECT_SPEED_MIN,
  SHELL_KICK_BACK,
  SHELL_LIFETIME_MS,
  SHELL_LIFT_MAX,
  SHELL_LIFT_MIN,
  SPARKS_PER_BLAST,
  SPARKS_PER_CLANG,
  SPARKS_PER_TURRET_BREAK,
  SPARK_LIFETIME_MS,
  SPARK_LIFT_MAX,
  SPARK_LIFT_MIN,
  SPARK_SPEED_MAX,
  SPARK_SPEED_MIN,
  SPLINTERS_PER_BREAK,
  SPLINTERS_PER_CRACK,
  SPLINTER_LIFETIME_MS,
  SPLINTER_LIFT_MAX,
  SPLINTER_LIFT_MIN,
  SPLINTER_SPEED_MAX,
  SPLINTER_SPEED_MIN,
  ZOMBIE_FOOT_OFFSET,
} from './constants'
import type {
  Particle,
  ParticleKind,
  TrapKind,
  Vector,
  WeaponKind,
  ZombieKind,
} from './model'
import { LAUNCH_SIZE } from './particlePhysics'
import { type Seeded, between, generateMany, nextRandom } from './prng'
import { WEAPONS } from './weapons'
import { type WearStage, ZOMBIE_KINDS, isArmorPart } from './zombies'

// SPAWNING

type Launch = Readonly<{
  kind: ParticleKind
  ground: Vector
  height: number
  angle: number
  speed: number
  lift: number
  size: number
  lifetimeMs: number
}>

const launch = ({
  kind,
  ground,
  height,
  angle,
  speed,
  lift,
  size,
  lifetimeMs,
}: Launch): Particle => ({
  kind,
  x: ground.x,
  y: ground.y,
  z: height,
  velocityX: Math.cos(angle) * speed,
  velocityY: Math.sin(angle) * speed,
  velocityZ: lift,
  size,
  remainingMs: lifetimeMs,
})

export const angleOf = ({ x, y }: Vector): number => Math.atan2(y, x)

export const zombieGround = (
  x: number,
  y: number,
  kind: ZombieKind,
): Vector => ({
  x,
  y: y + ZOMBIE_KINDS[kind].footOffset,
})

export const playerGround = (x: number, y: number): Vector => ({
  x,
  y: y + PLAYER_FOOT_OFFSET,
})

type Speed = Readonly<{ min: number; max: number }>

export const BLOOD_SPEED: Speed = { min: BLOOD_SPEED_MIN, max: BLOOD_SPEED_MAX }
export const GOO_BURST_SPEED: Speed = { min: GOO_SPEED_MIN, max: GOO_SPEED_MAX }

export const droplet =
  (
    kind: ParticleKind,
    ground: Vector,
    heading: number,
    spread: number,
    speed: Speed,
  ) =>
  (state: number): Seeded<Particle> => {
    const angleDraw = nextRandom(state)
    const speedDraw = nextRandom(angleDraw.nextState)
    const liftDraw = nextRandom(speedDraw.nextState)
    const sizeDraw = nextRandom(liftDraw.nextState)
    return [
      sizeDraw.nextState,
      launch({
        kind,
        ground,
        height: ZOMBIE_FOOT_OFFSET,
        angle: heading + (angleDraw.value - 0.5) * spread,
        speed: between(speedDraw.value, speed.min, speed.max),
        lift: between(liftDraw.value, BLOOD_LIFT_MIN, BLOOD_LIFT_MAX),
        size: 1 + Math.floor(sizeDraw.value * 2),
        lifetimeMs: BLOOD_LIFETIME_MS,
      }),
    ]
  }

const spark =
  (ground: Vector, height = ZOMBIE_FOOT_OFFSET) =>
  (state: number): Seeded<Particle> => {
    const angleDraw = nextRandom(state)
    const speedDraw = nextRandom(angleDraw.nextState)
    const liftDraw = nextRandom(speedDraw.nextState)
    return [
      liftDraw.nextState,
      launch({
        kind: 'Spark',
        ground,
        height,
        angle: angleDraw.value * Math.PI * 2,
        speed: between(speedDraw.value, SPARK_SPEED_MIN, SPARK_SPEED_MAX),
        lift: between(liftDraw.value, SPARK_LIFT_MIN, SPARK_LIFT_MAX),
        size: LAUNCH_SIZE.Spark,
        lifetimeMs: SPARK_LIFETIME_MS,
      }),
    ]
  }

export const gib =
  (kind: ParticleKind, ground: Vector, push: Vector) =>
  (state: number): Seeded<Particle> => {
    const angleDraw = nextRandom(state)
    const speedDraw = nextRandom(angleDraw.nextState)
    const liftDraw = nextRandom(speedDraw.nextState)
    const sizeDraw = nextRandom(liftDraw.nextState)
    const angle = angleDraw.value * Math.PI * 2
    const speed = between(speedDraw.value, GIB_SPEED_MIN, GIB_SPEED_MAX)
    return [
      sizeDraw.nextState,
      {
        kind,
        x: ground.x,
        y: ground.y,
        z: ZOMBIE_FOOT_OFFSET,
        velocityX: Math.cos(angle) * speed + push.x * GIB_FORWARD_PUSH,
        velocityY: Math.sin(angle) * speed + push.y * GIB_FORWARD_PUSH,
        velocityZ: between(liftDraw.value, GIB_LIFT_MIN, GIB_LIFT_MAX),
        size: 2 + Math.floor(sizeDraw.value * 2),
        remainingMs: GIB_LIFETIME_MS,
      },
    ]
  }

export const shellCasing =
  (ground: Vector, facing: Vector, kind: ParticleKind) =>
  (state: number): Seeded<Particle> => {
    const speedDraw = nextRandom(state)
    const liftDraw = nextRandom(speedDraw.nextState)
    const ejectAngle = angleOf({
      x: -facing.y - facing.x * SHELL_KICK_BACK,
      y: facing.x - facing.y * SHELL_KICK_BACK,
    })
    return [
      liftDraw.nextState,
      launch({
        kind,
        ground,
        height: PLAYER_FOOT_OFFSET,
        angle: ejectAngle,
        speed: between(
          speedDraw.value,
          SHELL_EJECT_SPEED_MIN,
          SHELL_EJECT_SPEED_MAX,
        ),
        lift: between(liftDraw.value, SHELL_LIFT_MIN, SHELL_LIFT_MAX),
        size: LAUNCH_SIZE[kind],
        lifetimeMs: SHELL_LIFETIME_MS,
      }),
    ]
  }

const CLIP_DROP_TURN = Math.PI * 0.75

const spentClip = (
  ground: Vector,
  facing: Vector,
  kind: ParticleKind,
): Particle =>
  launch({
    kind,
    ground,
    height: PLAYER_FOOT_OFFSET,
    angle: angleOf(facing) + CLIP_DROP_TURN,
    speed: CLIP_DROP_SPEED,
    lift: CLIP_LIFT,
    size: LAUNCH_SIZE[kind],
    lifetimeMs: CLIP_LIFETIME_MS,
  })

export const clipParticles = (
  x: number,
  y: number,
  facing: Vector,
  weapon: WeaponKind,
): ReadonlyArray<Particle> =>
  Option.match(WEAPONS[weapon].maybeSpentClip, {
    onNone: () => [],
    onSome: kind => [spentClip(playerGround(x, y), facing, kind)],
  })

export const dustPuff =
  (ground: Vector, heading: number, spread: number, minSpeed: number) =>
  (maxSpeed: number) =>
  (state: number): Seeded<Particle> => {
    const angleDraw = nextRandom(state)
    const speedDraw = nextRandom(angleDraw.nextState)
    const lifetimeDraw = nextRandom(speedDraw.nextState)
    return [
      lifetimeDraw.nextState,
      launch({
        kind: 'Dust',
        ground,
        height: 0,
        angle: heading + (angleDraw.value - 0.5) * spread,
        speed: between(speedDraw.value, minSpeed, maxSpeed),
        lift: DUST_LIFT,
        size: 2,
        lifetimeMs: between(
          lifetimeDraw.value,
          DUST_LIFETIME_MIN_MS,
          DUST_LIFETIME_MAX_MS,
        ),
      }),
    ]
  }

const SMOKE_SPEED_MIN = 10
const SMOKE_SPEED_MAX = 34
const SMOKE_LIFETIME_MIN_MS = 420
const SMOKE_LIFETIME_MAX_MS = 760

export const smokePuff =
  (ground: Vector) =>
  (state: number): Seeded<Particle> => {
    const angleDraw = nextRandom(state)
    const speedDraw = nextRandom(angleDraw.nextState)
    const lifetimeDraw = nextRandom(speedDraw.nextState)
    return [
      lifetimeDraw.nextState,
      launch({
        kind: 'Smoke',
        ground,
        height: ZOMBIE_FOOT_OFFSET,
        angle: angleDraw.value * Math.PI * 2,
        speed: between(speedDraw.value, SMOKE_SPEED_MIN, SMOKE_SPEED_MAX),
        lift: 4,
        size: LAUNCH_SIZE.Smoke,
        lifetimeMs: between(
          lifetimeDraw.value,
          SMOKE_LIFETIME_MIN_MS,
          SMOKE_LIFETIME_MAX_MS,
        ),
      }),
    ]
  }

// NOTE: the fridge's green fog, slow and low, and Brain Freeze's frost.
const FOG_SPEED_MIN = 6
const FOG_SPEED_MAX = 26
const FOG_LIFETIME_MIN_MS = 600
const FOG_LIFETIME_MAX_MS = 1100

export const fogPuff =
  (ground: Vector) =>
  (state: number): Seeded<Particle> => {
    const angleDraw = nextRandom(state)
    const speedDraw = nextRandom(angleDraw.nextState)
    const lifetimeDraw = nextRandom(speedDraw.nextState)
    return [
      lifetimeDraw.nextState,
      launch({
        kind: 'Fog',
        ground,
        height: 6,
        angle: angleDraw.value * Math.PI * 2,
        speed: between(speedDraw.value, FOG_SPEED_MIN, FOG_SPEED_MAX),
        lift: 2,
        size: LAUNCH_SIZE.Fog,
        lifetimeMs: between(
          lifetimeDraw.value,
          FOG_LIFETIME_MIN_MS,
          FOG_LIFETIME_MAX_MS,
        ),
      }),
    ]
  }

const FROST_SPEED_MIN = 50
const FROST_SPEED_MAX = 110
const FROST_LIFETIME_MS = 420

export const frostBit =
  (ground: Vector, heading: number, spread: number) =>
  (state: number): Seeded<Particle> => {
    const angleDraw = nextRandom(state)
    const speedDraw = nextRandom(angleDraw.nextState)
    return [
      speedDraw.nextState,
      launch({
        kind: 'Frost',
        ground,
        height: PLAYER_FOOT_OFFSET,
        angle: heading + (angleDraw.value - 0.5) * spread,
        speed: between(speedDraw.value, FROST_SPEED_MIN, FROST_SPEED_MAX),
        lift: 6,
        size: LAUNCH_SIZE.Frost,
        lifetimeMs: FROST_LIFETIME_MS,
      }),
    ]
  }

export const FRIDGE_FOG = 12
export const DUD_FOG = 4
export const SLAM_DUST = 10
export const LAUNCH_STEAM = 3
export const LID_SMOKE = 6
export const LID_SPARKS = 8
export const LID_DUST = 6
export const POP_STEAM = 6
export const POP_SPARKS = 4
export const CLANG_SPARKS = 3
export const KNIFE_SPARKS = 2
export const PAN_SMASH_DUST = 14
export const FLATTEN_SPARKS = 4
export const HOME_RUN_SPARKS = 6
export const FREEZE_FROST = 16
export const FREEZE_SPREAD = 1
export const FROZEN_FROST = 4
export const SHATTER_ICE = 9

export const chip =
  (ground: Vector, heading: number) =>
  (state: number): Seeded<Particle> => {
    const angleDraw = nextRandom(state)
    const speedDraw = nextRandom(angleDraw.nextState)
    const liftDraw = nextRandom(speedDraw.nextState)
    return [
      liftDraw.nextState,
      launch({
        kind: 'Chip',
        ground,
        height: CHIP_HEIGHT,
        angle: heading + (angleDraw.value - 0.5) * CHIP_SPREAD,
        speed: between(speedDraw.value, CHIP_SPEED_MIN, CHIP_SPEED_MAX),
        lift: between(liftDraw.value, CHIP_LIFT_MIN, CHIP_LIFT_MAX),
        size: 1,
        lifetimeMs: CHIP_LIFETIME_MS,
      }),
    ]
  }

export const coin =
  (ground: Vector) =>
  (state: number): Seeded<Particle> => {
    const angleDraw = nextRandom(state)
    const speedDraw = nextRandom(angleDraw.nextState)
    const liftDraw = nextRandom(speedDraw.nextState)
    return [
      liftDraw.nextState,
      launch({
        kind: 'Coin',
        ground,
        height: PLAYER_FOOT_OFFSET,
        angle: angleDraw.value * Math.PI * 2,
        speed: between(speedDraw.value, COIN_SPEED_MIN, COIN_SPEED_MAX),
        lift: between(liftDraw.value, COIN_LIFT_MIN, COIN_LIFT_MAX),
        size: LAUNCH_SIZE.Coin,
        lifetimeMs: COIN_LIFETIME_MS,
      }),
    ]
  }

export const woodBit =
  (kind: ParticleKind, ground: Vector) =>
  (state: number): Seeded<Particle> => {
    const angleDraw = nextRandom(state)
    const speedDraw = nextRandom(angleDraw.nextState)
    const liftDraw = nextRandom(speedDraw.nextState)
    const isPlank = kind === 'Plank'
    return [
      liftDraw.nextState,
      launch({
        kind,
        ground,
        height: CHIP_HEIGHT,
        angle: angleDraw.value * Math.PI * 2,
        speed: isPlank
          ? between(speedDraw.value, PLANK_SPEED_MIN, PLANK_SPEED_MAX)
          : between(speedDraw.value, SPLINTER_SPEED_MIN, SPLINTER_SPEED_MAX),
        lift: isPlank
          ? between(liftDraw.value, PLANK_LIFT_MIN, PLANK_LIFT_MAX)
          : between(liftDraw.value, SPLINTER_LIFT_MIN, SPLINTER_LIFT_MAX),
        size: LAUNCH_SIZE[kind],
        lifetimeMs: isPlank ? PLANK_LIFETIME_MS : SPLINTER_LIFETIME_MS,
      }),
    ]
  }

export const noParticles = (state: number): Seeded<ReadonlyArray<Particle>> => [
  state,
  [],
]

export const withState = (
  state: number,
  particles: ReadonlyArray<Particle>,
): Seeded<ReadonlyArray<Particle>> => [state, particles]

export const chain = (
  state: number,
  batches: ReadonlyArray<
    (drawState: number) => Seeded<ReadonlyArray<Particle>>
  >,
): Seeded<ReadonlyArray<Particle>> => {
  const [nextState, particles] = Array.mapAccum(
    batches,
    state,
    (drawState, batch) => batch(drawState),
  )
  return [nextState, Array.flatten(particles)]
}

export const killParticles = (
  state: number,
  {
    x,
    y,
    direction,
    kind,
  }: Readonly<{ x: number; y: number; direction: Vector; kind: ZombieKind }>,
): Seeded<ReadonlyArray<Particle>> => {
  const ground = zombieGround(x, y, kind)
  const stats = ZOMBIE_KINDS[kind]
  return chain(state, [
    ...Array.map(
      stats.gibs,
      gibs => (drawState: number) =>
        generateMany(drawState, gibs.count, gib(gibs.kind, ground, direction)),
    ),
    drawState =>
      generateMany(
        drawState,
        stats.bloodPerKill,
        droplet('Blood', ground, angleOf(direction), Math.PI * 2, BLOOD_SPEED),
      ),
  ])
}

export const NO_PUSH: Vector = { x: 0, y: 0 }

const PART_SPEED_MIN = 45
const PART_SPEED_MAX = 80
const PART_SPREAD = 1.1
const PART_LIFT_MIN = 80
const PART_LIFT_MAX = 125
const BLOOD_PER_PART = 6

const flyingPart =
  (kind: ParticleKind, ground: Vector, heading: number, heightPx: number) =>
  (state: number): Seeded<Particle> => {
    const angleDraw = nextRandom(state)
    const speedDraw = nextRandom(angleDraw.nextState)
    const liftDraw = nextRandom(speedDraw.nextState)
    return [
      liftDraw.nextState,
      launch({
        kind,
        ground,
        height: heightPx,
        angle: heading + (angleDraw.value - 0.5) * PART_SPREAD,
        speed: between(speedDraw.value, PART_SPEED_MIN, PART_SPEED_MAX),
        lift: between(liftDraw.value, PART_LIFT_MIN, PART_LIFT_MAX),
        size: LAUNCH_SIZE[kind],
        lifetimeMs: GIB_LIFETIME_MS,
      }),
    ]
  }

const wearStageAt = (
  kind: ZombieKind,
  stage: number,
): Option.Option<WearStage> => Array.get(ZOMBIE_KINDS[kind].wear, stage)

export const shedParticles = (
  state: number,
  {
    x,
    y,
    direction,
    kind,
    stage,
  }: Readonly<{
    x: number
    y: number
    direction: Vector
    kind: ZombieKind
    stage: number
  }>,
): Seeded<ReadonlyArray<Particle>> =>
  Option.match(wearStageAt(kind, stage), {
    onNone: () => noParticles(state),
    onSome: ({ part, heightPx }) => {
      const ground = zombieGround(x, y, kind)
      const heading = angleOf(direction)
      if (isArmorPart(part)) {
        return chain(state, [
          drawState =>
            generateMany(
              drawState,
              1,
              flyingPart(part, ground, heading, heightPx),
            ),
          drawState =>
            generateMany(drawState, SPARKS_PER_CLANG, spark(ground, heightPx)),
        ])
      }
      return chain(state, [
        drawState =>
          generateMany(
            drawState,
            1,
            flyingPart(part, ground, heading, heightPx),
          ),
        drawState =>
          generateMany(
            drawState,
            BLOOD_PER_PART,
            droplet('Blood', ground, heading, Math.PI, BLOOD_SPEED),
          ),
        drawState =>
          generateMany(drawState, 1, gib('MeatGib', ground, direction)),
      ])
    },
  })

export const THROW_DUST = 4
export const LANDING_DUST = 10
export const LANDING_CHIPS = 6
export const STIR_DUST = 4
export const SURFACE_DUST = 12
export const SURFACE_SPLINTERS = 6
export const SURFACE_CHIPS = 6
export const GRAB_DUST = 6
export const WIPE_COINS = 8

export const STOMP_DUST = 14
const STOMP_CHIPS = 8
const BELCH_GOO = 10

export const stompParticles = (
  state: number,
  { x, y, radius }: Readonly<{ x: number; y: number; radius: number }>,
): Seeded<ReadonlyArray<Particle>> => {
  const ground = zombieGround(x, y, 'Boss')
  return chain(state, [
    dustRing(ground, STOMP_DUST),
    drawState => generateMany(drawState, STOMP_CHIPS, chip(ground, 0)),
    drawState =>
      generateMany(
        drawState,
        STOMP_CHIPS,
        dustPuff(ground, 0, Math.PI * 2, radius)(radius * 2),
      ),
  ])
}

export const RUSH_DUST = 6
const BONK_CHIPS = 8
export const SPIT_GOO = 4
const SPLAT_GOO = 10

export const bonkParticles = (
  state: number,
  { x, y }: Readonly<{ x: number; y: number }>,
): Seeded<ReadonlyArray<Particle>> => {
  const ground = zombieGround(x, y, 'Boss')
  return chain(state, [
    dustRing(ground, STOMP_DUST),
    drawState => generateMany(drawState, BONK_CHIPS, chip(ground, 0)),
  ])
}

export const splatParticles = (
  state: number,
  { x, y }: Readonly<{ x: number; y: number }>,
): Seeded<ReadonlyArray<Particle>> =>
  generateMany(
    state,
    SPLAT_GOO,
    droplet('Goo', { x, y }, 0, Math.PI * 2, GOO_BURST_SPEED),
  )

export const belchParticles = (
  state: number,
  { x, y }: Readonly<{ x: number; y: number }>,
): Seeded<ReadonlyArray<Particle>> =>
  generateMany(
    state,
    BELCH_GOO,
    droplet('Goo', { x, y }, Math.PI / 2, Math.PI * 2, GOO_BURST_SPEED),
  )

const SMOKE_PER_BLAST = 6
export const OVEN_SMOKE = 4
export const OVEN_SPARKS = 8
export const SLIP_SPLASH = 5
const SMASH_SPLINTERS = 14
const SMASH_PLANKS = 6
const SMASH_DUST = 10

// NOTE: the boards over an exit bought open burst into splinters and
// planks with a cloud of dust.
export const smashParticles = (
  state: number,
  ground: Vector,
): Seeded<ReadonlyArray<Particle>> =>
  chain(state, [
    woodBits('Splinter', ground, SMASH_SPLINTERS),
    woodBits('Plank', ground, SMASH_PLANKS),
    dustRing(ground, SMASH_DUST),
  ])

export const blastParticles = (
  state: number,
  { x, y }: Readonly<{ x: number; y: number }>,
): Seeded<ReadonlyArray<Particle>> => {
  const ground = { x, y: y + ZOMBIE_FOOT_OFFSET }
  return chain(state, [
    drawState => generateMany(drawState, SMOKE_PER_BLAST, smokePuff(ground)),
    drawState =>
      generateMany(
        drawState,
        BLOOD_PER_BLAST,
        droplet('Blood', ground, 0, Math.PI * 2, GOO_BURST_SPEED),
      ),
    drawState => generateMany(drawState, SPARKS_PER_BLAST, spark(ground)),
    drawState =>
      generateMany(
        drawState,
        MEAT_GIBS_PER_BLAST,
        gib('MeatGib', ground, NO_PUSH),
      ),
    drawState =>
      generateMany(
        drawState,
        BOMB_SHARDS_PER_BLAST,
        gib('BombShard', ground, NO_PUSH),
      ),
  ])
}

export const footfallDust = (
  state: number,
  { x, y, kind }: Readonly<{ x: number; y: number; kind: ZombieKind }>,
): Seeded<ReadonlyArray<Particle>> =>
  Option.match(ZOMBIE_KINDS[kind].maybeFootfall, {
    onNone: () => noParticles(state),
    onSome: ({ dustPuffs }) =>
      generateMany(
        state,
        dustPuffs,
        dustPuff(
          zombieGround(x, y, kind),
          0,
          Math.PI * 2,
          DUST_SPEED_MIN,
        )(DUST_SPEED_MAX),
      ),
  })

export const woodBits =
  (kind: ParticleKind, ground: Vector, count: number) =>
  (drawState: number): Seeded<ReadonlyArray<Particle>> =>
    generateMany(drawState, count, woodBit(kind, ground))

export const dustRing =
  (ground: Vector, count: number) =>
  (drawState: number): Seeded<ReadonlyArray<Particle>> =>
    generateMany(
      drawState,
      count,
      dustPuff(
        ground,
        0,
        Math.PI * 2,
        DUST_HURT_SPEED_MIN,
      )(DUST_HURT_SPEED_MAX),
    )

type Batch = (drawState: number) => Seeded<ReadonlyArray<Particle>>

export const sparks =
  (ground: Vector, count: number): Batch =>
  drawState =>
    generateMany(drawState, count, spark(ground))

type Debris = Readonly<{
  crack: (ground: Vector) => Batch
  wreck: (ground: Vector) => Batch
}>

const TRAP_DEBRIS: Readonly<Record<TrapKind, Debris>> = {
  Barricade: {
    crack: ground => woodBits('Plank', ground, PLANKS_PER_CRACK),
    wreck: ground => woodBits('Plank', ground, PLANKS_PER_BREAK),
  },
  Turret: {
    crack: ground => sparks(ground, PLANKS_PER_CRACK),
    wreck: ground => sparks(ground, SPARKS_PER_TURRET_BREAK),
  },
}

type TrapAt = Readonly<{ x: number; y: number; kind: TrapKind }>

export const crackParticles = (
  state: number,
  { x, y, kind }: TrapAt,
): Seeded<ReadonlyArray<Particle>> =>
  chain(state, [
    woodBits('Splinter', { x, y }, SPLINTERS_PER_CRACK),
    TRAP_DEBRIS[kind].crack({ x, y }),
  ])

export const breakParticles = (
  state: number,
  { x, y, kind }: TrapAt,
): Seeded<ReadonlyArray<Particle>> =>
  chain(state, [
    woodBits('Splinter', { x, y }, SPLINTERS_PER_BREAK),
    TRAP_DEBRIS[kind].wreck({ x, y }),
    dustRing({ x, y }, DUST_PER_HURT),
  ])
