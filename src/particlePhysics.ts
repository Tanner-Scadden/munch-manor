import { Option, Result } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { type Level, isInsideRoomAt, isSolidAt } from './arena'
import {
  BLOOD_DRAG_PER_SECOND,
  BLOOD_GRAVITY,
  CHIP_DRAG_PER_SECOND,
  CHIP_GRAVITY,
  CHIP_RESTITUTION,
  CLIP_SIZE_PX,
  COIN_DRAG_PER_SECOND,
  COIN_GRAVITY,
  COIN_RESTITUTION,
  DUST_DRAG_PER_SECOND,
  GIB_DRAG_PER_SECOND,
  GIB_GRAVITY,
  GIB_RESTITUTION,
  PARTICLE_BOUNCE_FRICTION,
  PARTICLE_BOUNCE_MIN_SPEED,
  SHELL_DRAG_PER_SECOND,
  SHELL_GRAVITY,
  SHELL_RESTITUTION,
  SPARK_DRAG_PER_SECOND,
  SPARK_GRAVITY,
} from './constants'
import type { Decal, DecalKind, Particle, ParticleKind } from './model'

// PHYSICS

const SMOKE_RISE = 30

const partPhysics = (decalKind: DecalKind): ParticlePhysics => ({
  gravity: GIB_GRAVITY,
  dragPerSecond: GIB_DRAG_PER_SECOND,
  restitution: GIB_RESTITUTION,
  maybeDecalKind: Option.some(decalKind),
})

type ParticlePhysics = Readonly<{
  gravity: number
  dragPerSecond: number
  restitution: number
  maybeDecalKind: Option.Option<DecalKind>
}>

const PHYSICS: Readonly<Record<ParticleKind, ParticlePhysics>> = {
  Blood: {
    gravity: BLOOD_GRAVITY,
    dragPerSecond: BLOOD_DRAG_PER_SECOND,
    restitution: 0,
    maybeDecalKind: Option.some('Blood'),
  },
  MeatGib: {
    gravity: GIB_GRAVITY,
    dragPerSecond: GIB_DRAG_PER_SECOND,
    restitution: GIB_RESTITUTION,
    maybeDecalKind: Option.some('Meat'),
  },
  RotGib: {
    gravity: GIB_GRAVITY,
    dragPerSecond: GIB_DRAG_PER_SECOND,
    restitution: GIB_RESTITUTION,
    maybeDecalKind: Option.some('Rot'),
  },
  Shell: {
    gravity: SHELL_GRAVITY,
    dragPerSecond: SHELL_DRAG_PER_SECOND,
    restitution: SHELL_RESTITUTION,
    maybeDecalKind: Option.some('Shell'),
  },
  Hull: {
    gravity: SHELL_GRAVITY,
    dragPerSecond: SHELL_DRAG_PER_SECOND,
    restitution: SHELL_RESTITUTION,
    maybeDecalKind: Option.some('Hull'),
  },
  Link: {
    gravity: SHELL_GRAVITY,
    dragPerSecond: SHELL_DRAG_PER_SECOND,
    restitution: SHELL_RESTITUTION,
    maybeDecalKind: Option.some('Shell'),
  },
  Dust: {
    gravity: 0,
    dragPerSecond: DUST_DRAG_PER_SECOND,
    restitution: 0,
    maybeDecalKind: Option.none(),
  },
  Chip: {
    gravity: CHIP_GRAVITY,
    dragPerSecond: CHIP_DRAG_PER_SECOND,
    restitution: CHIP_RESTITUTION,
    maybeDecalKind: Option.none(),
  },
  Coin: {
    gravity: COIN_GRAVITY,
    dragPerSecond: COIN_DRAG_PER_SECOND,
    restitution: COIN_RESTITUTION,
    maybeDecalKind: Option.none(),
  },
  BoneGib: {
    gravity: GIB_GRAVITY,
    dragPerSecond: GIB_DRAG_PER_SECOND,
    restitution: GIB_RESTITUTION,
    maybeDecalKind: Option.some('Bone'),
  },
  HideGib: {
    gravity: GIB_GRAVITY,
    dragPerSecond: GIB_DRAG_PER_SECOND,
    restitution: GIB_RESTITUTION,
    maybeDecalKind: Option.some('Hide'),
  },
  Goo: {
    gravity: BLOOD_GRAVITY,
    dragPerSecond: BLOOD_DRAG_PER_SECOND,
    restitution: 0,
    maybeDecalKind: Option.some('Goo'),
  },
  Spark: {
    gravity: SPARK_GRAVITY,
    dragPerSecond: SPARK_DRAG_PER_SECOND,
    restitution: 0,
    maybeDecalKind: Option.none(),
  },
  Splinter: {
    gravity: CHIP_GRAVITY,
    dragPerSecond: CHIP_DRAG_PER_SECOND,
    restitution: CHIP_RESTITUTION,
    maybeDecalKind: Option.some('Wood'),
  },
  Plank: {
    gravity: GIB_GRAVITY,
    dragPerSecond: GIB_DRAG_PER_SECOND,
    restitution: GIB_RESTITUTION,
    maybeDecalKind: Option.some('Wood'),
  },
  Clip: {
    gravity: SHELL_GRAVITY,
    dragPerSecond: SHELL_DRAG_PER_SECOND,
    restitution: GIB_RESTITUTION,
    maybeDecalKind: Option.some('Clip'),
  },
  GreenLimb: partPhysics('GreenLimb'),
  GreenScalp: partPhysics('GreenScalp'),
  HairScalp: partPhysics('HairScalp'),
  BlueLimb: partPhysics('BlueLimb'),
  BlueChunk: partPhysics('BlueChunk'),
  BombShard: partPhysics('BombShard'),
  LimeLimb: partPhysics('LimeLimb'),
  RedCap: partPhysics('RedCap'),
  PinkLimb: partPhysics('PinkLimb'),
  PinkChunk: partPhysics('PinkChunk'),
  TealLimb: partPhysics('TealLimb'),
  TealScalp: partPhysics('TealScalp'),
  PaleScalp: partPhysics('PaleScalp'),
  PotLid: partPhysics('PotLid'),
  StopSign: partPhysics('StopSign'),
  Bucket: partPhysics('Bucket'),
  Smoke: {
    gravity: -SMOKE_RISE,
    dragPerSecond: DUST_DRAG_PER_SECOND,
    restitution: 0,
    maybeDecalKind: Option.none(),
  },
  Frost: {
    gravity: SPARK_GRAVITY,
    dragPerSecond: DUST_DRAG_PER_SECOND,
    restitution: 0,
    maybeDecalKind: Option.none(),
  },
  IceGib: {
    gravity: GIB_GRAVITY,
    dragPerSecond: GIB_DRAG_PER_SECOND,
    restitution: GIB_RESTITUTION,
    maybeDecalKind: Option.none(),
  },
  Fog: {
    gravity: -SMOKE_RISE / 3,
    dragPerSecond: DUST_DRAG_PER_SECOND,
    restitution: 0,
    maybeDecalKind: Option.none(),
  },
}

export const LAUNCH_SIZE: Readonly<Record<ParticleKind, number>> = {
  Blood: 1,
  MeatGib: 2,
  RotGib: 2,
  Shell: 2,
  Hull: 3,
  Link: 1,
  Dust: 2,
  Chip: 1,
  Coin: 2,
  BoneGib: 2,
  HideGib: 3,
  Goo: 2,
  Spark: 1,
  Splinter: 1,
  Plank: 4,
  Clip: CLIP_SIZE_PX,
  GreenLimb: 4,
  GreenScalp: 3,
  HairScalp: 3,
  BlueLimb: 5,
  BlueChunk: 4,
  BombShard: 3,
  LimeLimb: 4,
  RedCap: 3,
  PinkLimb: 7,
  PinkChunk: 5,
  TealLimb: 6,
  TealScalp: 3,
  PaleScalp: 3,
  PotLid: 6,
  StopSign: 6,
  Bucket: 5,
  Smoke: 3,
  Frost: 1,
  IceGib: 2,
  Fog: 4,
}

const DECAL_HEIGHT: Readonly<Record<DecalKind, (size: number) => number>> = {
  Blood: () => 1,
  Meat: size => size,
  Rot: size => size,
  Shell: () => 1,
  Hull: () => 2,
  Bone: () => 1,
  Hide: size => size,
  Goo: size => size,
  Scorch: size => size,
  Wood: () => 1,
  Clip: () => 2,
  GreenLimb: () => 2,
  GreenScalp: () => 2,
  HairScalp: () => 2,
  BlueLimb: () => 2,
  BlueChunk: () => 3,
  BombShard: () => 2,
  LimeLimb: () => 2,
  RedCap: () => 2,
  PinkLimb: () => 3,
  PinkChunk: () => 4,
  TealLimb: () => 2,
  TealScalp: () => 2,
  PaleScalp: () => 2,
  PotLid: () => 3,
  StopSign: () => 5,
  Bucket: () => 4,
}

type ParticleStep = Result.Result<Particle, Option.Option<Decal>>

const flying = (particle: Particle): ParticleStep => Result.succeed(particle)

const LEFT_NOTHING: ParticleStep = Result.fail(Option.none())

const leftDecal = (decal: Decal): ParticleStep =>
  Result.fail(Option.some(decal))

const isOnFloor = (level: Level, x: number, y: number): boolean =>
  isInsideRoomAt(level, { x, y }) && !isSolidAt(level, { x, y })

const land = (
  level: Level,
  particle: Particle,
  x: number,
  y: number,
): ParticleStep => {
  const floorX = Math.round(x)
  const floorY = Math.round(y)
  return Option.match(PHYSICS[particle.kind].maybeDecalKind, {
    onNone: () => LEFT_NOTHING,
    onSome: kind =>
      isOnFloor(level, floorX, floorY)
        ? leftDecal({
            kind,
            x: floorX,
            y: floorY,
            width: particle.size,
            height: DECAL_HEIGHT[kind](particle.size),
          })
        : LEFT_NOTHING,
  })
}

export const stepParticle =
  (level: Level, seconds: number, deltaMs: number) =>
  (particle: Particle): ParticleStep => {
    const physics = PHYSICS[particle.kind]
    const remainingMs = particle.remainingMs - deltaMs
    if (remainingMs <= 0) {
      return LEFT_NOTHING
    }

    const drag = Math.exp(-physics.dragPerSecond * seconds)
    const velocityZ = particle.velocityZ - physics.gravity * seconds
    const x = particle.x + particle.velocityX * seconds
    const y = particle.y + particle.velocityY * seconds
    const z = particle.z + velocityZ * seconds
    const isTouchingDown = z <= 0 && velocityZ < 0
    const reboundSpeed = -velocityZ * physics.restitution

    if (!isTouchingDown) {
      return flying(
        modifyFields(particle, {
          x: () => x,
          y: () => y,
          z: () => z,
          velocityX: velocityX => velocityX * drag,
          velocityY: velocityY => velocityY * drag,
          velocityZ: () => velocityZ,
          remainingMs: () => remainingMs,
        }),
      )
    } else if (reboundSpeed > PARTICLE_BOUNCE_MIN_SPEED) {
      return flying(
        modifyFields(particle, {
          x: () => x,
          y: () => y,
          z: () => 0,
          velocityX: velocityX => velocityX * PARTICLE_BOUNCE_FRICTION,
          velocityY: velocityY => velocityY * PARTICLE_BOUNCE_FRICTION,
          velocityZ: () => reboundSpeed,
          remainingMs: () => remainingMs,
        }),
      )
    } else {
      return land(level, particle, x, y)
    }
  }
