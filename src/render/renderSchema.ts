// The client's cosmetics the render layer keeps in the Model: particles,
// decals, and what the hero tells saw last frame.

import { Schema } from 'effect'

import { ParticleKind } from '../world/schema/entitySchema'
import { MillisNumber } from '../world/schema/wireNumber'

export const Particle = Schema.Struct({
  kind: ParticleKind,
  x: Schema.Finite,
  y: Schema.Finite,
  z: Schema.Finite,
  velocityX: Schema.Finite,
  velocityY: Schema.Finite,
  velocityZ: Schema.Finite,
  size: Schema.Finite,
  remainingMs: MillisNumber,
})
export type Particle = typeof Particle.Type

export const DecalKind = Schema.Literals([
  'Blood',
  'Meat',
  'Rot',
  'Shell',
  'Hull',
  'Bone',
  'Hide',
  'Goo',
  'Scorch',
  'Wood',
  'Clip',
  'GreenLimb',
  'GreenScalp',
  'HairScalp',
  'BlueLimb',
  'BlueChunk',
  'BombShard',
  'LimeLimb',
  'RedCap',
  'PinkLimb',
  'PinkChunk',
  'TealLimb',
  'TealScalp',
  'PaleScalp',
  'PotLid',
  'StopSign',
  'Bucket',
])
export type DecalKind = typeof DecalKind.Type

export const Decal = Schema.Struct({
  kind: DecalKind,
  x: Schema.Finite,
  y: Schema.Finite,
  width: Schema.Finite,
  height: Schema.Finite,
})
export type Decal = typeof Decal.Type

// NOTE: what the hero tells (src/render/heroTells.ts) saw of the World last frame,
// to see what changed in it: each trap's health (a rise is a repair) and
// each seat's earnings (a rise beside a kill is a kill paid). A cosmetic of
// the client's own, so the room's World needs nothing new for it.
export const TellWatch = Schema.Struct({
  traps: Schema.Array(Schema.Struct({ id: Schema.Finite, hp: Schema.Finite })),
  earned: Schema.Array(
    Schema.Struct({ slot: Schema.Finite, earned: Schema.Finite }),
  ),
})
export type TellWatch = typeof TellWatch.Type

export const noTellWatch: TellWatch = { traps: [], earned: [] }
