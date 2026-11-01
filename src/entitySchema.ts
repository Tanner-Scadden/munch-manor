// The Schemas of what moves and stands in the World: the player, zombies and
// the boss, bullets, pickups and boosts, the fridge, and the level's state.
// src/worldSchema.ts builds the World from them and re-exports them.

import { Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

import { Calling } from './playerData'
import {
  Heading,
  MillisNumber,
  Point,
  PositionNumber,
  Push,
  VelocityNumber,
} from './wireNumber'

export const Vector = Schema.Struct({ x: Schema.Number, y: Schema.Number })
export type Vector = typeof Vector.Type

export const Trigger = Schema.Literals(['Released', 'Held'])
export type Trigger = typeof Trigger.Type

// NOTE: `interact` is the interact key or the touch hold button, held to
// buy what the player stands at (src/purchase.ts). With the knife in hand
// the trigger stabs instead of shooting (src/knife.ts).
export const Intent = Schema.Struct({
  move: Heading,
  maybeAim: Schema.Option(Heading),
  trigger: Trigger,
  interact: Trigger,
})
export type Intent = typeof Intent.Type

export const Invulnerability = defineTaggedUnion({
  Vulnerable: {},
  Invulnerable: { remainingMs: MillisNumber, durationMs: MillisNumber },
})
export type Invulnerability = typeof Invulnerability.Type

// NOTE: the Cooker, the Pan, and Brain Freeze come only out of the Mystery
// Leftovers fridge (src/leftovers.ts); Rattles never sells them.
export const WeaponKind = Schema.Literals([
  'Pistol',
  'Shotgun',
  'Smg',
  'Peashooter',
  'Cooker',
  'Pan',
  'Freeze',
])
export type WeaponKind = typeof WeaponKind.Type

export const CarriedGun = Schema.Struct({
  kind: WeaponKind,
  rounds: Schema.Number,
  loaded: Schema.Number,
  tier: Schema.Number,
})
export type CarriedGun = typeof CarriedGun.Type

// NOTE: the player's two gun slots (GAME_DESIGN.md, "The knife and two gun
// slots"). A run starts with the Pop Pistol alone in the first slot; the
// first gun bought or taken fills the second, and after that a new gun
// replaces the one in the player's hands. The pistol is a gun like any
// other: it can be traded away, and Rattles sells it back for $0.
export const Arsenal = defineTaggedUnion({
  OneGun: { first: CarriedGun },
  HoldingFirst: { first: CarriedGun, second: CarriedGun },
  HoldingSecond: { first: CarriedGun, second: CarriedGun },
})
export type Arsenal = typeof Arsenal.Type

// NOTE: the third slot, right of the guns (GAME_DESIGN.md, "The knife and
// two gun slots"): the knife every run starts with, or the Clang Pan from
// the Mystery Leftovers fridge, which takes the knife's place for the rest
// of the run. The Pan's `loaded` is its dent meter, as in src/weapons.ts.
export const Melee = defineTaggedUnion({
  Knife: {},
  Pan: { pan: CarriedGun },
})
export type Melee = typeof Melee.Type

// NOTE: what the player has in hand: the arsenal's held gun, or the third
// slot, the melee weapon. With the melee weapon out the arsenal still names
// the last gun held, which Q goes back to.
const Wield = Schema.Literals(['Gun', 'Melee'])
type Wield = typeof Wield.Type

export const Reload = defineTaggedUnion({
  Ready: {},
  Reloading: { remainingMs: MillisNumber, durationMs: MillisNumber },
})
export type Reload = typeof Reload.Type

// NOTE: the Pressure Cooker's trigger (src/fridgeWeapons.ts). Building
// counts how long fire has been held and keeps the aim it was held at, so a
// thumb lifting off the stick still throws where it pointed. Spent is a
// lid that popped in the player's hands: nothing builds until fire is let go.
export const Charge = defineTaggedUnion({
  Idle: {},
  Building: { heldMs: MillisNumber, aim: Point },
  Spent: {},
})
export type Charge = typeof Charge.Type

export const Player = Schema.Struct({
  x: PositionNumber,
  y: PositionNumber,
  hp: Schema.Number,
  facing: Heading,
  fireCooldownMs: MillisNumber,
  knockback: Push,
  invulnerability: Invulnerability,
  recoilRemainingMs: MillisNumber,
  arsenal: Arsenal,
  reload: Reload,
  // NOTE: how long the trigger has rested with this gun in hand, held at
  // IDLE_RELOAD_MS (src/firing.ts, the idle reload below Hard).
  triggerRestMs: MillisNumber,
  charge: Charge,
  knifeCooldownMs: MillisNumber,
  melee: Melee,
  wield: Wield,
  // NOTE: what this player brought to the run (src/calling.ts). Each co-op
  // seat has its own, so every quirk reads the acting player's.
  calling: Calling,
})
export type Player = typeof Player.Type

export const ZombieKind = Schema.Literals([
  'Shambler',
  'Runner',
  'Tank',
  'Exploder',
  'Thrower',
  'Crawler',
  'Boss',
])
export type ZombieKind = typeof ZombieKind.Type

export const ZombieState = defineTaggedUnion({
  Walking: {},
  Fusing: { remainingMs: MillisNumber },
  Dying: { remainingMs: MillisNumber, direction: Heading },
})
export type ZombieState = typeof ZombieState.Type

// NOTE: an action is what a living zombie is busy with, apart from whether it
// is alive. A Big Leaguer heaves a Groaner, which is Carried, then Flying, then
// Dazed where it lands. An Ankle Biter waits Burrowed under the floor, then
// clings to the player's ankles. Winded walks like Roaming but cannot grab.
export const ZombieAction = defineTaggedUnion({
  Roaming: {},
  Winded: { remainingMs: MillisNumber },
  Hefting: {
    victimId: Schema.Number,
    remainingMs: MillisNumber,
    durationMs: MillisNumber,
  },
  Carried: { byId: Schema.Number },
  Shielding: {
    victimId: Schema.Number,
    remainingMs: MillisNumber,
    aim: Schema.Number,
  },
  Shielded: { byId: Schema.Number },
  Flying: {
    from: Point,
    to: Point,
    remainingMs: MillisNumber,
    durationMs: MillisNumber,
  },
  Dazed: { remainingMs: MillisNumber, durationMs: MillisNumber },
  Burrowed: { remainingMs: MillisNumber, durationMs: MillisNumber },
  Clinging: { remainingMs: MillisNumber },
  // NOTE: the fridge weapons' (src/fridgeWeapons.ts). Frozen is a small
  // zombie iced solid by Brain Freeze: it stands still and the next hit
  // shatters it. Chilled is a big one only slowed. Reeling is a small one
  // the Clang Pan rang: it gets up Winded, so the Pan cannot daze it again
  // at once.
  Frozen: { remainingMs: MillisNumber, durationMs: MillisNumber },
  Chilled: { remainingMs: MillisNumber },
  Reeling: { remainingMs: MillisNumber, durationMs: MillisNumber },
})
export type ZombieAction = typeof ZombieAction.Type

// NOTE: a pack of four or more that comes in together is Frenzied while its
// members stay close. A member that drifts away from the rest Fades, then is
// Spent for good. The pack id stays on it, so its kill still counts toward
// the bonus for wiping out the whole pack.
export const Frenzy = defineTaggedUnion({
  Calm: {},
  Frenzied: { pack: Schema.Number, apartMs: MillisNumber },
  Fading: { pack: Schema.Number, remainingMs: MillisNumber },
  Spent: { pack: Schema.Number },
})
export type Frenzy = typeof Frenzy.Type

export const Zombie = Schema.Struct({
  id: Schema.Number,
  kind: ZombieKind,
  x: PositionNumber,
  y: PositionNumber,
  speed: Schema.Number,
  hp: Schema.Number,
  maxHp: Schema.Number,
  knockback: Push,
  hitRemainingMs: MillisNumber,
  state: ZombieState,
  action: ZombieAction,
  frenzy: Frenzy,
})
export type Zombie = typeof Zombie.Type

export const BossAttack = Schema.Literals(['Stomp', 'Belch', 'Spit', 'Charge'])
export type BossAttack = typeof BossAttack.Type

export const PlantedAttack = Schema.Literals(['Stomp', 'Belch', 'Spit'])
export type PlantedAttack = typeof PlantedAttack.Type

// NOTE: a charge locks its target when the brace starts, so the line on the
// floor never follows the player. The rush runs past the target by the
// overshoot, and remainingPx counts down what is left of it.
export const BossMove = defineTaggedUnion({
  Stalking: { cooldownMs: MillisNumber },
  WindingUp: {
    attack: PlantedAttack,
    remainingMs: MillisNumber,
    durationMs: MillisNumber,
  },
  Bracing: {
    target: Point,
    remainingMs: MillisNumber,
    durationMs: MillisNumber,
  },
  Rushing: { direction: Heading, remainingPx: PositionNumber },
  Dazed: { remainingMs: MillisNumber, durationMs: MillisNumber },
  Recovering: { remainingMs: MillisNumber, cooldownMs: MillisNumber },
})
export type BossMove = typeof BossMove.Type

export const BossMood = Schema.Literals(['Calm', 'Enraged'])
export type BossMood = typeof BossMood.Type

export const FarAttack = Schema.Literals(['Charge', 'Spit'])
export type FarAttack = typeof FarAttack.Type

export const Glob = defineTaggedUnion({
  Flying: {
    from: Point,
    to: Point,
    remainingMs: MillisNumber,
    durationMs: MillisNumber,
  },
  Pooled: { at: Point, remainingMs: MillisNumber, durationMs: MillisNumber },
})
export type Glob = typeof Glob.Type

export const BulletGlaze = Schema.Literals(['Plain', 'Spicy', 'Mean', 'Skewer'])
export type BulletGlaze = typeof BulletGlaze.Type

export const Pierce = defineTaggedUnion({
  Stops: {},
  Skewers: { left: Schema.Number, struck: Schema.Array(Schema.Number) },
})
export type Pierce = typeof Pierce.Type

export const Bullet = Schema.Struct({
  id: Schema.Number,
  x: PositionNumber,
  y: PositionNumber,
  velocityX: VelocityNumber,
  velocityY: VelocityNumber,
  remainingMs: MillisNumber,
  weapon: WeaponKind,
  damage: Schema.Number,
  knockback: VelocityNumber,
  glaze: BulletGlaze,
  pierce: Pierce,
  // NOTE: the slot of the player or the gnome's owner who fired it, set
  // only in co-op, so a single player World is the same record it was.
  shooter: Schema.optionalKey(Schema.Number),
})
export type Bullet = typeof Bullet.Type

export const ParticleKind = Schema.Literals([
  'Blood',
  'MeatGib',
  'RotGib',
  'Shell',
  'Hull',
  'Link',
  'Dust',
  'Chip',
  'Coin',
  'BoneGib',
  'HideGib',
  'Goo',
  'Spark',
  'Splinter',
  'Plank',
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
  'Smoke',
  'Frost',
  'IceGib',
  'Fog',
])
export type ParticleKind = typeof ParticleKind.Type

export const TrapKind = Schema.Literals(['Barricade', 'Turret'])
export type TrapKind = typeof TrapKind.Type

export const DoorId = Schema.Literals([
  'North',
  'West',
  'East',
  'South',
  'Back',
  'Window',
])
export type DoorId = typeof DoorId.Type

export const LevelId = Schema.Literals(['Parlour', 'Manor'])
export type LevelId = typeof LevelId.Type

export const ExitId = Schema.String
export type ExitId = typeof ExitId.Type

// NOTE: which level the run is in and which of its boarded exits are open.
// The built Level, with its tile lookups and doors, comes from levelOf.
export const LevelState = Schema.Struct({
  id: LevelId,
  openExits: Schema.Array(ExitId),
})
export type LevelState = typeof LevelState.Type

export const Formation = Schema.Literals([
  'Trickle',
  'Squad',
  'Pincer',
  'Horde',
])
export type Formation = typeof Formation.Type

export const BoostKind = Schema.Literals([
  'RapidFire',
  'Damage',
  'Speed',
  'Pierce',
])
export type BoostKind = typeof BoostKind.Type

export const PickupKind = Schema.Literals([
  'RapidFire',
  'Damage',
  'Speed',
  'Pierce',
  'Burp',
  'Heart',
])
export type PickupKind = typeof PickupKind.Type

export const Pickup = Schema.Struct({
  id: Schema.Number,
  kind: PickupKind,
  x: PositionNumber,
  y: PositionNumber,
  ageMs: MillisNumber,
})
export type Pickup = typeof Pickup.Type

export const BoostTimer = defineTaggedUnion({
  Off: {},
  On: { remainingMs: MillisNumber, durationMs: MillisNumber },
})
export type BoostTimer = typeof BoostTimer.Type

export const Boosts = Schema.Struct({
  RapidFire: BoostTimer,
  Damage: BoostTimer,
  Speed: BoostTimer,
  Pierce: BoostTimer,
})
export type Boosts = typeof Boosts.Type

export const Prize = defineTaggedUnion({
  Settled: {},
  Owed: {},
})
export type Prize = typeof Prize.Type

// NOTE: `fridgeRngState` is the Mystery Leftovers fridge's own stream
// (src/leftovers.ts), apart from the drops' and the waves', so a pull never
// changes what drops or which zombies come.
export const Loot = Schema.Struct({
  rngState: Schema.Number,
  dryMs: MillisNumber,
  prize: Prize,
  fridgeRngState: Schema.Number,
})
export type Loot = typeof Loot.Type

// NOTE: the first grab of a kind explains it with its blurb. Every later
// grab only names it, in a shorter pop.
export const CalloutLook = Schema.Literals(['Explained', 'Named'])
export type CalloutLook = typeof CalloutLook.Type

// THE FRIDGE

// NOTE: what a pull of Mystery Leftovers gives: a fridge-only weapon, a
// moldy Sandwich that heals a heart, or a Dud (a fish skeleton) that burps
// half the price back.
export const FridgePrize = Schema.Literals([
  'Cooker',
  'Pan',
  'Freeze',
  'Sandwich',
  'Dud',
])
export type FridgePrize = typeof FridgePrize.Type

// NOTE: Open is a pull: the door creaks open, fog rolls out, and the prize
// pops up: a gag flies to the seat that pulled, a weapon goes on Offering. Slammed is the fridge resting
// after its last pull of the batch; it takes no money until it is Shut.
export const FridgeDoor = defineTaggedUnion({
  Shut: {},
  Open: {
    prize: FridgePrize,
    slot: Schema.Number,
    remainingMs: MillisNumber,
    durationMs: MillisNumber,
  },
  Slammed: { remainingMs: MillisNumber, durationMs: MillisNumber },
  // NOTE: take it or leave it (owner, 2026-10-30): a weapon prize floats
  // in the open door until the puller holds to take it, walks off, or its
  // time runs out; left, it sinks back into the fridge.
  Offering: {
    prize: FridgePrize,
    slot: Schema.Number,
    remainingMs: MillisNumber,
    durationMs: MillisNumber,
  },
})
export type FridgeDoor = typeof FridgeDoor.Type

// NOTE: `pulls` counts the pulls since the fridge last slammed; `luck`
// counts its slams, each raising the rare prize's odds a little.
export const Fridge = Schema.Struct({
  door: FridgeDoor,
  pulls: Schema.Number,
  luck: Schema.Number,
})
export type Fridge = typeof Fridge.Type

// NOTE: a Pressure Cooker lid in flight, from where it was thrown to where
// it lands; `charge` (0 to 1) and `tier` size its blast. It names the seat
// that threw it, as a bullet does, only in co-op.
export const Lob = Schema.Struct({
  id: Schema.Number,
  x: PositionNumber,
  y: PositionNumber,
  from: Point,
  to: Point,
  remainingMs: MillisNumber,
  durationMs: MillisNumber,
  charge: Schema.Number,
  tier: Schema.Number,
  shooter: Schema.optionalKey(Schema.Number),
})
export type Lob = typeof Lob.Type

export const Callout = Schema.Struct({
  kind: PickupKind,
  look: CalloutLook,
  x: Schema.Number,
  y: Schema.Number,
  ageMs: MillisNumber,
})
export type Callout = typeof Callout.Type

// NOTE: a cosmetic: Rattles sliding a box of rounds across the ammo
// window's counter after a sale mid-wave, with `line` picking what he says
// (src/ammoCounter.ts). Never part of the World.
export const CounterSale = defineTaggedUnion({
  Quiet: {},
  Selling: { ageMs: Schema.Number, line: Schema.Number },
})
export type CounterSale = typeof CounterSale.Type
