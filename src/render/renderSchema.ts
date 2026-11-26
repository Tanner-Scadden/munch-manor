import { Schema } from 'effect'

import { DareKind } from '#world/dare/dareSchema.ts'
import { ParticleKind, Vector } from '#world/schema/entitySchema.ts'
import { MillisNumber } from '#world/schema/wireNumber.ts'

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
  'FryingPan',
  'StockPot',
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

export const TellWatch = Schema.Struct({
  traps: Schema.Array(Schema.Struct({ id: Schema.Finite, hp: Schema.Finite })),
  keysFound: Schema.Array(
    Schema.Struct({ slot: Schema.Finite, keysFound: Schema.Finite }),
  ),
})
export type TellWatch = typeof TellWatch.Type

export const noTellWatch: TellWatch = { traps: [], keysFound: [] }

export const Motion = Schema.Literals([
  'Compress',
  'Rummage',
  'Yank',
  'Haul',
  'Crank',
  'Pull',
  'Push',
  'Shove',
  'Hammer',
  'Stir',
  'Pry',
])
export type Motion = typeof Motion.Type

export const Payoff = Schema.Literals([
  'HoldUp',
  'FistPump',
  'SpringUp',
  'Swap',
  'SetTrap',
  'Grab',
  'PryOpen',
])
export type Payoff = typeof Payoff.Type

export const ActionBeat = Schema.Struct({
  slot: Schema.Finite,
  payoff: Payoff,
  startMs: Schema.Finite,
  maybeThing: Schema.Option(DareKind),
})
export type ActionBeat = typeof ActionBeat.Type

export const ActionWatch = Schema.Struct({
  beats: Schema.Array(ActionBeat),
  held: Schema.Array(
    Schema.Struct({ slot: Schema.Finite, weapon: Schema.String }),
  ),
  trapIds: Schema.Array(Schema.Finite),
  working: Schema.Array(
    Schema.Struct({
      slot: Schema.Finite,
      motion: Motion,
      frame: Schema.Finite,
      x: Schema.Finite,
      y: Schema.Finite,
    }),
  ),
})
export type ActionWatch = typeof ActionWatch.Type

export const noActionWatch: ActionWatch = {
  beats: [],
  held: [],
  trapIds: [],
  working: [],
}

export const Finisher = Schema.Struct({
  x: Schema.Finite,
  y: Schema.Finite,
  ageMs: Schema.Finite,
})
export type Finisher = typeof Finisher.Type

export const CameraGlide = Schema.Struct({
  offset: Vector,
  velocity: Vector,
})
export type CameraGlide = typeof CameraGlide.Type

export const STILL_GLIDE: CameraGlide = {
  offset: { x: 0, y: 0 },
  velocity: { x: 0, y: 0 },
}
