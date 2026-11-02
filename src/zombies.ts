import { Array, Option, Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

import {
  BLOOD_PER_KILL,
  MEAT_GIBS_PER_KILL,
  MS_PER_SECOND,
  ROT_GIBS_PER_KILL,
  SHAKE_TRAUMA_KILL,
  SHAMBLER_BOUNTY,
  ZOMBIE_DYING_MS,
  ZOMBIE_FOOT_OFFSET,
  ZOMBIE_MAX_HP,
  ZOMBIE_RADIUS,
  ZOMBIE_SHAMBLE_PHASE_PER_ID,
  ZOMBIE_SHAMBLE_PX_PER_FRAME,
  ZOMBIE_SPEED_MAX,
  ZOMBIE_SPEED_MIN,
} from './constants'
import { ZOMBIE_NAMES } from './names'
import type { Clearance } from './pathing'
import type { SoundEffect } from './soundEffect'
import {
  Frenzy,
  type ParticleKind,
  type Vector,
  type Zombie,
  ZombieAction,
  type ZombieKind,
  ZombieState,
} from './worldSchema'

// BEHAVIOR

export const Behavior = defineTaggedUnion({
  Brawler: {},
  Bomber: {
    shotFuseMs: Schema.Number,
    contactFuseMs: Schema.Number,
    chainFuseMs: Schema.Number,
    blastRadius: Schema.Number,
    playerDamage: Schema.Number,
    zombieDamage: Schema.Number,
    trapDamage: Schema.Number,
    blastKnockback: Schema.Number,
  },
  Thrower: {},
  Crawler: {},
})
export type Behavior = typeof Behavior.Type

export type DeathStyle = 'Topple' | 'Tumble' | 'Slump' | 'Burst'

export type Arrival = 'Door' | 'Floor'

type HealthBar = 'Shown' | 'Hidden'

// NOTE: a Drawn kind near a standing Plank Pile walks over and chews it
// instead of chasing the player. Only the slow kinds are that dim.
type BaitPull = 'Drawn' | 'Ignores'

type Gibs = Readonly<{ kind: ParticleKind; count: number }>

export type Footfall = Readonly<{
  everyStrides: number
  dustPuffs: number
  rangePx: number
  trauma: number
  maybeSound: Option.Option<SoundEffect>
}>

// NOTE: A wear stage comes off once health falls to its share of the most
// health, so a zombie's wear is read from hp and maxHp alone and each part
// comes off exactly once.
export type WearStage = Readonly<{
  below: number
  part: ParticleKind
  heightPx: number
}>

type ZombieKindStats = Readonly<{
  name: string
  tagline: string
  pitch: string
  speedMin: number
  speedMax: number
  hp: number
  contactDamage: number
  trapBitePerSecond: number
  radius: number
  bodyRadius: number
  footOffset: number
  bounty: number
  mass: number
  knockbackScale: number
  killTrauma: number
  behavior: Behavior
  clearance: Clearance
  deathStyle: DeathStyle
  dyingMs: number
  stridePx: number
  healthBar: HealthBar
  hitSpray: ParticleKind
  bloodPerKill: number
  gibs: ReadonlyArray<Gibs>
  hitSound: SoundEffect
  deathSound: SoundEffect
  maybeFootfall: Option.Option<Footfall>
  wear: ReadonlyArray<WearStage>
  arrival: Arrival
  bait: BaitPull
}>

// KINDS

export const ZOMBIE_KINDS: Readonly<Record<ZombieKind, ZombieKindStats>> = {
  Shambler: {
    name: ZOMBIE_NAMES.Shambler,
    tagline: 'SLOW AND HUNGRY',
    pitch: "HE'S SLOW. BACK UP AND KEEP SHOOTING.",
    speedMin: ZOMBIE_SPEED_MIN,
    speedMax: ZOMBIE_SPEED_MAX,
    hp: ZOMBIE_MAX_HP,
    contactDamage: 1,
    trapBitePerSecond: 3,
    radius: ZOMBIE_RADIUS,
    bodyRadius: ZOMBIE_RADIUS,
    footOffset: ZOMBIE_FOOT_OFFSET,
    bounty: SHAMBLER_BOUNTY,
    mass: 1,
    knockbackScale: 1,
    killTrauma: SHAKE_TRAUMA_KILL,
    behavior: Behavior.Brawler(),
    clearance: 'Narrow',
    deathStyle: 'Topple',
    dyingMs: ZOMBIE_DYING_MS,
    stridePx: ZOMBIE_SHAMBLE_PX_PER_FRAME,
    healthBar: 'Hidden',
    hitSpray: 'Blood',
    bloodPerKill: BLOOD_PER_KILL,
    gibs: [
      { kind: 'MeatGib', count: MEAT_GIBS_PER_KILL },
      { kind: 'RotGib', count: ROT_GIBS_PER_KILL },
    ],
    hitSound: 'ZombieHit',
    deathSound: 'ZombieDeath',
    maybeFootfall: Option.none(),
    wear: [
      { below: 2 / 3, part: 'GreenLimb', heightPx: 6 },
      { below: 1 / 3, part: 'GreenScalp', heightPx: 9 },
    ],
    arrival: 'Door',
    bait: 'Drawn',
  },
  Runner: {
    name: ZOMBIE_NAMES.Runner,
    tagline: 'FAST BUT FLIMSY',
    pitch: 'ZOOMS RIGHT AT YOU. ONE SHOT DROPS IT.',
    speedMin: 44,
    speedMax: 52,
    hp: 2,
    contactDamage: 1,
    trapBitePerSecond: 2,
    radius: 3.5,
    bodyRadius: 3.5,
    footOffset: ZOMBIE_FOOT_OFFSET,
    bounty: 3,
    mass: 0.6,
    knockbackScale: 1.4,
    killTrauma: 0.12,
    behavior: Behavior.Brawler(),
    clearance: 'Narrow',
    deathStyle: 'Tumble',
    dyingMs: 520,
    stridePx: 4,
    healthBar: 'Hidden',
    hitSpray: 'Blood',
    bloodPerKill: 5,
    gibs: [
      { kind: 'MeatGib', count: 2 },
      { kind: 'BoneGib', count: 3 },
    ],
    hitSound: 'RunnerHit',
    deathSound: 'RunnerDeath',
    maybeFootfall: Option.some({
      everyStrides: 2,
      dustPuffs: 1,
      rangePx: 0,
      trauma: 0,
      maybeSound: Option.none(),
    }),
    wear: [{ below: 1 / 2, part: 'HairScalp', heightPx: 10 }],
    arrival: 'Door',
    bait: 'Ignores',
  },
  Tank: {
    name: ZOMBIE_NAMES.Tank,
    tagline: 'ARMORED IN JUNK',
    pitch: "HE'S WEARING A KITCHEN. KNOCK IT OFF.",
    speedMin: 11,
    speedMax: 14,
    hp: 30,
    contactDamage: 2,
    trapBitePerSecond: 12,
    radius: 6.5,
    bodyRadius: 6.5,
    footOffset: 7,
    bounty: 20,
    mass: 6,
    knockbackScale: 0.12,
    killTrauma: 0.7,
    behavior: Behavior.Brawler(),
    clearance: 'Wide',
    deathStyle: 'Slump',
    dyingMs: 1000,
    stridePx: 2,
    healthBar: 'Shown',
    hitSpray: 'Blood',
    bloodPerKill: 8,
    gibs: [
      { kind: 'MeatGib', count: 7 },
      { kind: 'HideGib', count: 5 },
    ],
    hitSound: 'TankHit',
    deathSound: 'TankDeath',
    maybeFootfall: Option.some({
      everyStrides: 2,
      dustPuffs: 2,
      rangePx: 90,
      trauma: 0.22,
      maybeSound: Option.some('Stomp'),
    }),
    wear: [
      { below: 3 / 4, part: 'PotLid', heightPx: 12 },
      { below: 1 / 2, part: 'StopSign', heightPx: 9 },
      { below: 1 / 4, part: 'Bucket', heightPx: 16 },
    ],
    arrival: 'Door',
    bait: 'Drawn',
  },
  Exploder: {
    name: ZOMBIE_NAMES.Exploder,
    tagline: 'HE BROUGHT A BOMB TO SHARE',
    pitch: 'HE WANTS A HUG. POP HIM FROM FAR AWAY.',
    speedMin: 14,
    speedMax: 17,
    hp: 6,
    contactDamage: 0,
    trapBitePerSecond: 0,
    radius: 4.5,
    bodyRadius: 5.5,
    footOffset: ZOMBIE_FOOT_OFFSET,
    bounty: 4,
    mass: 1.8,
    knockbackScale: 0.6,
    killTrauma: 0.15,
    behavior: Behavior.Bomber({
      shotFuseMs: 200,
      contactFuseMs: 340,
      chainFuseMs: 150,
      blastRadius: 28,
      playerDamage: 1,
      zombieDamage: 6,
      trapDamage: 15,
      blastKnockback: 190,
    }),
    clearance: 'Narrow',
    deathStyle: 'Burst',
    dyingMs: 0,
    stridePx: 2,
    healthBar: 'Shown',
    hitSpray: 'Spark',
    bloodPerKill: 0,
    gibs: [
      { kind: 'BombShard', count: 3 },
      { kind: 'LimeLimb', count: 1 },
    ],
    hitSound: 'ExploderHit',
    deathSound: 'ExploderFuse',
    maybeFootfall: Option.none(),
    wear: [
      { below: 2 / 3, part: 'LimeLimb', heightPx: 6 },
      { below: 1 / 3, part: 'BombShard', heightPx: 5 },
    ],
    arrival: 'Door',
    bait: 'Ignores',
  },
  Thrower: {
    name: ZOMBIE_NAMES.Thrower,
    tagline: 'HE PITCHES ZOMBIES',
    pitch: 'HE PITCHES ZOMBIES. GET CLOSE AND HE HIDES BEHIND ONE.',
    speedMin: 13,
    speedMax: 16,
    hp: 14,
    contactDamage: 1,
    trapBitePerSecond: 4,
    radius: 4.5,
    bodyRadius: 5,
    footOffset: 6,
    bounty: 8,
    mass: 1.6,
    knockbackScale: 0.6,
    killTrauma: 0.3,
    behavior: Behavior.Thrower(),
    clearance: 'Narrow',
    deathStyle: 'Topple',
    dyingMs: 700,
    stridePx: 3,
    healthBar: 'Shown',
    hitSpray: 'Blood',
    bloodPerKill: 6,
    gibs: [
      { kind: 'MeatGib', count: 4 },
      { kind: 'RotGib', count: 2 },
    ],
    hitSound: 'ZombieHit',
    deathSound: 'ZombieDeath',
    maybeFootfall: Option.none(),
    wear: [
      { below: 2 / 3, part: 'RedCap', heightPx: 17 },
      { below: 1 / 3, part: 'MeatGib', heightPx: 10 },
    ],
    arrival: 'Door',
    bait: 'Ignores',
  },
  Crawler: {
    name: ZOMBIE_NAMES.Crawler,
    tagline: 'IT COMES UP THROUGH THE FLOOR',
    pitch: 'IT CLAWS UP THROUGH THE FLOOR AND GRABS YOUR ANKLES.',
    speedMin: 26,
    speedMax: 32,
    hp: 2,
    contactDamage: 0,
    trapBitePerSecond: 2,
    radius: 3.5,
    bodyRadius: 3.5,
    footOffset: 2,
    bounty: 3,
    mass: 0.6,
    knockbackScale: 1.3,
    killTrauma: 0.12,
    behavior: Behavior.Crawler(),
    clearance: 'Narrow',
    deathStyle: 'Slump',
    dyingMs: 450,
    stridePx: 3,
    healthBar: 'Hidden',
    hitSpray: 'Blood',
    bloodPerKill: 4,
    gibs: [
      { kind: 'MeatGib', count: 2 },
      { kind: 'BoneGib', count: 2 },
    ],
    hitSound: 'RunnerHit',
    deathSound: 'RunnerDeath',
    maybeFootfall: Option.none(),
    wear: [{ below: 1 / 2, part: 'PaleScalp', heightPx: 4 }],
    arrival: 'Floor',
    bait: 'Ignores',
  },
  Boss: {
    name: ZOMBIE_NAMES.Boss,
    tagline: 'STAY CLOSE. STEP OUT OF THE RED',
    pitch: 'HE STOMPS UP CLOSE. RUN FAR AND HE CHARGES AND SPITS.',
    speedMin: 10,
    speedMax: 11,
    hp: 90,
    contactDamage: 2,
    trapBitePerSecond: 20,
    radius: 8,
    bodyRadius: 12,
    footOffset: 12,
    bounty: 150,
    mass: 40,
    knockbackScale: 0.03,
    killTrauma: 1,
    behavior: Behavior.Brawler(),
    clearance: 'Wide',
    deathStyle: 'Slump',
    dyingMs: 1600,
    stridePx: 3,
    healthBar: 'Hidden',
    hitSpray: 'Blood',
    bloodPerKill: 24,
    gibs: [
      { kind: 'MeatGib', count: 12 },
      { kind: 'PinkChunk', count: 4 },
      { kind: 'PinkLimb', count: 2 },
    ],
    hitSound: 'TankHit',
    deathSound: 'BossDeath',
    maybeFootfall: Option.some({
      everyStrides: 2,
      dustPuffs: 3,
      rangePx: 140,
      trauma: 0.3,
      maybeSound: Option.some('Stomp'),
    }),
    wear: [
      { below: 0.8, part: 'PinkLimb', heightPx: 16 },
      { below: 0.6, part: 'PinkChunk', heightPx: 28 },
      { below: 0.4, part: 'PinkLimb', heightPx: 16 },
      { below: 0.2, part: 'PinkChunk', heightPx: 12 },
    ],
    arrival: 'Door',
    bait: 'Ignores',
  },
}

export const ZOMBIE_KIND_ORDER: ReadonlyArray<ZombieKind> = [
  'Shambler',
  'Runner',
  'Exploder',
  'Tank',
  'Thrower',
  'Crawler',
]

// NOTE: a kind's number, for the tables hot code reads by index. The World
// keeps the kind as its Schema literal; this reads two things off the string,
// its first letter and, for the two T kinds, its length. A lookup by string key
// costs several times as much in V8. zombies.test.ts checks every kind.
const KINDS_BY_INDEX: ReadonlyArray<ZombieKind> = [
  'Shambler',
  'Runner',
  'Tank',
  'Exploder',
  'Thrower',
  'Crawler',
  'Boss',
]

const FIRST_LETTER = 66
const LETTER_T = 84
const KIND_OF_LETTER = new Uint8Array(19)
KINDS_BY_INDEX.forEach((kind, index) => {
  if (kind.charCodeAt(0) !== LETTER_T) {
    KIND_OF_LETTER[kind.charCodeAt(0) - FIRST_LETTER] = index
  }
})

const kindIndex = (kind: ZombieKind): number => {
  const letter = kind.charCodeAt(0)
  return letter === LETTER_T
    ? kind.length === 4
      ? 2
      : 4
    : (KIND_OF_LETTER[letter - FIRST_LETTER] ?? 0)
}

const STATS_BY_INDEX: ReadonlyArray<ZombieKindStats> = Array.map(
  KINDS_BY_INDEX,
  kind => ZOMBIE_KINDS[kind],
)
const RADIUS_BY_INDEX = Float64Array.from(STATS_BY_INDEX, ({ radius }) => radius)
const BODY_RADIUS_BY_INDEX = Float64Array.from(
  STATS_BY_INDEX,
  ({ bodyRadius }) => bodyRadius,
)

export const statsOf = (zombie: Zombie): ZombieKindStats =>
  STATS_BY_INDEX[kindIndex(zombie.kind)] ?? ZOMBIE_KINDS[zombie.kind]

// NOTE: how near a footstep sounds to a listener, 1 underfoot to 0 at its
// kind's range; a kind with no range is never heard.
export const footfallNearness = (kind: ZombieKind, distance: number): number =>
  Option.match(ZOMBIE_KINDS[kind].maybeFootfall, {
    onNone: () => 0,
    onSome: ({ rangePx }) =>
      rangePx > 0 ? Math.max(0, Math.min(1, 1 - distance / rangePx)) : 0,
  })

export const radiusOf = (zombie: Zombie): number =>
  RADIUS_BY_INDEX[kindIndex(zombie.kind)] ?? statsOf(zombie).radius

export const bodyRadiusOf = (zombie: Zombie): number =>
  BODY_RADIUS_BY_INDEX[kindIndex(zombie.kind)] ?? statsOf(zombie).bodyRadius

export const isBoss = (zombie: Zombie): boolean => zombie.kind === 'Boss'

// WEAR

const WEAR_TOLERANCE = 1e-9

export const wearAt = (kind: ZombieKind, hp: number, maxHp: number): number => {
  const stages = STATS_BY_INDEX[kindIndex(kind)]?.wear ?? ZOMBIE_KINDS[kind].wear
  let worn = 0
  for (const { below } of stages) {
    if (hp <= maxHp * below + WEAR_TOLERANCE) {
      worn++
    }
  }
  return worn
}

const ARMOR_PARTS: ReadonlyArray<ParticleKind> = [
  'PotLid',
  'StopSign',
  'Bucket',
]

export const isArmorPart = (part: ParticleKind): boolean =>
  Array.contains(ARMOR_PARTS, part)

export const isArmorShedAt = (kind: ZombieKind, stage: number): boolean =>
  Option.match(Array.get(ZOMBIE_KINDS[kind].wear, stage), {
    onNone: () => false,
    onSome: ({ part }) => isArmorPart(part),
  })

export const wearOf = (zombie: Zombie): number =>
  wearAt(zombie.kind, zombie.hp, zombie.maxHp)

// STATE

export type DeathCause = 'Shot' | 'Blast'

export const deathState = (
  kind: ZombieKind,
  direction: Vector,
  cause: DeathCause,
): ZombieState =>
  Behavior.match(ZOMBIE_KINDS[kind].behavior, {
    Brawler: () =>
      ZombieState.Dying({
        remainingMs: ZOMBIE_KINDS[kind].dyingMs,
        direction,
      }),
    Bomber: ({ shotFuseMs, chainFuseMs }) =>
      ZombieState.Fusing({
        remainingMs: cause === 'Shot' ? shotFuseMs : chainFuseMs,
      }),
    Thrower: () =>
      ZombieState.Dying({
        remainingMs: ZOMBIE_KINDS[kind].dyingMs,
        direction,
      }),
    Crawler: () =>
      ZombieState.Dying({
        remainingMs: ZOMBIE_KINDS[kind].dyingMs,
        direction,
      }),
  })

export const isWalking = (zombie: Zombie): boolean =>
  ZombieState.isAnyOf(['Walking'])(zombie.state)

export const isFusing = (zombie: Zombie): boolean =>
  ZombieState.isAnyOf(['Fusing'])(zombie.state)

const isOnTheFloor = ZombieAction.isAnyOf([
  'Roaming',
  'Winded',
  'Hefting',
  'Shielding',
  'Dazed',
  'Clinging',
  'Frozen',
  'Chilled',
  'Reeling',
])

const isOnItsFeet = ZombieAction.isAnyOf(['Roaming', 'Winded', 'Chilled'])

// NOTE: a grounded zombie is alive and standing in the room, so bullets,
// bursts, traps, and the crowd can reach it. One Burrowed under the floor,
// Carried overhead, or Flying through the air is out of reach.
export const isGrounded = (zombie: Zombie): boolean =>
  isWalking(zombie) && isOnTheFloor(zombie.action)

// NOTE: a free zombie walks after the player and can bite. One busy heaving,
// dazed, or clinging stands still.
export const isFree = (zombie: Zombie): boolean =>
  isWalking(zombie) && isOnItsFeet(zombie.action)

export const arrivalOf = (kind: ZombieKind): Arrival =>
  ZOMBIE_KINDS[kind].arrival

export const isFloorKind = (kind: ZombieKind): boolean =>
  arrivalOf(kind) === 'Floor'

// ARRIVAL

export const scaledHp = (hp: number, hpScale: number): number =>
  Math.max(1, Math.round(hp * hpScale))

export type Entry = Readonly<{
  id: number
  kind: ZombieKind
  at: Vector
  speedRoll: number
  speedScale: number
  hp: number
  action?: ZombieAction
  frenzy?: Frenzy
}>

export const arrivingZombie = ({
  id,
  kind,
  at,
  speedRoll,
  speedScale,
  hp,
  action = ZombieAction.Roaming(),
  frenzy = Frenzy.Calm(),
}: Entry): Zombie => {
  const stats = ZOMBIE_KINDS[kind]
  return {
    id,
    kind,
    x: at.x,
    y: at.y,
    speed:
      (stats.speedMin + (stats.speedMax - stats.speedMin) * speedRoll) *
      speedScale,
    hp,
    maxHp: hp,
    knockback: { x: 0, y: 0 },
    hitRemainingMs: 0,
    state: ZombieState.Walking(),
    action,
    frenzy,
  }
}

// STRIDE

export const strideAt = (zombie: Zombie, elapsedMs: number): number =>
  Math.floor(
    ((elapsedMs / MS_PER_SECOND) * zombie.speed) / statsOf(zombie).stridePx +
      zombie.id * ZOMBIE_SHAMBLE_PHASE_PER_ID,
  )
