import { Array, Result } from 'effect'
import { Canvas } from 'foldkit'

import { type TextTone, textWidth } from '../art/font'
import { group } from '../art/sprite'
import {
  BLAST_FLASH_MS,
  BLOOD_DECAL_COLOR,
  BLOOD_DECAL_FADED_COLOR,
  BLOOD_PARTICLE_COLOR,
  BONE_DECAL_COLOR,
  BONE_DECAL_FADED_COLOR,
  BONE_GIB_COLOR,
  BULLET_TRAIL_COLOR,
  BULLET_TRAIL_PX,
  CHIP_COLOR,
  CLIP_COLOR,
  CLIP_DECAL_COLOR,
  CLIP_DECAL_FADED_COLOR,
  COIN_COLOR,
  DAMAGE_POPUP_HOP_PX,
  DAMAGE_POPUP_RISE_PX,
  DECAL_FADE_COUNT,
  DECAL_MAX,
  DUST_COLOR,
  DUST_FADED_COLOR,
  DUST_FADE_MS,
  GIB_SHADOW_COLOR,
  GIB_SHADOW_WIDTH,
  GOO_COLOR,
  GOO_DECAL_COLOR,
  GOO_DECAL_FADED_COLOR,
  HIDE_DECAL_COLOR,
  HIDE_DECAL_FADED_COLOR,
  HIDE_GIB_COLOR,
  HULL_COLOR,
  HULL_DECAL_COLOR,
  HULL_DECAL_FADED_COLOR,
  KILL_POPUP_BIG_SCALE,
  KILL_POPUP_FLASH_MS,
  KILL_POPUP_HOP_PX,
  KILL_POPUP_RISE_PX,
  KILL_POPUP_SCALE,
  LINK_COLOR,
  MEAT_DECAL_COLOR,
  MEAT_DECAL_FADED_COLOR,
  MEAT_GIB_COLOR,
  PLANK_COLOR,
  POPUP_FADE_START,
  POPUP_HOP_MS,
  ROT_DECAL_COLOR,
  ROT_DECAL_FADED_COLOR,
  ROT_GIB_COLOR,
  SCORCH_DECAL_COLOR,
  SCORCH_DECAL_FADED_COLOR,
  SHELL_COLOR,
  SHELL_DECAL_COLOR,
  SHELL_DECAL_FADED_COLOR,
  SHELL_TUMBLE_MS,
  SPARK_COLOR,
  SPLINTER_COLOR,
  WOOD_DECAL_COLOR,
  WOOD_DECAL_FADED_COLOR,
} from '../shared/constants'
import { type Level, levelOf } from '../world/level/arena'
import { SAVE_WORDS } from '../world/names'
import type {
  Bullet,
  BulletGlaze,
  DoorId,
  ParticleKind,
  WeaponKind,
} from '../world/schema/entitySchema'
import type { World } from '../world/schema/world'
import { type Blast, Phase, type Popup } from '../world/schema/worldSchema'
import { clamp } from '../world/step/geometry'
import { routeSpawns } from '../world/waves/doorRoute'
import { rattlingDoors } from '../world/waves/pacing'
import { bossRattleDoors } from '../world/zombies/boss'
import type { Camera } from './camera'
import { centeredGlyphs, centeredRect, progressBetween } from './drawing'
import { POPUP_LIFETIME_MS } from './juice'
import type { Decal, DecalKind, Particle } from './renderSchema'

// BULLETS

const BULLET_SIZE = 2
const BULLET_COLOR = '#ffe066'

// NOTE: a boosted shot wears what the player grabbed: a brass slug that
// rattles out of a wound-up gun (Wind-Up Key), a silver streak with a bright
// head (Family Silver), and a long hat pin with a red pearl head (Hat Pins).
// A look's segments run from the tail up to the head along the shot's
// path, two squares each, as the frame's budget allows.
type BulletSegment = Readonly<{ backPx: number; color: string }>

type BulletLook = Readonly<{
  size: number
  segments: ReadonlyArray<BulletSegment>
}>

const BULLET_LOOKS: Readonly<Record<BulletGlaze, BulletLook>> = {
  Plain: {
    size: BULLET_SIZE,
    segments: [
      { backPx: BULLET_TRAIL_PX, color: BULLET_TRAIL_COLOR },
      { backPx: 0, color: BULLET_COLOR },
    ],
  },
  Spicy: {
    size: BULLET_SIZE,
    segments: [
      { backPx: BULLET_TRAIL_PX + 1, color: 'rgba(168, 120, 42, 0.7)' },
      { backPx: 0, color: '#f0c050' },
    ],
  },
  Mean: {
    size: BULLET_SIZE + 1,
    segments: [
      { backPx: BULLET_TRAIL_PX + 1, color: 'rgba(200, 210, 226, 0.7)' },
      { backPx: 0, color: '#ffffff' },
    ],
  },
  Skewer: {
    size: BULLET_SIZE,
    segments: [
      { backPx: BULLET_TRAIL_PX + 2, color: '#d8dce6' },
      { backPx: 0, color: '#ff4a4f' },
    ],
  },
}

// NOTE: a plain shot from the display cases' two guns has its own look: Old
// Thunder's a white-hot streak, the Big Blunder's a short gray lead shot. A
// boost's or a perk's glaze shows over it.
const OLD_GUN_LOOKS: Readonly<Partial<Record<WeaponKind, BulletLook>>> = {
  Rifle: {
    size: BULLET_SIZE,
    segments: [
      { backPx: BULLET_TRAIL_PX + 4, color: 'rgba(255, 224, 140, 0.7)' },
      { backPx: 0, color: '#fff6d0' },
    ],
  },
  Blunderbuss: {
    size: BULLET_SIZE,
    segments: [
      { backPx: BULLET_TRAIL_PX - 1, color: 'rgba(120, 112, 100, 0.6)' },
      { backPx: 0, color: '#c9c3b0' },
    ],
  },
}

const lookOf = (glaze: BulletGlaze, weapon: WeaponKind): BulletLook =>
  glaze === 'Plain'
    ? (OLD_GUN_LOOKS[weapon] ?? BULLET_LOOKS.Plain)
    : BULLET_LOOKS[glaze]

export const bulletShapes = ({
  x,
  y,
  velocityX,
  velocityY,
  glaze,
  weapon,
}: Bullet): ReadonlyArray<Canvas.Shape> => {
  const look = lookOf(glaze, weapon)
  const speed = Math.max(1, Math.hypot(velocityX, velocityY))
  const half = Math.floor(look.size / 2)
  return Array.map(look.segments, ({ backPx, color }) =>
    Canvas.Rect({
      x: Math.round(x - (velocityX / speed) * backPx) - half,
      y: Math.round(y - (velocityY / speed) * backPx) - half,
      width: look.size,
      height: look.size,
      fill: color,
    }),
  )
}

// DECALS AND PARTICLES

type PartLook = Readonly<{
  particle: string
  decal: string
  faded: string
  hasStump: boolean
}>

const PART_LOOKS: Readonly<
  Record<
    | 'GreenLimb'
    | 'GreenScalp'
    | 'HairScalp'
    | 'BlueLimb'
    | 'BlueChunk'
    | 'BombShard'
    | 'LimeLimb'
    | 'RedCap'
    | 'PinkLimb'
    | 'PinkChunk'
    | 'TealLimb'
    | 'TealScalp'
    | 'PaleScalp'
    | 'FryingPan'
    | 'StockPot',
    PartLook
  >
> = {
  GreenLimb: {
    particle: '#8ed65e',
    decal: '#72b84a',
    faded: '#45693a',
    hasStump: true,
  },
  GreenScalp: {
    particle: '#62ad45',
    decal: '#5a9e40',
    faded: '#3b5a30',
    hasStump: false,
  },
  TealLimb: {
    particle: '#7fdcb6',
    decal: '#64c29c',
    faded: '#3d6a58',
    hasStump: true,
  },
  TealScalp: {
    particle: '#4fae8c',
    decal: '#4a9f80',
    faded: '#335a4c',
    hasStump: false,
  },
  PaleScalp: {
    particle: '#cfe3b4',
    decal: '#b8cc9c',
    faded: '#5f6852',
    hasStump: false,
  },
  HairScalp: {
    particle: '#3a2418',
    decal: '#3a2418',
    faded: '#2c2220',
    hasStump: false,
  },
  BlueLimb: {
    particle: '#8a9bb5',
    decal: '#7787a0',
    faded: '#4d5566',
    hasStump: true,
  },
  BlueChunk: {
    particle: '#5f6f8a',
    decal: '#56647c',
    faded: '#3c4352',
    hasStump: false,
  },
  BombShard: {
    particle: '#3a4a8a',
    decal: '#2c3a6a',
    faded: '#363a4a',
    hasStump: false,
  },
  RedCap: {
    particle: '#d8463e',
    decal: '#b43a34',
    faded: '#5e2a28',
    hasStump: false,
  },
  LimeLimb: {
    particle: '#c4f08a',
    decal: '#a6d872',
    faded: '#5a6e44',
    hasStump: true,
  },
  PinkLimb: {
    particle: '#b49ab0',
    decal: '#a0879c',
    faded: '#625562',
    hasStump: true,
  },
  PinkChunk: {
    particle: '#c0587a',
    decal: '#a8475f',
    faded: '#5e3240',
    hasStump: false,
  },
  FryingPan: {
    particle: '#3a3a44',
    decal: '#2e2e36',
    faded: '#26262c',
    hasStump: false,
  },
  StockPot: {
    particle: '#a9b3bf',
    decal: '#8e98a4',
    faded: '#5c626b',
    hasStump: false,
  },
}

const SMOKE_COLOR = 'rgba(214, 208, 200, 0.7)'
const SMOKE_FADED_COLOR = 'rgba(150, 144, 140, 0.35)'
const SMOKE_FADE_MS = 220

const STUMP_COLOR = '#a8262c'
const STUMP_FADED_COLOR = '#4a1c20'

const DECAL_COLORS: Readonly<Record<DecalKind, string>> = {
  Blood: BLOOD_DECAL_COLOR,
  Meat: MEAT_DECAL_COLOR,
  Rot: ROT_DECAL_COLOR,
  Shell: SHELL_DECAL_COLOR,
  Hull: HULL_DECAL_COLOR,
  Bone: BONE_DECAL_COLOR,
  Hide: HIDE_DECAL_COLOR,
  Goo: GOO_DECAL_COLOR,
  Scorch: SCORCH_DECAL_COLOR,
  Wood: WOOD_DECAL_COLOR,
  Clip: CLIP_DECAL_COLOR,
  GreenLimb: PART_LOOKS.GreenLimb.decal,
  GreenScalp: PART_LOOKS.GreenScalp.decal,
  HairScalp: PART_LOOKS.HairScalp.decal,
  BlueLimb: PART_LOOKS.BlueLimb.decal,
  BlueChunk: PART_LOOKS.BlueChunk.decal,
  BombShard: PART_LOOKS.BombShard.decal,
  LimeLimb: PART_LOOKS.LimeLimb.decal,
  RedCap: PART_LOOKS.RedCap.decal,
  PinkLimb: PART_LOOKS.PinkLimb.decal,
  PinkChunk: PART_LOOKS.PinkChunk.decal,
  TealLimb: PART_LOOKS.TealLimb.decal,
  TealScalp: PART_LOOKS.TealScalp.decal,
  PaleScalp: PART_LOOKS.PaleScalp.decal,
  FryingPan: PART_LOOKS.FryingPan.decal,
  StockPot: PART_LOOKS.StockPot.decal,
}

const FADED_DECAL_COLORS: Readonly<Record<DecalKind, string>> = {
  Blood: BLOOD_DECAL_FADED_COLOR,
  Meat: MEAT_DECAL_FADED_COLOR,
  Rot: ROT_DECAL_FADED_COLOR,
  Shell: SHELL_DECAL_FADED_COLOR,
  Hull: HULL_DECAL_FADED_COLOR,
  Bone: BONE_DECAL_FADED_COLOR,
  Hide: HIDE_DECAL_FADED_COLOR,
  Goo: GOO_DECAL_FADED_COLOR,
  Scorch: SCORCH_DECAL_FADED_COLOR,
  Wood: WOOD_DECAL_FADED_COLOR,
  Clip: CLIP_DECAL_FADED_COLOR,
  GreenLimb: PART_LOOKS.GreenLimb.faded,
  GreenScalp: PART_LOOKS.GreenScalp.faded,
  HairScalp: PART_LOOKS.HairScalp.faded,
  BlueLimb: PART_LOOKS.BlueLimb.faded,
  BlueChunk: PART_LOOKS.BlueChunk.faded,
  BombShard: PART_LOOKS.BombShard.faded,
  LimeLimb: PART_LOOKS.LimeLimb.faded,
  RedCap: PART_LOOKS.RedCap.faded,
  PinkLimb: PART_LOOKS.PinkLimb.faded,
  PinkChunk: PART_LOOKS.PinkChunk.faded,
  TealLimb: PART_LOOKS.TealLimb.faded,
  TealScalp: PART_LOOKS.TealScalp.faded,
  PaleScalp: PART_LOOKS.PaleScalp.faded,
  FryingPan: PART_LOOKS.FryingPan.faded,
  StockPot: PART_LOOKS.StockPot.faded,
}

const PARTICLE_COLORS: Readonly<Record<ParticleKind, string>> = {
  Blood: BLOOD_PARTICLE_COLOR,
  MeatGib: MEAT_GIB_COLOR,
  RotGib: ROT_GIB_COLOR,
  Shell: SHELL_COLOR,
  Hull: HULL_COLOR,
  Link: LINK_COLOR,
  Dust: DUST_COLOR,
  Chip: CHIP_COLOR,
  Coin: COIN_COLOR,
  BoneGib: BONE_GIB_COLOR,
  HideGib: HIDE_GIB_COLOR,
  Goo: GOO_COLOR,
  Spark: SPARK_COLOR,
  Splinter: SPLINTER_COLOR,
  Plank: PLANK_COLOR,
  Clip: CLIP_COLOR,
  GreenLimb: PART_LOOKS.GreenLimb.particle,
  GreenScalp: PART_LOOKS.GreenScalp.particle,
  HairScalp: PART_LOOKS.HairScalp.particle,
  BlueLimb: PART_LOOKS.BlueLimb.particle,
  BlueChunk: PART_LOOKS.BlueChunk.particle,
  BombShard: PART_LOOKS.BombShard.particle,
  LimeLimb: PART_LOOKS.LimeLimb.particle,
  RedCap: PART_LOOKS.RedCap.particle,
  PinkLimb: PART_LOOKS.PinkLimb.particle,
  PinkChunk: PART_LOOKS.PinkChunk.particle,
  TealLimb: PART_LOOKS.TealLimb.particle,
  TealScalp: PART_LOOKS.TealScalp.particle,
  PaleScalp: PART_LOOKS.PaleScalp.particle,
  FryingPan: PART_LOOKS.FryingPan.particle,
  StockPot: PART_LOOKS.StockPot.particle,
  Smoke: SMOKE_COLOR,
  Frost: '#c8f0ff',
  IceGib: '#9fd8f0',
  Fog: 'rgba(150, 210, 90, 0.55)',
  Confetti: '#ff6fb5',
}

const LIMBS: ReadonlyArray<ParticleKind | DecalKind> = [
  'GreenLimb',
  'BlueLimb',
  'PinkLimb',
  'TealLimb',
  'LimeLimb',
]

const PARTS: ReadonlyArray<ParticleKind> = [
  'GreenLimb',
  'BlueLimb',
  'PinkLimb',
  'TealLimb',
  'LimeLimb',
  'GreenScalp',
  'HairScalp',
  'BlueChunk',
  'BombShard',
  'RedCap',
  'PinkChunk',
  'TealScalp',
  'PaleScalp',
  'FryingPan',
  'StockPot',
]

const CASINGS: ReadonlyArray<ParticleKind> = [
  'Shell',
  'Hull',
  'Link',
  'Plank',
  'Clip',
]

const THICK_CASINGS: ReadonlyArray<ParticleKind> = ['Hull', 'Clip']

const isCasing = (particle: Particle): boolean =>
  Array.contains(CASINGS, particle.kind)

const stumpShapes = (
  decal: Decal,
  isFaded: boolean,
): ReadonlyArray<Canvas.Shape> =>
  Array.contains(LIMBS, decal.kind)
    ? [
        Canvas.Rect({
          x: decal.x - Math.floor(decal.width / 2) + decal.width - 1,
          y: decal.y - Math.floor(decal.height / 2),
          width: 1,
          height: decal.height,
          fill: isFaded ? STUMP_FADED_COLOR : STUMP_COLOR,
        }),
      ]
    : []

export const decalShapes = (
  decals: ReadonlyArray<Decal>,
): ReadonlyArray<Canvas.Shape> => {
  const fadedCount = decals.length - (DECAL_MAX - DECAL_FADE_COUNT)
  return Array.flatMap(decals, (decal, index) => {
    const isFaded = index < fadedCount
    return [
      centeredRect(
        decal.x,
        decal.y,
        decal.width,
        decal.height,
        isFaded ? FADED_DECAL_COLORS[decal.kind] : DECAL_COLORS[decal.kind],
      ),
      ...stumpShapes(decal, isFaded),
    ]
  })
}

const isGround = (particle: Particle): boolean => particle.kind === 'Dust'

const GIBS: ReadonlyArray<ParticleKind> = [
  'MeatGib',
  'RotGib',
  'BoneGib',
  'HideGib',
  ...PARTS,
]

const isGib = (particle: Particle): boolean =>
  Array.contains(GIBS, particle.kind)

export const gibShadow = (
  particle: Particle,
): Result.Result<Canvas.Shape, void> =>
  isGib(particle)
    ? Result.succeed(
        centeredRect(
          Math.round(particle.x),
          Math.round(particle.y),
          GIB_SHADOW_WIDTH,
          1,
          GIB_SHADOW_COLOR,
        ),
      )
    : Result.failVoid

const isCasingUpright = (particle: Particle): boolean =>
  isCasing(particle) &&
  Math.floor(particle.remainingMs / SHELL_TUMBLE_MS) % 2 === 1

const particleColor = (particle: Particle): string => {
  if (particle.kind === 'Dust' && particle.remainingMs < DUST_FADE_MS) {
    return DUST_FADED_COLOR
  } else if (
    particle.kind === 'Smoke' &&
    particle.remainingMs < SMOKE_FADE_MS
  ) {
    return SMOKE_FADED_COLOR
  } else {
    return PARTICLE_COLORS[particle.kind]
  }
}

const PART_TUMBLE_MS = 90

const partHeight = (particle: Particle): number => {
  const isLimb = Array.contains(LIMBS, particle.kind)
  const isTurned = Math.floor(particle.remainingMs / PART_TUMBLE_MS) % 2 === 1
  if (isLimb) {
    return isTurned ? particle.size : 2
  } else {
    return Math.max(2, particle.size - 1)
  }
}

const partWidth = (particle: Particle): number =>
  Array.contains(LIMBS, particle.kind) &&
  Math.floor(particle.remainingMs / PART_TUMBLE_MS) % 2 === 1
    ? 2
    : particle.size

const particleShape = (particle: Particle): Canvas.Shape => {
  const isUpright = isCasingUpright(particle)
  const isPart = Array.contains(PARTS, particle.kind)
  const thickness = Array.contains(THICK_CASINGS, particle.kind) ? 2 : 1
  const width = isPart
    ? partWidth(particle)
    : isUpright
      ? thickness
      : particle.size
  const height = isPart
    ? partHeight(particle)
    : isCasing(particle)
      ? isUpright
        ? particle.size
        : thickness
      : particle.size
  return centeredRect(
    Math.round(particle.x),
    Math.round(particle.y - particle.z),
    width,
    height,
    particleColor(particle),
  )
}

const particleShapesWhere =
  (isInLayer: (particle: Particle) => boolean) =>
  (particles: ReadonlyArray<Particle>): ReadonlyArray<Canvas.Shape> =>
    Array.filterMap(particles, particle =>
      isInLayer(particle)
        ? Result.succeed(particleShape(particle))
        : Result.failVoid,
    )

export const groundParticleShapes = particleShapesWhere(isGround)

export const airborneParticleShapes = particleShapesWhere(
  particle => !isGround(particle),
)

// BLASTS

const BLAST_FLASH_END_MS = 60
const BLAST_FLASH_COLOR = '#ffffff'
const BLAST_CORE_COLOR = '#ffe066'
const BLAST_FIRE_COLOR = '#ff7a2e'
const BLAST_RING_COLOR = '#fffbe6'
const BLAST_SMOKE_COLOR = 'rgba(70, 64, 66, 0.6)'
const BLAST_SMOKE_RISE_PX = 10

type Puff = Readonly<{ dx: number; dy: number; size: number }>

const SMOKE_PUFFS: ReadonlyArray<Puff> = [
  { dx: 0, dy: -0.2, size: 0.45 },
  { dx: -0.35, dy: 0, size: 0.35 },
  { dx: 0.35, dy: 0.05, size: 0.35 },
]

// NOTE: a cartoon KABOOM: a white flash with a hot core, then a fireball
// that shrinks inside a growing shockwave ring while a puffy cloud of smoke
// rises and fades.
export const blastShapes = (blast: Blast): ReadonlyArray<Canvas.Shape> => {
  const x = Math.round(blast.x)
  const y = Math.round(blast.y)
  if (blast.ageMs < BLAST_FLASH_END_MS) {
    return [
      Canvas.Circle({ x, y, radius: blast.radius, fill: BLAST_FLASH_COLOR }),
      Canvas.Circle({
        x,
        y,
        radius: Math.round(blast.radius * 0.55),
        fill: BLAST_CORE_COLOR,
      }),
    ]
  }

  const progress = clamp(blast.ageMs / BLAST_FLASH_MS, 0, 1)
  const rise = Math.round(BLAST_SMOKE_RISE_PX * progress)
  return [
    group({
      opacity: 1 - progress,
      shapes: [
        ...Array.map(SMOKE_PUFFS, puff =>
          Canvas.Circle({
            x: x + Math.round(puff.dx * blast.radius * (0.6 + progress)),
            y: y - rise + Math.round(puff.dy * blast.radius),
            radius: Math.max(
              1,
              Math.round(blast.radius * puff.size * (0.7 + 0.6 * progress)),
            ),
            fill: BLAST_SMOKE_COLOR,
          }),
        ),
        Canvas.Circle({
          x,
          y,
          radius: Math.max(1, Math.round(blast.radius * 0.6 * (1 - progress))),
          fill: BLAST_FIRE_COLOR,
        }),
        Canvas.Circle({
          x,
          y,
          radius: Math.max(
            1,
            Math.round(blast.radius * 0.3 * (1 - progress * 1.5)),
          ),
          fill: BLAST_CORE_COLOR,
        }),
        Canvas.Circle({
          x,
          y,
          radius: Math.round(blast.radius * (0.8 + 0.5 * progress)),
          stroke: BLAST_RING_COLOR,
          lineWidth: 2,
        }),
      ],
    }),
  ]
}

// POPUPS

type PopupLook = Readonly<{
  text: string
  tone: TextTone
  scale: number
  hopPx: number
  risePx: number
}>

const payoutLook = (
  popup: Popup,
  bigScale: number,
  scale: number,
): PopupLook => ({
  text: `+$${popup.value}`,
  tone: popup.ageMs < KILL_POPUP_FLASH_MS ? 'Damage' : 'Coin',
  scale: popup.ageMs < KILL_POPUP_FLASH_MS ? bigScale : scale,
  hopPx: KILL_POPUP_HOP_PX,
  risePx: KILL_POPUP_RISE_PX,
})

const PAYDAY_POPUP_SCALE = 3
const PAYDAY_POPUP_BIG_SCALE = 4

const HORDE_POPUP_SCALE = 2

const popupLook = (popup: Popup): PopupLook => {
  if (popup.kind === 'Saved') {
    return {
      text: SAVE_WORDS.Saved,
      tone: popup.ageMs < KILL_POPUP_FLASH_MS ? 'Victory' : 'Title',
      scale: HORDE_POPUP_SCALE,
      hopPx: KILL_POPUP_HOP_PX,
      risePx: KILL_POPUP_RISE_PX,
    }
  } else if (popup.kind === 'Clutch') {
    return {
      text: SAVE_WORDS.Clutch,
      tone: popup.ageMs < KILL_POPUP_FLASH_MS ? 'Damage' : 'Victory',
      scale: popup.ageMs < KILL_POPUP_FLASH_MS ? 3 : HORDE_POPUP_SCALE,
      hopPx: KILL_POPUP_HOP_PX,
      risePx: KILL_POPUP_RISE_PX,
    }
  } else if (popup.kind === 'Opened') {
    return {
      text: 'OPEN!',
      tone: popup.ageMs < KILL_POPUP_FLASH_MS ? 'Fresh' : 'Victory',
      scale: popup.ageMs < KILL_POPUP_FLASH_MS ? 3 : HORDE_POPUP_SCALE,
      hopPx: KILL_POPUP_HOP_PX,
      risePx: KILL_POPUP_RISE_PX,
    }
  } else if (popup.kind === 'Rushed') {
    return {
      text: `+${popup.value} RANK`,
      tone: popup.ageMs < KILL_POPUP_FLASH_MS ? 'Fresh' : 'Victory',
      scale: HORDE_POPUP_SCALE,
      hopPx: KILL_POPUP_HOP_PX,
      risePx: KILL_POPUP_RISE_PX,
    }
  } else if (popup.kind === 'Horde') {
    return {
      text: 'HORDE!',
      tone: popup.ageMs < KILL_POPUP_FLASH_MS ? 'Damage' : 'Alert',
      scale: HORDE_POPUP_SCALE,
      hopPx: KILL_POPUP_HOP_PX,
      risePx: DAMAGE_POPUP_RISE_PX,
    }
  } else if (popup.kind === 'Kaboom') {
    return {
      text: 'KABOOM!',
      tone: popup.ageMs < KILL_POPUP_FLASH_MS ? 'Damage' : 'Alert',
      scale: popup.ageMs < KILL_POPUP_FLASH_MS ? 3 : HORDE_POPUP_SCALE,
      hopPx: KILL_POPUP_HOP_PX,
      risePx: KILL_POPUP_RISE_PX,
    }
  } else if (popup.kind === 'Wipe') {
    return {
      text: `+$${popup.value}`,
      tone: popup.ageMs < KILL_POPUP_FLASH_MS ? 'Damage' : 'Coin',
      scale: popup.ageMs < KILL_POPUP_FLASH_MS ? 3 : HORDE_POPUP_SCALE,
      hopPx: KILL_POPUP_HOP_PX,
      risePx: KILL_POPUP_RISE_PX,
    }
  } else if (popup.kind === 'Damage') {
    return {
      text: `${popup.value}`,
      tone: 'Damage',
      scale: 1,
      hopPx: DAMAGE_POPUP_HOP_PX,
      risePx: DAMAGE_POPUP_RISE_PX,
    }
  } else if (popup.kind === 'Payday') {
    return payoutLook(popup, PAYDAY_POPUP_BIG_SCALE, PAYDAY_POPUP_SCALE)
  } else {
    return payoutLook(popup, KILL_POPUP_BIG_SCALE, KILL_POPUP_SCALE)
  }
}

export const popupShape =
  (camera: Camera) =>
  (popup: Popup): Canvas.Shape => {
    const look = popupLook(popup)
    const progress = clamp(popup.ageMs / POPUP_LIFETIME_MS[popup.kind], 0, 1)
    const hop =
      popup.ageMs < POPUP_HOP_MS
        ? look.hopPx * Math.sin((Math.PI * popup.ageMs) / POPUP_HOP_MS)
        : 0
    const halfWidth = Math.ceil((textWidth(look.text) * look.scale) / 2)
    return group({
      translate: {
        x: Math.round(
          clamp(
            popup.x,
            camera.x + halfWidth,
            camera.x + Math.max(halfWidth, camera.width - halfWidth),
          ),
        ),
        y: Math.round(popup.y - hop - look.risePx * progress),
      },
      scale: { x: look.scale, y: look.scale },
      opacity: 1 - progressBetween(progress, POPUP_FADE_START, 1),
      shapes: centeredGlyphs(look.text, look.tone),
    })
  }

// DOOR RATTLE

const RATTLE_EYE_COLOR = '#ff4a4f'
const RATTLE_SLAT_COLOR = '#8a5a2b'
const RATTLE_SHAKE_MS = 45
const RATTLE_BLINK_MS = 260
const RATTLE_EYE_DEPTH_PX = 4
const RATTLE_EYE_GAP_PX = 2
const RATTLE_SLAT_SPAN_PX = 7

const rattleShapes =
  (level: Level, elapsedMs: number) =>
  (door: DoorId): ReadonlyArray<Canvas.Shape> => {
    const { center, outward } = level.doors[door]
    const across = { x: -outward.y, y: outward.x }
    const shake = Math.round(Math.sin(elapsedMs / RATTLE_SHAKE_MS))
    const eyes = {
      x: center.x + outward.x * RATTLE_EYE_DEPTH_PX,
      y: center.y + outward.y * RATTLE_EYE_DEPTH_PX,
    }
    const isBlinking = Math.floor(elapsedMs / RATTLE_BLINK_MS) % 4 === 3
    const slat = (side: number): Canvas.Shape =>
      Canvas.Rect({
        x:
          Math.round(
            center.x + across.x * side * RATTLE_SLAT_SPAN_PX + across.x * shake,
          ) - 1,
        y:
          Math.round(
            center.y + across.y * side * RATTLE_SLAT_SPAN_PX + across.y * shake,
          ) - 1,
        width: 2,
        height: 2,
        fill: RATTLE_SLAT_COLOR,
      })
    const eye = (side: number): Canvas.Shape =>
      Canvas.Rect({
        x: Math.round(eyes.x + across.x * side * RATTLE_EYE_GAP_PX),
        y: Math.round(eyes.y + across.y * side * RATTLE_EYE_GAP_PX),
        width: 1,
        height: 1,
        fill: RATTLE_EYE_COLOR,
      })
    return [slat(-1), slat(1), ...(isBlinking ? [] : [eye(-1), eye(1)])]
  }

export const doorRattleShapes = (model: World): ReadonlyArray<Canvas.Shape> =>
  Phase.isAnyOf(['Wave'])(model.phase)
    ? Array.flatMap(
        Array.dedupe([
          ...rattlingDoors(
            routeSpawns(
              model.phase.spawns,
              model.traps,
              model.pacing.packDoors,
              levelOf(model).doorIds,
            ),
            model.pacing.warnedPacks,
          ),
          ...bossRattleDoors(model.boss),
        ]),
        rattleShapes(levelOf(model), model.elapsedMs),
      )
    : []
