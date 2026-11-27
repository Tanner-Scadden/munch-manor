import { Schema } from 'effect'

import { UiSchema } from '@effect/ui'

import { Calling } from '#shared/records/playerData.ts'

import {
  Heading,
  MillisNumber,
  Point,
  PositionNumber,
  Push,
  VelocityNumber,
} from './wireNumber.ts'

export const Vector = Schema.Struct({ x: Schema.Finite, y: Schema.Finite })
export type Vector = typeof Vector.Type

export const Trigger = Schema.Literals(['Released', 'Held'])
export type Trigger = typeof Trigger.Type

export const Intent = Schema.Struct({
  move: Heading,
  maybeAim: Schema.Option(Heading),
  trigger: Trigger,
  interact: Trigger,
})
export type Intent = typeof Intent.Type

export const Invulnerability = UiSchema.TaggedEnum({
  Vulnerable: {},
  Invulnerable: { remainingMs: MillisNumber, durationMs: MillisNumber },
})
export type Invulnerability = typeof Invulnerability.Type

export const WeaponKind = Schema.Literals([
  'Pistol',
  'Shotgun',
  'Smg',
  'Peashooter',
  'Cooker',
  'Pan',
  'Freeze',
  'Rifle',
  'Blunderbuss',
])
export type WeaponKind = typeof WeaponKind.Type

export const GunPerk = Schema.Literals(['Spicy', 'Crispy', 'Hearty'])
export type GunPerk = typeof GunPerk.Type

export const CarriedGun = Schema.Struct({
  kind: WeaponKind,
  loaded: Schema.Finite,
  tier: Schema.Finite,
  kills: Schema.Finite,
  perk: Schema.optionalKey(GunPerk),
})
export type CarriedGun = typeof CarriedGun.Type

export const Arsenal = UiSchema.TaggedEnum({
  OneGun: { first: CarriedGun },
  HoldingFirst: { first: CarriedGun, second: CarriedGun },
  HoldingSecond: { first: CarriedGun, second: CarriedGun },
})
export type Arsenal = typeof Arsenal.Type

export const Melee = UiSchema.TaggedEnum({
  Knife: {},
  Pan: { pan: CarriedGun },
})
export type Melee = typeof Melee.Type

const Wield = Schema.Literals(['Gun', 'Melee'])
type Wield = typeof Wield.Type

export const Reload = UiSchema.TaggedEnum({
  Ready: {},
  Reloading: { remainingMs: MillisNumber, durationMs: MillisNumber },
})
export type Reload = typeof Reload.Type

export const Charge = UiSchema.TaggedEnum({
  Idle: {},
  Building: { heldMs: MillisNumber, aim: Point },
  Spent: {},
})
export type Charge = typeof Charge.Type

export const Player = Schema.Struct({
  x: PositionNumber,
  y: PositionNumber,
  hp: Schema.Finite,
  facing: Heading,
  fireCooldownMs: MillisNumber,
  knockback: Push,
  invulnerability: Invulnerability,
  recoilRemainingMs: MillisNumber,
  arsenal: Arsenal,
  reload: Reload,
  triggerRestMs: MillisNumber,
  charge: Charge,
  knifeCooldownMs: MillisNumber,
  melee: Melee,
  wield: Wield,
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

export const ZombieState = UiSchema.TaggedEnum({
  Walking: {},
  Fusing: { remainingMs: MillisNumber },
  Dying: { remainingMs: MillisNumber, direction: Heading },
})
export type ZombieState = typeof ZombieState.Type

export const ZombieAction = UiSchema.TaggedEnum({
  Roaming: {},
  Winded: { remainingMs: MillisNumber },
  Hefting: {
    victimId: Schema.Finite,
    remainingMs: MillisNumber,
    durationMs: MillisNumber,
  },
  Carried: { byId: Schema.Finite },
  Shielding: {
    victimId: Schema.Finite,
    remainingMs: MillisNumber,
    aim: Schema.Finite,
  },
  Shielded: { byId: Schema.Finite },
  Flying: {
    from: Point,
    to: Point,
    remainingMs: MillisNumber,
    durationMs: MillisNumber,
  },
  Dazed: { remainingMs: MillisNumber, durationMs: MillisNumber },
  Burrowed: { remainingMs: MillisNumber, durationMs: MillisNumber },
  Clinging: { remainingMs: MillisNumber },
  Frozen: { remainingMs: MillisNumber, durationMs: MillisNumber },
  Chilled: { remainingMs: MillisNumber },
  Reeling: { remainingMs: MillisNumber, durationMs: MillisNumber },
})
export type ZombieAction = typeof ZombieAction.Type

export const Frenzy = UiSchema.TaggedEnum({
  Calm: {},
  Frenzied: { pack: Schema.Finite, apartMs: MillisNumber },
  Fading: { pack: Schema.Finite, remainingMs: MillisNumber },
  Spent: { pack: Schema.Finite },
})
export type Frenzy = typeof Frenzy.Type

export const Zombie = Schema.Struct({
  id: Schema.Finite,
  kind: ZombieKind,
  x: PositionNumber,
  y: PositionNumber,
  speed: Schema.Finite,
  hp: Schema.Finite,
  maxHp: Schema.Finite,
  knockback: Push,
  hitRemainingMs: MillisNumber,
  state: ZombieState,
  action: ZombieAction,
  frenzy: Frenzy,
})
export type Zombie = typeof Zombie.Type

export const BossAttack = Schema.Literals([
  'Stomp',
  'Slam',
  'Belch',
  'Spit',
  'Charge',
])
export type BossAttack = typeof BossAttack.Type

export const PlantedAttack = Schema.Literals(['Stomp', 'Slam', 'Belch', 'Spit'])
export type PlantedAttack = typeof PlantedAttack.Type

export const BossMove = UiSchema.TaggedEnum({
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

export const Glob = UiSchema.TaggedEnum({
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

export const Pierce = UiSchema.TaggedEnum({
  Stops: {},
  Skewers: { left: Schema.Finite, struck: Schema.Array(Schema.Finite) },
})
export type Pierce = typeof Pierce.Type

export const Bullet = Schema.Struct({
  id: Schema.Finite,
  x: PositionNumber,
  y: PositionNumber,
  velocityX: VelocityNumber,
  velocityY: VelocityNumber,
  remainingMs: MillisNumber,
  weapon: WeaponKind,
  damage: Schema.Finite,
  knockback: VelocityNumber,
  glaze: BulletGlaze,
  pierce: Pierce,
  shooter: Schema.optionalKey(Schema.Finite),
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
  'FryingPan',
  'StockPot',
  'Smoke',
  'Frost',
  'IceGib',
  'Fog',
  'Confetti',
  'Splash',
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
  'WestTop',
  'WestBottom',
  'EastTop',
  'EastBottom',
  'FarTop',
  'FarBottom',
  'Front',
])
export type DoorId = typeof DoorId.Type

const LevelId = Schema.Literals(['Parlour', 'Manor'])

export const ExitId = Schema.String
export type ExitId = typeof ExitId.Type

export const SlotRoomId = Schema.Literals(['Parlour', 'Library', 'Cellar'])
export type SlotRoomId = typeof SlotRoomId.Type

export const Arrangement = Schema.Struct({
  West: SlotRoomId,
  East: SlotRoomId,
  Far: SlotRoomId,
})
export type Arrangement = typeof Arrangement.Type

export const LevelState = Schema.Struct({
  id: LevelId,
  arrangement: Arrangement,
  openExits: Schema.Array(ExitId),
  dropped: Schema.Array(Schema.String),
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
  id: Schema.Finite,
  kind: PickupKind,
  x: PositionNumber,
  y: PositionNumber,
  ageMs: MillisNumber,
})
export type Pickup = typeof Pickup.Type

export const BoostTimer = UiSchema.TaggedEnum({
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

export const Prize = UiSchema.TaggedEnum({
  Settled: {},
  Owed: {},
})
export type Prize = typeof Prize.Type

export const Loot = Schema.Struct({
  rngState: Schema.Finite,
  dryMs: MillisNumber,
  prize: Prize,
  fridgeRngState: Schema.Finite,
})
export type Loot = typeof Loot.Type

export const CalloutLook = Schema.Literals(['Explained', 'Named'])
export type CalloutLook = typeof CalloutLook.Type

export const FridgePrize = Schema.Literals([
  'Cooker',
  'Pan',
  'Freeze',
  'Sandwich',
  'Dud',
])
export type FridgePrize = typeof FridgePrize.Type

export const FridgeDoor = UiSchema.TaggedEnum({
  Shut: {},
  Open: {
    prize: FridgePrize,
    slot: Schema.Finite,
    remainingMs: MillisNumber,
    durationMs: MillisNumber,
  },
  Slammed: { remainingMs: MillisNumber, durationMs: MillisNumber },
  Offering: {
    prize: FridgePrize,
    slot: Schema.Finite,
    remainingMs: MillisNumber,
    durationMs: MillisNumber,
  },
})
export type FridgeDoor = typeof FridgeDoor.Type

export const Fridge = Schema.Struct({
  door: FridgeDoor,
  pulls: Schema.Finite,
  luck: Schema.Finite,
})
export type Fridge = typeof Fridge.Type

export const PantryGoodie = Schema.Literals(['Key', 'Heart'])
export type PantryGoodie = typeof PantryGoodie.Type

export const Pantry = UiSchema.TaggedEnum({
  Bare: { round: Schema.Finite },
  Stocked: { round: Schema.Finite, goodie: PantryGoodie },
})
export type Pantry = typeof Pantry.Type
export type PantryStash = typeof Pantry.cases.Stocked.Type

export const CrateRoom = Schema.Literals([
  'Dining',
  'Kitchen',
  'Parlour',
  'Library',
  'Cellar',
])
export type CrateRoom = typeof CrateRoom.Type

export const CrateStock = UiSchema.TaggedEnum({
  Stocked: { trap: TrapKind },
  Heart: {},
  Taken: {},
})
export type CrateStock = typeof CrateStock.Type

export const Crate = Schema.Struct({ room: CrateRoom, stock: CrateStock })
export type Crate = typeof Crate.Type

export const KeyRing = Schema.Struct({
  held: Schema.Finite,
  found: Schema.Finite,
  spent: Schema.Finite,
  rngState: Schema.Finite,
})
export type KeyRing = typeof KeyRing.Type

export const TrapCrates = Schema.Struct({
  rngState: Schema.Finite,
  wave: Schema.Finite,
  crates: Schema.Array(Crate),
})
export type TrapCrates = typeof TrapCrates.Type

export const Lob = Schema.Struct({
  id: Schema.Finite,
  x: PositionNumber,
  y: PositionNumber,
  from: Point,
  to: Point,
  remainingMs: MillisNumber,
  durationMs: MillisNumber,
  charge: Schema.Finite,
  tier: Schema.Finite,
  shooter: Schema.optionalKey(Schema.Finite),
})
export type Lob = typeof Lob.Type

export const Stove = Schema.Struct({
  rngState: Schema.Finite,
  perk: GunPerk,
  wave: Schema.Finite,
})
export type Stove = typeof Stove.Type

export const Cooking = Schema.Struct({
  cooks: Schema.Finite,
  lastWave: Schema.Finite,
})
export type Cooking = typeof Cooking.Type

export const GasValve = UiSchema.TaggedEnum({
  Shut: {},
  Lit: { owner: Schema.Finite, nextBurnMs: MillisNumber },
})
export type GasValve = typeof GasValve.Type

export const StationId = Schema.Literals([
  'Cleat',
  'Gramophone',
  'NorthStack',
  'SouthStack',
  'Shelf',
  'Barrels',
  'Bulb',
  'SoupPot',
])
export type StationId = typeof StationId.Type

export const StationState = Schema.Struct({
  workedMs: MillisNumber,
  cooldownMs: MillisNumber,
  timesWorked: Schema.Finite,
})
export type StationState = typeof StationState.Type

export const Stations = Schema.Struct({
  Cleat: StationState,
  Gramophone: StationState,
  NorthStack: StationState,
  SouthStack: StationState,
  Shelf: StationState,
  Barrels: StationState,
  Bulb: StationState,
  SoupPot: StationState,
})
export type Stations = typeof Stations.Type

export const Callout = Schema.Struct({
  kind: PickupKind,
  look: CalloutLook,
  x: Schema.Finite,
  y: Schema.Finite,
  ageMs: MillisNumber,
})
export type Callout = typeof Callout.Type
