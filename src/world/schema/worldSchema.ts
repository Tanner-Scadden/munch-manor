// The World's Schemas and starting values, and the plain Schemas beside
// them, apart from the client Model (src/app/model.ts), so the step a co-op
// room runs never imports the UI, the sync engine, or the tip jar.

import { Effect, Option, Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

import { PISTOL_MAGAZINE, PLAYER_MAX_HP } from '../../shared/constants'
import { Difficulty } from '../../shared/playerData'
import { PARLOUR } from '../level/arena'
import { Modifiers } from '../run/modifiers'
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
  Cooking,
  DoorId,
  ExitId,
  FarAttack,
  Formation,
  Fridge,
  FridgeDoor,
  FridgePrize,
  GasValve,
  Glob,
  Intent,
  Invulnerability,
  LevelState,
  Lob,
  Loot,
  Melee,
  Pantry,
  PantryGoodie,
  Pickup,
  PickupKind,
  Player,
  Prize,
  Reload,
  Stove,
  TrapKind,
  Vector,
  WeaponKind,
  Zombie,
  ZombieKind,
} from './entitySchema'
import { Heading, MillisNumber, PositionNumber, UnitNumber } from './wireNumber'

export {
  Appearance,
  Difficulty,
  RotationSetting,
} from '../../shared/playerData'
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
    maybeShooter: Schema.Option(Schema.Finite),
  },
  ZombieHit: {
    x: PositionNumber,
    y: PositionNumber,
    direction: Heading,
    damage: Schema.Finite,
    kind: ZombieKind,
    maybeShooter: Schema.Option(Schema.Finite),
  },
  ZombieKilled: {
    x: PositionNumber,
    y: PositionNumber,
    direction: Heading,
    bounty: Schema.Finite,
    kind: ZombieKind,
  },
  Exploded: { x: PositionNumber, y: PositionNumber, radius: Schema.Finite },
  Footfall: {
    x: PositionNumber,
    y: PositionNumber,
    kind: ZombieKind,
    nearness: Schema.Finite,
  },
  PlayerHurt: {
    x: PositionNumber,
    y: PositionNumber,
    direction: Heading,
    source: ZombieKind,
  },
  BulletStruck: { x: PositionNumber, y: PositionNumber, direction: Heading },
  DryFired: { x: PositionNumber, y: PositionNumber },
  ReloadStarted: {
    x: PositionNumber,
    y: PositionNumber,
    direction: Heading,
    weapon: WeaponKind,
  },
  Reloaded: { x: PositionNumber, y: PositionNumber, weapon: WeaponKind },
  WaveCleared: { x: PositionNumber, y: PositionNumber, bonus: Schema.Finite },
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
  Burped: { x: PositionNumber, y: PositionNumber, radius: Schema.Finite },
  PartShed: {
    x: PositionNumber,
    y: PositionNumber,
    direction: Heading,
    kind: ZombieKind,
    stage: Schema.Finite,
  },
  BossRoared: { x: PositionNumber, y: PositionNumber, door: DoorId },
  BossWoundUp: { x: PositionNumber, y: PositionNumber, attack: BossAttack },
  BossStomped: { x: PositionNumber, y: PositionNumber, radius: Schema.Finite },
  BossBelched: { x: PositionNumber, y: PositionNumber },
  BossRushed: { x: PositionNumber, y: PositionNumber, direction: Heading },
  BossRammed: { x: PositionNumber, y: PositionNumber, direction: Heading },
  BossBonked: { x: PositionNumber, y: PositionNumber, direction: Heading },
  BossSpat: { x: PositionNumber, y: PositionNumber },
  GlobLanded: { x: PositionNumber, y: PositionNumber, radius: Schema.Finite },
  BossEnraged: { x: PositionNumber, y: PositionNumber },
  ZombieGrabbed: { x: PositionNumber, y: PositionNumber },
  ShieldRaised: { x: PositionNumber, y: PositionNumber },
  ZombieThrown: { x: PositionNumber, y: PositionNumber },
  ZombieLanded: { x: PositionNumber, y: PositionNumber, radius: Schema.Finite },
  CrawlerStirred: { x: PositionNumber, y: PositionNumber },
  CrawlerSurfaced: { x: PositionNumber, y: PositionNumber },
  AnklesGrabbed: { x: PositionNumber, y: PositionNumber },
  PackFrenzied: { x: PositionNumber, y: PositionNumber, door: DoorId },
  PackWiped: { x: PositionNumber, y: PositionNumber, bonus: Schema.Finite },
  OvenBelched: { x: PositionNumber, y: PositionNumber },
  Purchased: { x: PositionNumber, y: PositionNumber },
  PurchaseRefused: { x: PositionNumber, y: PositionNumber },
  ExitOpened: { x: PositionNumber, y: PositionNumber },
  FridgeOpened: { x: PositionNumber, y: PositionNumber, prize: FridgePrize },
  FridgeSlammed: { x: PositionNumber, y: PositionNumber },
  PrizeTaken: { x: PositionNumber, y: PositionNumber },
  PrizeLeft: { x: PositionNumber, y: PositionNumber },
  DudBurped: { x: PositionNumber, y: PositionNumber, refund: Schema.Finite },
  PantryTaken: {
    x: PositionNumber,
    y: PositionNumber,
    goodie: PantryGoodie,
    cash: Schema.Finite,
  },
  LidLaunched: { x: PositionNumber, y: PositionNumber, direction: Heading },
  LidBlasted: { x: PositionNumber, y: PositionNumber, radius: Schema.Finite },
  CookerPopped: { x: PositionNumber, y: PositionNumber, direction: Heading },
  PanSwung: { x: PositionNumber, y: PositionNumber, direction: Heading },
  PanClanged: { x: PositionNumber, y: PositionNumber, direction: Heading },
  PanSmashed: { x: PositionNumber, y: PositionNumber, radius: Schema.Finite },
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
  // NOTE: a downed player shouts MEDIC! (src/world/party/medic.ts), where they lie.
  MedicCalled: { x: PositionNumber, y: PositionNumber },
  // NOTE: a teammate got a downed player up, at the reviver; a clutch save
  // came with under MEDIC_RULES.clutchBleedMs of bleed left.
  TeammateSaved: {
    x: PositionNumber,
    y: PositionNumber,
    clutch: Schema.Boolean,
  },
})
export type GameEvent = typeof GameEvent.Type

export const HitStop = defineTaggedUnion({
  Running: { cooldownMs: MillisNumber },
  Frozen: { remainingMs: MillisNumber },
  Slowed: { remainingMs: MillisNumber, carryMs: MillisNumber },
})
export type HitStop = typeof HitStop.Type

export const Shake = Schema.Struct({ trauma: Schema.Finite, offset: Vector })
export type Shake = typeof Shake.Type

export const PopupKind = Schema.Literals([
  'Damage',
  'Kill',
  'Payday',
  'Horde',
  'Wipe',
  'Kaboom',
  'Saved',
  'Clutch',
])
export type PopupKind = typeof PopupKind.Type

export const Popup = Schema.Struct({
  kind: PopupKind,
  value: Schema.Finite,
  x: Schema.Finite,
  y: Schema.Finite,
  velocityX: Schema.Finite,
  ageMs: MillisNumber,
})
export type Popup = typeof Popup.Type

export const Streak = defineTaggedUnion({
  Cold: {},
  Hot: { count: Schema.Finite, remainingMs: MillisNumber },
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
// on-device save (src/platform/save.ts). They are plain data on purpose: they move
// into the SQLite player scope from PLATFORM.md beside the look.
export const DifficultySetting = Schema.Struct({
  chosen: Difficulty,
  nightmare: NightmareLock,
})
export type DifficultySetting = typeof DifficultySetting.Type

// NOTE: the furthest campaign wave and the most kills in one run are the
// run records, saved apart from the bests (SavedRunRecords).
export const DifficultyBests = Schema.Struct({
  maybeFastestWinMs: Schema.Option(Schema.Finite),
  maybeBestEndlessWave: Schema.Option(Schema.Finite),
  maybeFurthestWave: Schema.Option(Schema.Finite),
  maybeMostKills: Schema.Option(Schema.Finite),
})
export type DifficultyBests = typeof DifficultyBests.Type

export const KillCounts = Schema.Struct({
  Shambler: Schema.Finite,
  Runner: Schema.Finite,
  Tank: Schema.Finite,
  Exploder: Schema.Finite,
  Thrower: Schema.Finite,
  Crawler: Schema.Finite,
  Boss: Schema.Finite,
})
export type KillCounts = typeof KillCounts.Type

export const PlannedSpawn = Schema.Struct({
  atMs: MillisNumber,
  kind: ZombieKind,
  door: DoorId,
  offset: PositionNumber,
  speedScale: UnitNumber,
  hpScale: UnitNumber,
  pack: Schema.Finite,
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
  wave: Schema.Finite,
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
  wave: Schema.Finite,
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
  GameOver: { wave: Schema.Finite },
})
export type Phase = typeof Phase.Type

// NOTE: A boss wave holds its boss outside until only waitBelow planned
// spawns are left, then rattles its door for the entrance before it walks in.
// While it arrives and for its first seconds in the room, the wave clock
// waits, so the rest of the wave comes after the boss has had the floor.
export const Boss = defineTaggedUnion({
  Absent: {},
  Waiting: { door: DoorId, waitBelow: Schema.Finite, hp: Schema.Finite },
  Arriving: {
    door: DoorId,
    hp: Schema.Finite,
    remainingMs: MillisNumber,
    durationMs: MillisNumber,
  },
  Fighting: {
    id: Schema.Finite,
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
  pack: Schema.Finite,
  left: Schema.Finite,
  bonus: Schema.Finite,
})
export type FrenzyPack = typeof FrenzyPack.Type

export const Hold = Schema.Struct({
  atMs: MillisNumber,
  releaseBelow: Schema.Finite,
  relaxMs: MillisNumber,
})
export type Hold = typeof Hold.Type

export const Beat = defineTaggedUnion({
  Flowing: {},
  Fading: {
    releaseBelow: Schema.Finite,
    relaxMs: MillisNumber,
    waitedMs: MillisNumber,
  },
  Resting: {
    remainingMs: MillisNumber,
    extendedMs: MillisNumber,
    trickled: Schema.Finite,
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
  pack: Schema.Finite,
  planned: DoorId,
  door: DoorId,
})
export type PackDoor = typeof PackDoor.Type

export const Pacing = Schema.Struct({
  holds: Schema.Array(Hold),
  beat: Beat,
  warnedPacks: Schema.Array(Schema.Finite),
  packDoors: Schema.Array(PackDoor),
  alarm: Alarm,
  quietMs: MillisNumber,
})
export type Pacing = typeof Pacing.Type

export const Toll = Schema.Struct({
  index: Schema.Finite,
  cost: Schema.Finite,
})
export type Toll = typeof Toll.Type

export const Blast = Schema.Struct({
  x: Schema.Finite,
  y: Schema.Finite,
  radius: Schema.Finite,
  ageMs: MillisNumber,
})
export type Blast = typeof Blast.Type

export const FixedShopItemId = Schema.Literals([
  'Shotgun',
  'ShotgunUpgrade',
  'Smg',
  'SmgUpgrade',
  'PistolUpgrade',
  'LaserSight',
  'Heart',
  'Barricade',
  'Turret',
  'CookerUpgrade',
  'PanUpgrade',
  'Pistol',
])
export type FixedShopItemId = typeof FixedShopItemId.Type

// NOTE: a placed trap is repaired on its own, so its repair row is named by
// the trap's id.
export const RepairItemId = Schema.TemplateLiteral(['Repair-', Schema.Finite])
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
// interact key beside it, the way a wall buy works (src/world/shop/purchase.ts): a
// boarded exit, the Mystery Leftovers fridge (src/world/fridge/leftovers.ts) and its
// prize, and in the kitchen the stove bench (src/world/kitchen/stove.ts) and the gas valve
// (src/world/kitchen/gasValve.ts).
export const Purchasable = defineTaggedUnion({
  Exit: { exit: ExitId },
  Fridge: {},
  Prize: {},
  Stove: {},
  Valve: {},
})
export type Purchasable = typeof Purchasable.Type

// NOTE: one player's hold at a purchasable. Holding fills toward the buy,
// from the key held or the player standing still (src/world/shop/purchase.ts);
// Refused is a press the wallet could not cover, shaking for a moment;
// Done waits for the key to be let go after a buy, so one hold buys once;
// Spent waits for a player who bought and stands still to move before
// standing buys again, so one buy never chains into the next.
export const Purchase = defineTaggedUnion({
  Idle: {},
  Holding: { target: Purchasable, heldMs: MillisNumber },
  Refused: {
    target: Purchasable,
    shortBy: Schema.Finite,
    sinceMs: MillisNumber,
  },
  Done: {},
  Spent: {},
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
  Belching: { remainingMs: MillisNumber, burnedTicks: Schema.Finite },
  Cooling: { remainingMs: MillisNumber },
})
export type Oven = typeof Oven.Type

export const Wallet = Schema.Struct({
  balance: Schema.Finite,
  earned: Schema.Finite,
  shown: Schema.Finite,
})
export type Wallet = typeof Wallet.Type

export const TurretGun = defineTaggedUnion({
  Armed: {},
  CoolingDown: { remainingMs: MillisNumber },
})
export type TurretGun = typeof TurretGun.Type

export const Trap = defineTaggedUnion({
  Barricade: {
    id: Schema.Finite,
    door: DoorId,
    hp: Schema.Finite,
    hitRemainingMs: MillisNumber,
  },
  Turret: {
    id: Schema.Finite,
    column: Schema.Finite,
    row: Schema.Finite,
    hp: Schema.Finite,
    hitRemainingMs: MillisNumber,
    facing: Heading,
    gun: TurretGun,
  },
})
export type Trap = typeof Trap.Type
export type Turret = typeof Trap.Turret.Type

export const TrapCounts = Schema.Struct({
  Barricade: Schema.Finite,
  Turret: Schema.Finite,
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
  movedPx: Schema.Finite,
  aimedShots: Schema.Finite,
})
export type Practice = typeof Practice.Type

export const DebutCard = defineTaggedUnion({
  Hidden: {},
  Showing: { kind: ZombieKind, ageMs: MillisNumber },
})
export type DebutCard = typeof DebutCard.Type

export const RunStats = Schema.Struct({
  kills: KillCounts,
  wavesCleared: Schema.Finite,
  shotsFired: Schema.Finite,
  shotsHit: Schema.Finite,
  heartsLost: Schema.Finite,
  trapsPlaced: Schema.Finite,
  purchases: Schema.Finite,
  powerUpsGrabbed: Schema.Finite,
  maybeLastHurtBy: Schema.Option(ZombieKind),
  activeFrames: Schema.Finite,
  activeFrameMs: MillisNumber,
  runMs: MillisNumber,
})
export type RunStats = typeof RunStats.Type

// CO-OP

// NOTE: a player is keyed by their seat in the room. Single player is the
// one seat SOLO_SLOT.
export const PlayerSlot = Schema.Finite
export type PlayerSlot = typeof PlayerSlot.Type

export const SOLO_SLOT: PlayerSlot = 0

// NOTE: in co-op a player at zero hearts is Downed: they crawl, cannot
// shoot, and bleed out when bleedMs runs out, unless a teammate standing
// still beside them fills reviveMs first. A BledOut player is out of the
// fight until the next break (MULTIPLAYER.md, decided row 4). `callMs` is
// how long ago they last shouted MEDIC! (src/world/party/medic.ts): 0 is a shout the
// next tick sounds.
export const Life = defineTaggedUnion({
  Standing: {},
  Downed: {
    bleedMs: MillisNumber,
    reviveMs: MillisNumber,
    callMs: MillisNumber,
  },
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
// their run's own numbers for the end card's crew board (src/crewBoard.ts):
// the kills credited to them, the teammates they revived, the times they
// went down, and their shots fired and landed.
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
  trapIds: Schema.Array(Schema.Finite),
  kills: Schema.Finite,
  revives: Schema.Finite,
  downs: Schema.Finite,
  shotsFired: Schema.Finite,
  shotsHit: Schema.Finite,
  graceMs: MillisNumber,
  touchedMs: MillisNumber,
})
export type Seat = typeof Seat.Type

// NOTE: one player's place in the World: the seat's own record and every
// per-player field. The World holds them in `seats`, in slot order, so a
// per-player system reads and writes its player by slot, with no swapping.
export const SeatState = Schema.Struct({
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
  cooking: Cooking,
})
export type SeatState = typeof SeatState.Type

// NOTE: Solo is single player, exactly as it always played. A Crew plays by
// co-op's rules: a downed player, READY for the break, no world pause. Both
// hold their players in the World's `seats`, one for Solo at SOLO_SLOT.
export const Party = defineTaggedUnion({
  Solo: {},
  Crew: {},
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
  modifiers: Modifiers,
  zombies: Schema.Array(Zombie),
  bullets: Schema.Array(Bullet),
  lobs: Schema.Array(Lob),
  nextEntityId: Schema.Finite,
  elapsedMs: MillisNumber,
  frameEvents: Schema.Array(GameEvent),
  traps: Schema.Array(Trap),
  pickups: Schema.Array(Pickup),
  loot: Loot,
  level: LevelState,
  ovens: Schema.Array(Oven),
  fridge: Fridge,
  pantry: Pantry,
  stove: Stove,
  gasValve: GasValve,
  rngState: Schema.Finite,
  hitStop: HitStop,
  lessons: Lessons,
  practice: Practice,
  debutCard: DebutCard,
  stats: RunStats,
  party: Party,
  seats: Schema.NonEmptyArray(SeatState),
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
    first: { kind: 'Pistol', loaded: PISTOL_MAGAZINE, tier: 0 },
  }),
  reload: Reload.Ready(),
  triggerRestMs: 0,
  charge: Charge.Idle(),
  knifeCooldownMs: 0,
  melee: Melee.Knife(),
  wield: 'Gun',
  calling: 'You',
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

export const noCooking: Cooking = { cooks: 0, lastWave: 0 }

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

const STOVE_SEED_SALT = 0x5709e3c1

// NOTE: the stove's own generator, apart from the run's, so its rolls move
// no other; `wave` 0 is no break yet, so the first break rolls its perk.
export const freshStove = (seed: number): Stove => ({
  rngState: (seed ^ STOVE_SEED_SALT) >>> 0,
  perk: 'Spicy',
  wave: 0,
})

export const shutValve: GasValve = GasValve.Shut()

export const shutFridge: Fridge = {
  door: FridgeDoor.Shut(),
  pulls: 0,
  luck: 0,
  cheapRound: 0,
  cheapSlots: [],
}

export const barePantry: Pantry = Pantry.Bare({ round: 0 })

export const initialHitStop: HitStop = HitStop.Running({ cooldownMs: 0 })

export const stillShake: Shake = { trauma: 0, offset: { x: 0, y: 0 } }
