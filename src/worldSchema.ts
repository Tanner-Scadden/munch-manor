// The World's Schemas and starting values, and the plain Schemas beside
// them, apart from the client Model (src/model.ts), so the step a co-op
// room runs never imports the UI, the sync engine, or the tip jar.

import { Effect, Option, Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

import { PARLOUR } from './arena'
import { PISTOL_MAGAZINE, PLAYER_MAX_HP } from './constants'
import {
  Arsenal,
  BoostKind,
  BoostTimer,
  Boosts,
  BossAttack,
  BossMood,
  BossMove,
  Bullet,
  Charge,
  DoorId,
  ExitId,
  FarAttack,
  Formation,
  Fridge,
  FridgeDoor,
  FridgePrize,
  Glob,
  Intent,
  Invulnerability,
  LevelState,
  Lob,
  Loot,
  Melee,
  Pickup,
  PickupKind,
  Player,
  Prize,
  Reload,
  TrapKind,
  Vector,
  WeaponKind,
  Zombie,
  ZombieKind,
} from './entitySchema'
import { Difficulty } from './playerData'
import { Heading, MillisNumber, PositionNumber, UnitNumber } from './wireNumber'

export {
  Appearance,
  Body,
  Difficulty,
  HairColor,
  HairStyle,
  Outfit,
  Print,
  RotationSetting,
  ShirtColor,
  SkinTone,
} from './playerData'
export * from './entitySchema'

// NOTE: a shot names the seat that fired it (a PlayerSlot), so a co-op
// client can tell its own shots, which it predicts, from the room's; a
// trap's shot names none.
export const GameEvent = defineTaggedUnion({
  Fired: {
    x: PositionNumber,
    y: PositionNumber,
    direction: Heading,
    weapon: WeaponKind,
    maybeShooter: Schema.Option(Schema.Number),
  },
  ZombieHit: {
    x: PositionNumber,
    y: PositionNumber,
    direction: Heading,
    damage: Schema.Number,
    kind: ZombieKind,
    maybeShooter: Schema.Option(Schema.Number),
  },
  ZombieKilled: {
    x: PositionNumber,
    y: PositionNumber,
    direction: Heading,
    bounty: Schema.Number,
    kind: ZombieKind,
  },
  Exploded: { x: PositionNumber, y: PositionNumber, radius: Schema.Number },
  Footfall: {
    x: PositionNumber,
    y: PositionNumber,
    kind: ZombieKind,
    nearness: Schema.Number,
  },
  PlayerHurt: {
    x: PositionNumber,
    y: PositionNumber,
    direction: Heading,
    source: ZombieKind,
  },
  BulletStruck: { x: PositionNumber, y: PositionNumber, direction: Heading },
  RanDry: { x: PositionNumber, y: PositionNumber },
  DryFired: { x: PositionNumber, y: PositionNumber },
  ReloadStarted: {
    x: PositionNumber,
    y: PositionNumber,
    direction: Heading,
    weapon: WeaponKind,
  },
  Reloaded: { x: PositionNumber, y: PositionNumber, weapon: WeaponKind },
  WaveCleared: { x: PositionNumber, y: PositionNumber, bonus: Schema.Number },
  PackWarned: {
    x: PositionNumber,
    y: PositionNumber,
    door: DoorId,
    formation: Formation,
  },
  TrapHit: { x: PositionNumber, y: PositionNumber, kind: TrapKind },
  TrapCracked: { x: PositionNumber, y: PositionNumber, kind: TrapKind },
  TrapBroken: { x: PositionNumber, y: PositionNumber, kind: TrapKind },
  PickupDropped: { x: PositionNumber, y: PositionNumber, kind: PickupKind },
  PickupGrabbed: { x: PositionNumber, y: PositionNumber, kind: PickupKind },
  PickupFizzled: { x: PositionNumber, y: PositionNumber },
  BoostFaded: { x: PositionNumber, y: PositionNumber, kind: BoostKind },
  Burped: { x: PositionNumber, y: PositionNumber, radius: Schema.Number },
  PartShed: {
    x: PositionNumber,
    y: PositionNumber,
    direction: Heading,
    kind: ZombieKind,
    stage: Schema.Number,
  },
  BossRoared: { x: PositionNumber, y: PositionNumber, door: DoorId },
  BossWoundUp: { x: PositionNumber, y: PositionNumber, attack: BossAttack },
  BossStomped: { x: PositionNumber, y: PositionNumber, radius: Schema.Number },
  BossBelched: { x: PositionNumber, y: PositionNumber },
  BossRushed: { x: PositionNumber, y: PositionNumber, direction: Heading },
  BossRammed: { x: PositionNumber, y: PositionNumber, direction: Heading },
  BossBonked: { x: PositionNumber, y: PositionNumber, direction: Heading },
  BossSpat: { x: PositionNumber, y: PositionNumber },
  GlobLanded: { x: PositionNumber, y: PositionNumber, radius: Schema.Number },
  BossEnraged: { x: PositionNumber, y: PositionNumber },
  ZombieGrabbed: { x: PositionNumber, y: PositionNumber },
  ShieldRaised: { x: PositionNumber, y: PositionNumber },
  ZombieThrown: { x: PositionNumber, y: PositionNumber },
  ZombieLanded: { x: PositionNumber, y: PositionNumber, radius: Schema.Number },
  CrawlerStirred: { x: PositionNumber, y: PositionNumber },
  CrawlerSurfaced: { x: PositionNumber, y: PositionNumber },
  AnklesGrabbed: { x: PositionNumber, y: PositionNumber },
  PackFrenzied: { x: PositionNumber, y: PositionNumber, door: DoorId },
  PackWiped: { x: PositionNumber, y: PositionNumber, bonus: Schema.Number },
  OvenBelched: { x: PositionNumber, y: PositionNumber },
  Purchased: { x: PositionNumber, y: PositionNumber },
  PurchaseRefused: { x: PositionNumber, y: PositionNumber },
  ExitOpened: { x: PositionNumber, y: PositionNumber },
  FridgeOpened: { x: PositionNumber, y: PositionNumber, prize: FridgePrize },
  FridgeSlammed: { x: PositionNumber, y: PositionNumber },
  PrizeTaken: { x: PositionNumber, y: PositionNumber },
  PrizeLeft: { x: PositionNumber, y: PositionNumber },
  DudBurped: { x: PositionNumber, y: PositionNumber, refund: Schema.Number },
  LidLaunched: { x: PositionNumber, y: PositionNumber, direction: Heading },
  LidBlasted: { x: PositionNumber, y: PositionNumber, radius: Schema.Number },
  CookerPopped: { x: PositionNumber, y: PositionNumber, direction: Heading },
  PanSwung: { x: PositionNumber, y: PositionNumber, direction: Heading },
  PanClanged: { x: PositionNumber, y: PositionNumber, direction: Heading },
  PanSmashed: { x: PositionNumber, y: PositionNumber, radius: Schema.Number },
  PanFlattened: { x: PositionNumber, y: PositionNumber },
  KnifeStabbed: { x: PositionNumber, y: PositionNumber, direction: Heading },
  KnifeHit: { x: PositionNumber, y: PositionNumber, direction: Heading },
  HomeRun: { x: PositionNumber, y: PositionNumber, direction: Heading },
  FreezeSprayed: { x: PositionNumber, y: PositionNumber, direction: Heading },
  ZombieFrozen: { x: PositionNumber, y: PositionNumber },
  ZombieShattered: { x: PositionNumber, y: PositionNumber, kind: ZombieKind },
  ZombieSlipped: { x: PositionNumber, y: PositionNumber },
  PlayerDowned: { x: PositionNumber, y: PositionNumber },
  PlayerRevived: { x: PositionNumber, y: PositionNumber },
  FriendlyFire: { x: PositionNumber, y: PositionNumber, direction: Heading },
})
export type GameEvent = typeof GameEvent.Type

export const HitStop = defineTaggedUnion({
  Running: { cooldownMs: MillisNumber },
  Frozen: { remainingMs: MillisNumber },
  Slowed: { remainingMs: MillisNumber, carryMs: MillisNumber },
})
export type HitStop = typeof HitStop.Type

export const Shake = Schema.Struct({ trauma: Schema.Number, offset: Vector })
export type Shake = typeof Shake.Type

export const PopupKind = Schema.Literals([
  'Damage',
  'Kill',
  'Payday',
  'Empty',
  'Horde',
  'Wipe',
  'Kaboom',
])
export type PopupKind = typeof PopupKind.Type

export const Popup = Schema.Struct({
  kind: PopupKind,
  value: Schema.Number,
  x: Schema.Number,
  y: Schema.Number,
  velocityX: Schema.Number,
  ageMs: MillisNumber,
})
export type Popup = typeof Popup.Type

export const Streak = defineTaggedUnion({
  Cold: {},
  Hot: { count: Schema.Number, remainingMs: MillisNumber },
})
export type Streak = typeof Streak.Type

export const GunSlot = Schema.Literals(['First', 'Second'])
export type GunSlot = typeof GunSlot.Type

// NOTE: JustUnlocked is the run that won Hard and its end screen. It
// settles to Unlocked when the next run starts.
export const NightmareLock = Schema.Literals([
  'Locked',
  'JustUnlocked',
  'Unlocked',
])
export type NightmareLock = typeof NightmareLock.Type

// NOTE: the chosen difficulty and the Nightmare unlock are kept in the
// on-device save (src/save.ts). They are plain data on purpose: they move
// into the SQLite player scope from PLATFORM.md beside the look.
export const DifficultySetting = Schema.Struct({
  chosen: Difficulty,
  nightmare: NightmareLock,
})
export type DifficultySetting = typeof DifficultySetting.Type

// NOTE: the furthest campaign wave and the most kills in one run are the
// run records, saved apart from the bests (SavedRunRecords).
export const DifficultyBests = Schema.Struct({
  maybeFastestWinMs: Schema.Option(Schema.Number),
  maybeBestEndlessWave: Schema.Option(Schema.Number),
  maybeFurthestWave: Schema.Option(Schema.Number),
  maybeMostKills: Schema.Option(Schema.Number),
})
export type DifficultyBests = typeof DifficultyBests.Type

export const KillCounts = Schema.Struct({
  Shambler: Schema.Number,
  Runner: Schema.Number,
  Tank: Schema.Number,
  Exploder: Schema.Number,
  Thrower: Schema.Number,
  Crawler: Schema.Number,
  Boss: Schema.Number,
})
export type KillCounts = typeof KillCounts.Type

export const PlannedSpawn = Schema.Struct({
  atMs: MillisNumber,
  kind: ZombieKind,
  door: DoorId,
  offset: PositionNumber,
  speedScale: UnitNumber,
  hpScale: UnitNumber,
  pack: Schema.Number,
  formation: Formation,
})
export type PlannedSpawn = typeof PlannedSpawn.Type

// NOTE: a Counting break starts the wave when remainingMs runs out. A
// Waiting break has no timer: it waits for START WAVE, and its elapsedMs only
// ages the hints and banners. remainingMs and durationMs stay put meanwhile.
export const BreakClock = defineTaggedUnion({
  Counting: {},
  Waiting: { elapsedMs: MillisNumber },
})
export type BreakClock = typeof BreakClock.Type

const preparationFields = {
  wave: Schema.Number,
  remainingMs: MillisNumber,
  durationMs: MillisNumber,
  spawns: Schema.Array(PlannedSpawn),
  clock: BreakClock.pipe(
    Schema.withConstructorDefault(Effect.succeed(BreakClock.Counting())),
  ),
}

// NOTE: A wave's elapsedMs is its spawn clock, not wall time. It stops while
// the pacing beat is Fading or Resting.
const waveFields = {
  wave: Schema.Number,
  elapsedMs: MillisNumber,
  spawns: Schema.Array(PlannedSpawn),
}

export const Round = defineTaggedUnion({
  Preparation: preparationFields,
  Wave: waveFields,
})
export type Round = typeof Round.Type

export const RunMode = defineTaggedUnion({
  Campaign: {},
  Endless: {},
})
export type RunMode = typeof RunMode.Type

export const Phase = defineTaggedUnion({
  Ready: {},
  Preparation: preparationFields,
  Wave: waveFields,
  Paused: { round: Round },
  Victory: {},
  GameOver: { wave: Schema.Number },
})
export type Phase = typeof Phase.Type

// NOTE: A boss wave holds its boss outside until only waitBelow planned
// spawns are left, then rattles its door for the entrance before it walks in.
// While it arrives and for its first seconds in the room, the wave clock
// waits, so the rest of the wave comes after the boss has had the floor.
export const Boss = defineTaggedUnion({
  Absent: {},
  Waiting: { door: DoorId, waitBelow: Schema.Number, hp: Schema.Number },
  Arriving: {
    door: DoorId,
    hp: Schema.Number,
    remainingMs: MillisNumber,
    durationMs: MillisNumber,
  },
  Fighting: {
    id: Schema.Number,
    move: BossMove,
    standingMs: MillisNumber,
    mood: BossMood,
    nextFar: FarAttack,
    belchMs: MillisNumber,
    globs: Schema.Array(Glob),
  },
})
export type Boss = typeof Boss.Type

// NOTE: a frenzy pack pays its bonus once every one of its zombies has been
// killed. left counts the ones still to kill, including any still waiting
// outside behind the alive cap.
export const FrenzyPack = Schema.Struct({
  pack: Schema.Number,
  left: Schema.Number,
  bonus: Schema.Number,
})
export type FrenzyPack = typeof FrenzyPack.Type

export const Hold = Schema.Struct({
  atMs: MillisNumber,
  releaseBelow: Schema.Number,
  relaxMs: MillisNumber,
})
export type Hold = typeof Hold.Type

export const Beat = defineTaggedUnion({
  Flowing: {},
  Fading: {
    releaseBelow: Schema.Number,
    relaxMs: MillisNumber,
    waitedMs: MillisNumber,
  },
  Resting: {
    remainingMs: MillisNumber,
    extendedMs: MillisNumber,
    trickled: Schema.Number,
  },
})
export type Beat = typeof Beat.Type

export const Alarm = defineTaggedUnion({
  Quiet: {},
  Ringing: { remainingMs: MillisNumber },
})
export type Alarm = typeof Alarm.Type

// NOTE: the door a warned pack will come through, kept from its warning on
// so a plank breaking after the rattle cannot move it.
export const PackDoor = Schema.Struct({
  pack: Schema.Number,
  planned: DoorId,
  door: DoorId,
})
export type PackDoor = typeof PackDoor.Type

export const Pacing = Schema.Struct({
  holds: Schema.Array(Hold),
  beat: Beat,
  warnedPacks: Schema.Array(Schema.Number),
  packDoors: Schema.Array(PackDoor),
  alarm: Alarm,
  quietMs: MillisNumber,
})
export type Pacing = typeof Pacing.Type

export const Toll = Schema.Struct({
  index: Schema.Number,
  cost: Schema.Number,
})
export type Toll = typeof Toll.Type

// NOTE: originIndex is the tile the field flows to. In co-op it flows to
// every living player at once: the other players' tiles are moreOrigins.
export const FlowField = Schema.Struct({
  levelKey: Schema.String,
  originIndex: Schema.Number,
  moreOrigins: Schema.Array(Schema.Number),
  tolls: Schema.Array(Toll),
  distances: Schema.Array(Schema.Number),
})
export type FlowField = typeof FlowField.Type

export const Blast = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
  radius: Schema.Number,
  ageMs: MillisNumber,
})
export type Blast = typeof Blast.Type

export const FixedShopItemId = Schema.Literals([
  'Shotgun',
  'ShotgunShells',
  'ShotgunUpgrade',
  'Smg',
  'SmgRounds',
  'SmgUpgrade',
  'PistolUpgrade',
  'LaserSight',
  'Heart',
  'Barricade',
  'Turret',
  'CookerUpgrade',
  'LidStack',
  'PanUpgrade',
  'Pistol',
])
export type FixedShopItemId = typeof FixedShopItemId.Type

// NOTE: a placed trap is repaired on its own, so its repair row is named by
// the trap's id.
export const RepairItemId = Schema.TemplateLiteral(['Repair-', Schema.Number])
export type RepairItemId = typeof RepairItemId.Type

export const ShopItemId = Schema.Union([FixedShopItemId, RepairItemId])
export type ShopItemId = typeof ShopItemId.Type

// NOTE: the laser sight is bought in the shop for one run: a line or a
// spread fan on the floor showing where the held gun's shot goes.
const LaserSight = Schema.Literals(['None', 'Fitted'])
type LaserSight = typeof LaserSight.Type

export const ShopCategory = Schema.Literals(['Guns', 'Health', 'Traps'])
export type ShopCategory = typeof ShopCategory.Type

export const ShopState = defineTaggedUnion({
  Away: {},
  Browsing: { focusedItem: ShopItemId },
  Dismissed: {},
})
export type ShopState = typeof ShopState.Type

// NOTE: something in the world bought by standing still or holding the
// interact key beside it, the way a wall buy works (src/purchase.ts): a
// boarded exit, the Mystery Leftovers fridge (src/leftovers.ts) and its
// prize, or mid-wave the held gun's ammo at the stall (src/ammoCounter.ts).
export const Purchasable = defineTaggedUnion({
  Exit: { exit: ExitId },
  Fridge: {},
  Prize: {},
  Ammo: {},
})
export type Purchasable = typeof Purchasable.Type

// NOTE: one player's hold at a purchasable. Holding fills toward the buy,
// from the key held or the player standing still (src/purchase.ts);
// Refused is a press the wallet could not cover, shaking for a moment;
// Done waits for the key to be let go after a buy, so one hold buys once;
// Spent waits for a player who bought and stands still to move before
// standing buys again, so one buy never chains into the next. Tapped is a
// tap at the ammo window (SeatAction.BuyAmmo), bought on the next tick with
// no hold, so the tick's events carry its sound and Rattles' line.
export const Purchase = defineTaggedUnion({
  Idle: {},
  Holding: { target: Purchasable, heldMs: MillisNumber },
  Refused: {
    target: Purchasable,
    shortBy: Schema.Number,
    sinceMs: MillisNumber,
  },
  Done: {},
  Spent: {},
  Tapped: { target: Purchasable },
})
export type Purchase = typeof Purchase.Type

export const ShopChatter = defineTaggedUnion({
  Greeting: {},
  Bought: { item: ShopItemId },
  TooPricey: { item: ShopItemId },
  Refused: { item: ShopItemId },
})
export type ShopChatter = typeof ShopChatter.Type

// NOTE: a kitchen oven belches fire when it is shot while Ready, then cools
// off before it can again. The Model keeps one per oven on the map, in the
// order the map lists them.
export const Oven = defineTaggedUnion({
  Ready: {},
  Belching: { remainingMs: MillisNumber, burnedTicks: Schema.Number },
  Cooling: { remainingMs: MillisNumber },
})
export type Oven = typeof Oven.Type

export const Wallet = Schema.Struct({
  balance: Schema.Number,
  earned: Schema.Number,
  shown: Schema.Number,
})
export type Wallet = typeof Wallet.Type

export const TurretGun = defineTaggedUnion({
  Armed: {},
  CoolingDown: { remainingMs: MillisNumber },
})
export type TurretGun = typeof TurretGun.Type

export const Trap = defineTaggedUnion({
  Barricade: {
    id: Schema.Number,
    door: DoorId,
    hp: Schema.Number,
    hitRemainingMs: MillisNumber,
  },
  Turret: {
    id: Schema.Number,
    column: Schema.Number,
    row: Schema.Number,
    hp: Schema.Number,
    hitRemainingMs: MillisNumber,
    facing: Heading,
    gun: TurretGun,
  },
})
export type Trap = typeof Trap.Type
export type Turret = typeof Trap.Turret.Type

export const TrapCounts = Schema.Struct({
  Barricade: Schema.Number,
  Turret: Schema.Number,
})
export type TrapCounts = typeof TrapCounts.Type

export const TrapHint = defineTaggedUnion({
  Unseen: {},
  Showing: {},
  Seen: {},
})
export type TrapHint = typeof TrapHint.Type

export const TrapNotice = defineTaggedUnion({
  Quiet: {},
  Refused: { reason: Schema.String, remainingMs: MillisNumber },
})
export type TrapNotice = typeof TrapNotice.Type

export const Lesson = defineTaggedUnion({
  Pending: {},
  Learned: { atMs: MillisNumber },
})
export type Lesson = typeof Lesson.Type

export const Lessons = Schema.Struct({
  move: Lesson,
  fire: Lesson,
  startWave: Lesson,
  shop: Lesson,
  swap: Lesson,
  pickup: Lesson,
  timedBreaks: Lesson,
  openBreak: Lesson,
})
export type Lessons = typeof Lessons.Type

export const Practice = Schema.Struct({
  movedPx: Schema.Number,
  aimedShots: Schema.Number,
})
export type Practice = typeof Practice.Type

export const DebutCard = defineTaggedUnion({
  Hidden: {},
  Showing: { kind: ZombieKind, ageMs: MillisNumber },
})
export type DebutCard = typeof DebutCard.Type

export const RunStats = Schema.Struct({
  kills: KillCounts,
  wavesCleared: Schema.Number,
  shotsFired: Schema.Number,
  shotsHit: Schema.Number,
  heartsLost: Schema.Number,
  trapsPlaced: Schema.Number,
  purchases: Schema.Number,
  powerUpsGrabbed: Schema.Number,
  maybeLastHurtBy: Schema.Option(ZombieKind),
  activeFrames: Schema.Number,
  activeFrameMs: MillisNumber,
  runMs: MillisNumber,
})
export type RunStats = typeof RunStats.Type

// CO-OP

// NOTE: a player is keyed by their seat in the room. Single player is the
// one seat SOLO_SLOT.
export const PlayerSlot = Schema.Number
export type PlayerSlot = typeof PlayerSlot.Type

export const SOLO_SLOT: PlayerSlot = 0

// NOTE: in co-op a player at zero hearts is Downed: they crawl, cannot
// shoot, and bleed out when bleedMs runs out, unless a teammate standing
// still beside them fills reviveMs first. A BledOut player is out of the
// fight until the next break (MULTIPLAYER.md, decided row 4).
export const Life = defineTaggedUnion({
  Standing: {},
  Downed: { bleedMs: MillisNumber, reviveMs: MillisNumber },
  BledOut: {},
})
export type Life = typeof Life.Type
export type DownedLife = typeof Life.Downed.Type

// NOTE: an Away player sent no input for a while (decided row 10): frozen
// in place, and zombies can still hurt them.
export const Presence = Schema.Literals(['Here', 'Away'])
export type Presence = typeof Presence.Type

const Readiness = Schema.Literals(['Waiting', 'Ready'])
type Readiness = typeof Readiness.Type

// NOTE: what co-op adds to a player: their seat, life, presence, READY for
// the break, the traps they placed (one of each kind, decided row 21), and
// the kills credited to them.
// NOTE: `graceMs` is how long a zombie must keep touching this player
// before its first bite lands, half their round trip and at most 100 ms
// (MULTIPLAYER.md, "Latency"), so a dodge they made on their own screen
// counts; `touchedMs` is how long one has touched them so far. Both stay 0
// for a player with no lag.
export const Seat = Schema.Struct({
  slot: PlayerSlot,
  life: Life,
  presence: Presence,
  readiness: Readiness,
  trapIds: Schema.Array(Schema.Number),
  kills: Schema.Number,
  graceMs: MillisNumber,
  touchedMs: MillisNumber,
})
export type Seat = typeof Seat.Type

// NOTE: a teammate's own copy of every per-player World field.
export const Mate = Schema.Struct({
  seat: Seat,
  player: Player,
  intent: Intent,
  wallet: Wallet,
  boosts: Boosts,
  trapStock: TrapCounts,
  selectedTrap: TrapKind,
  shop: ShopState,
  shopCategory: ShopCategory,
  laserSight: LaserSight,
  purchase: Purchase,
})
export type Mate = typeof Mate.Type

// NOTE: Solo is single player, exactly as it always played. A Crew holds
// one player in the World's own per-player fields (player, intent, wallet,
// and the rest), whose seat is lead, and every other player as a Mate. The
// lead is whichever seat sits in those fields: the step swaps each seat in
// to run the per-player systems on it, and a client may keep its own seat
// there to draw it.
export const Party = defineTaggedUnion({
  Solo: {},
  Crew: { lead: Seat, mates: Schema.Array(Mate) },
})
export type Party = typeof Party.Type

// NOTE: the World is the part of the Model the step reads and writes: what
// a co-op room owns and runs (MULTIPLAYER.md, Phase 0). The rest of the
// Model is the client's: dialogs, menus, input, the camera, cosmetics,
// audio, settings, and the save. The lessons, practice, and new zombie
// card are single player gates the step reads; the room plays with them
// settled.
export const World = Schema.Struct({
  phase: Phase,
  pacing: Pacing,
  boss: Boss,
  frenzyPacks: Schema.Array(FrenzyPack),
  intensity: UnitNumber,
  mode: RunMode,
  difficulty: DifficultySetting,
  player: Player,
  zombies: Schema.Array(Zombie),
  bullets: Schema.Array(Bullet),
  lobs: Schema.Array(Lob),
  nextEntityId: Schema.Number,
  wallet: Wallet,
  elapsedMs: MillisNumber,
  frameEvents: Schema.Array(GameEvent),
  traps: Schema.Array(Trap),
  pickups: Schema.Array(Pickup),
  boosts: Boosts,
  loot: Loot,
  trapStock: TrapCounts,
  selectedTrap: TrapKind,
  level: LevelState,
  ovens: Schema.Array(Oven),
  fridge: Fridge,
  laserSight: LaserSight,
  rngState: Schema.Number,
  intent: Intent,
  flowField: FlowField,
  wideFlowField: FlowField,
  shop: ShopState,
  shopCategory: ShopCategory,
  purchase: Purchase,
  hitStop: HitStop,
  lessons: Lessons,
  practice: Practice,
  debutCard: DebutCard,
  stats: RunStats,
  party: Party,
})
export type World = typeof World.Type

export const initialPlayer: Player = {
  x: PARLOUR.width / 2,
  y: PARLOUR.height / 2,
  hp: PLAYER_MAX_HP,
  facing: { x: 1, y: 0 },
  fireCooldownMs: 0,
  knockback: { x: 0, y: 0 },
  invulnerability: Invulnerability.Vulnerable(),
  recoilRemainingMs: 0,
  arsenal: Arsenal.OneGun({
    first: { kind: 'Pistol', rounds: 0, loaded: PISTOL_MAGAZINE, tier: 0 },
  }),
  reload: Reload.Ready(),
  triggerRestMs: 0,
  charge: Charge.Idle(),
  knifeCooldownMs: 0,
  melee: Melee.Knife(),
  wield: 'Gun',
}

export const emptyWallet: Wallet = { balance: 0, earned: 0, shown: 0 }

export const FIRST_SHOP_CATEGORY: ShopCategory = 'Guns'

export const idleIntent: Intent = {
  move: { x: 0, y: 0 },
  maybeAim: Option.none(),
  trigger: 'Released',
  interact: 'Released',
}

export const emptyTrapStock: TrapCounts = { Barricade: 0, Turret: 0 }

export const noPractice: Practice = { movedPx: 0, aimedShots: 0 }

export const noKills: KillCounts = {
  Shambler: 0,
  Runner: 0,
  Tank: 0,
  Exploder: 0,
  Thrower: 0,
  Crawler: 0,
  Boss: 0,
}

export const freshStats: RunStats = {
  kills: noKills,
  wavesCleared: 0,
  shotsFired: 0,
  shotsHit: 0,
  heartsLost: 0,
  trapsPlaced: 0,
  purchases: 0,
  powerUpsGrabbed: 0,
  maybeLastHurtBy: Option.none(),
  activeFrames: 0,
  activeFrameMs: 0,
  runMs: 0,
}

export const calmPacing: Pacing = {
  holds: [],
  beat: Beat.Flowing(),
  warnedPacks: [],
  packDoors: [],
  alarm: Alarm.Quiet(),
  quietMs: 0,
}

export const idleBoosts: Boosts = {
  RapidFire: BoostTimer.Off(),
  Damage: BoostTimer.Off(),
  Speed: BoostTimer.Off(),
  Pierce: BoostTimer.Off(),
}

const LOOT_SEED_SALT = 0x5eed10e7
const FRIDGE_SEED_SALT = 0x0f71d6e5

export const freshLoot = (seed: number): Loot => ({
  rngState: (seed ^ LOOT_SEED_SALT) >>> 0,
  dryMs: 0,
  prize: Prize.Settled(),
  fridgeRngState: (seed ^ FRIDGE_SEED_SALT) >>> 0,
})

export const shutFridge: Fridge = {
  door: FridgeDoor.Shut(),
  pulls: 0,
  luck: 0,
}

export const initialHitStop: HitStop = HitStop.Running({ cooldownMs: 0 })

export const stillShake: Shake = { trauma: 0, offset: { x: 0, y: 0 } }
