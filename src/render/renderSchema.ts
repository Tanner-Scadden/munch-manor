// The client's cosmetics the render layer keeps in the Model: particles,
// decals, and what the hero tells saw last frame.

import { Schema } from 'effect'

import { DareKind } from '../world/dare/dareSchema'
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

// NOTE: what the hero tells (src/render/heroTells.ts) saw of the World last frame,
// to see what changed in it: each trap's health (a rise is a repair) and
// each seat's earnings (a rise beside a kill is a kill paid). A cosmetic of
// the client's own, so the room's World needs nothing new for it.
export const TellWatch = Schema.Struct({
  traps: Schema.Array(Schema.Struct({ id: Schema.Finite, hp: Schema.Finite })),
  keysFound: Schema.Array(
    Schema.Struct({ slot: Schema.Finite, keysFound: Schema.Finite }),
  ),
})
export type TellWatch = typeof TellWatch.Type

export const noTellWatch: TellWatch = { traps: [], keysFound: [] }

// NOTE: the motion a hands-on action loops while it works
// (src/render/actionPose.ts).
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

// NOTE: the payoff a hands-on action ends with (src/render/actionPose.ts).
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

// NOTE: one payoff a seat is playing: what, since when on the World's
// clock, and the thing held up for a find.
export const ActionBeat = Schema.Struct({
  slot: Schema.Finite,
  payoff: Payoff,
  startMs: Schema.Finite,
  maybeThing: Schema.Option(DareKind),
})
export type ActionBeat = typeof ActionBeat.Type

// NOTE: what the actions saw of the World last frame, to see what changed
// in it: the payoffs playing, the weapon each seat held (a change is a
// swap), the traps standing (a new one was just set down), and each seat
// at work, its motion's frame and where (a strike frame not seen before
// is a blow landed). A cosmetic of the client's own, like the hero tells'
// watch.
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
