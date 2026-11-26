import { Function, Option, Schema } from 'effect'

import { UiSchema, UiStruct } from '@effect/ui'

import { PISTOL_MAGAZINE, PLAYER_MAX_HP } from '#shared/constants.ts'
import { Difficulty } from '#shared/playerData.ts'
import { nextRandom } from '#shared/prng.ts'
import { Dare, DareKind, DareThing, Finale } from '#world/dare/dareSchema.ts'
import { START_LEVEL, startingLevelFor } from '#world/level/arena.ts'
import { arrangementAt } from '#world/level/plan.ts'
import { Modifiers } from '#world/run/modifiers.ts'

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
  KeyRing,
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
  StationId,
  type StationState,
  Stations,
  Stove,
  TrapCrates,
  TrapKind,
  Vector,
  WeaponKind,
  Zombie,
  ZombieKind,
} from './entitySchema.ts'
import {
  Heading,
  MillisNumber,
  PositionNumber,
  UnitNumber,
} from './wireNumber.ts'

export { Appearance, Difficulty, RotationSetting } from '#shared/playerData.ts'
export * from './entitySchema.ts'

export const Armament = Schema.Literals([
  'Pistol',
  'Shotgun',
  'Smg',
  'Peashooter',
  'Cooker',
  'Pan',
  'Freeze',
  'Knife',
  'Fire',
  'Rifle',
  'Blunderbuss',
])
export type Armament = typeof Armament.Type

export const KillSource = Schema.Literals([
  ...Armament.literals,
  'Blast',
  'Other',
])
export type KillSource = typeof KillSource.Type

export const CasePrize = Schema.Literals([
  'Shotgun',
  'Smg',
  'Rifle',
  'Blunderbuss',
  'LaserSight',
])
export type CasePrize = typeof CasePrize.Type

export const GameEvent = UiSchema.TaggedEnum({
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
    kind: ZombieKind,
    maybeKiller: Schema.Option(Schema.Finite),
    source: KillSource,
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
  WaveCleared: { x: PositionNumber, y: PositionNumber, keys: Schema.Finite },
  RushedIn: { x: PositionNumber, y: PositionNumber, points: Schema.Finite },
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
  PackWiped: { x: PositionNumber, y: PositionNumber },
  OvenBelched: { x: PositionNumber, y: PositionNumber },
  Purchased: { x: PositionNumber, y: PositionNumber },
  PurchaseRefused: { x: PositionNumber, y: PositionNumber },
  ExitOpened: { x: PositionNumber, y: PositionNumber },
  ChandelierFell: { x: PositionNumber, y: PositionNumber },
  ShelfSwung: { x: PositionNumber, y: PositionNumber },
  FridgeOpened: { x: PositionNumber, y: PositionNumber, prize: FridgePrize },
  FridgeSlammed: { x: PositionNumber, y: PositionNumber },
  PrizeTaken: { x: PositionNumber, y: PositionNumber },
  PrizeLeft: { x: PositionNumber, y: PositionNumber },
  DudBurped: { x: PositionNumber, y: PositionNumber, refund: Schema.Finite },
  PantryTaken: {
    x: PositionNumber,
    y: PositionNumber,
    goodie: PantryGoodie,
  },
  KeysFound: { x: PositionNumber, y: PositionNumber, count: Schema.Finite },
  CrateTaken: { x: PositionNumber, y: PositionNumber, trap: TrapKind },
  TrapMended: { x: PositionNumber, y: PositionNumber, kind: TrapKind },
  StationWorked: {
    x: PositionNumber,
    y: PositionNumber,
    station: StationId,
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
  MedicCalled: { x: PositionNumber, y: PositionNumber },
  DareFound: { x: PositionNumber, y: PositionNumber, kind: DareKind },
  DareListDone: { x: PositionNumber, y: PositionNumber },
  BigKeyBurst: { x: PositionNumber, y: PositionNumber },
  FrontDoorOpened: { x: PositionNumber, y: PositionNumber },
  SteppedOut: { x: PositionNumber, y: PositionNumber, slot: Schema.Finite },
  TeammateSaved: {
    x: PositionNumber,
    y: PositionNumber,
    clutch: Schema.Boolean,
  },
  GunLeveled: {
    x: PositionNumber,
    y: PositionNumber,
    slot: Schema.Finite,
    weapon: WeaponKind,
    tier: Schema.Finite,
  },
  CaseOpened: {
    x: PositionNumber,
    y: PositionNumber,
    prize: CasePrize,
    opener: Schema.Finite,
  },
})
export type GameEvent = typeof GameEvent.Type
export type GunLeveled = typeof GameEvent.cases.GunLeveled.Type

export const HitStop = UiSchema.TaggedEnum({
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
  'Opened',
  'Rushed',
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

export const Streak = UiSchema.TaggedEnum({
  Cold: {},
  Hot: { count: Schema.Finite, remainingMs: MillisNumber },
})
export type Streak = typeof Streak.Type

export const GunSlot = Schema.Literals(['First', 'Second'])
export type GunSlot = typeof GunSlot.Type

export const NightmareLock = Schema.Literals([
  'Locked',
  'JustUnlocked',
  'Unlocked',
])
export type NightmareLock = typeof NightmareLock.Type

export const DifficultySetting = Schema.Struct({
  chosen: Difficulty,
  nightmare: NightmareLock,
})
export type DifficultySetting = typeof DifficultySetting.Type

export const BestRun = Schema.Struct({
  wave: Schema.Finite,
  things: Schema.Array(DareKind),
})
export type BestRun = typeof BestRun.Type

export const DifficultyBests = Schema.Struct({
  maybeFastestWinMs: Schema.Option(Schema.Finite),
  maybeBestEndlessWave: Schema.Option(Schema.Finite),
  maybeFurthestWave: Schema.Option(Schema.Finite),
  maybeMostKills: Schema.Option(Schema.Finite),
  maybeBestRun: Schema.Option(BestRun),
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

const ArmamentCounts = Schema.Struct({
  Pistol: Schema.Finite,
  Shotgun: Schema.Finite,
  Smg: Schema.Finite,
  Peashooter: Schema.Finite,
  Cooker: Schema.Finite,
  Pan: Schema.Finite,
  Freeze: Schema.Finite,
  Knife: Schema.Finite,
  Fire: Schema.Finite,
  Rifle: Schema.Finite,
  Blunderbuss: Schema.Finite,
})
type ArmamentCounts = typeof ArmamentCounts.Type

export const Feat = UiSchema.TaggedEnum({
  Kills: { count: Schema.Finite },
  KillsWith: { armament: Armament, count: Schema.Finite },
  KillsOf: { kind: ZombieKind, count: Schema.Finite },
  NoHitWave: { count: Schema.Finite },
  Streak: { count: Schema.Finite },
  OwnBlast: { count: Schema.Finite },
  OpenedRoom: { count: Schema.Finite },
  LitFire: {},
  KeyFromMarked: { count: Schema.Finite },
  KitchenKills: { count: Schema.Finite },
  KitchenStandKills: { count: Schema.Finite },
})
export type Feat = typeof Feat.Type

export const FeatTally = Schema.Struct({
  kills: Schema.Finite,
  killsWith: ArmamentCounts,
  killsOf: KillCounts,
  cleanWaves: Schema.Finite,
  streak: Schema.Finite,
  bestStreak: Schema.Finite,
  blastKills: Schema.Finite,
  roomsOpened: Schema.Finite,
  firesLit: Schema.Finite,
  markedKeys: Schema.Finite,
  kitchenKills: Schema.Finite,
  kitchenStandKills: Schema.Finite,
  hurtThisWave: Schema.Boolean,
})
export type FeatTally = typeof FeatTally.Type

export const CaseState = UiSchema.TaggedEnum({
  Locked: {},
  Opened: { by: Schema.Finite },
  Emptied: { by: Schema.Finite },
})
export type CaseState = typeof CaseState.Type

export const DisplayCase = Schema.Struct({
  id: Schema.Finite,
  spot: Schema.Finite,
  prize: CasePrize,
  feat: Feat,
  state: CaseState,
})
export type DisplayCase = typeof DisplayCase.Type

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

export const BreakClock = UiSchema.TaggedEnum({
  Counting: {},
  Waiting: { elapsedMs: MillisNumber },
})
export type BreakClock = typeof BreakClock.Type

const preparationFields = {
  wave: Schema.Finite,
  remainingMs: MillisNumber,
  durationMs: MillisNumber,
  spawns: Schema.Array(PlannedSpawn),
  clock: BreakClock,
}

const waveFields = {
  wave: Schema.Finite,
  elapsedMs: MillisNumber,
  spawns: Schema.Array(PlannedSpawn),
}

export const Round = UiSchema.TaggedEnum({
  Preparation: preparationFields,
  Wave: waveFields,
})
export type Round = typeof Round.Type

export const RunMode = UiSchema.TaggedEnum({
  Campaign: {},
  Endless: {},
})
export type RunMode = typeof RunMode.Type

export const IntroCut = Schema.Literals(['Full', 'Short'])
export type IntroCut = typeof IntroCut.Type

export const Phase = UiSchema.TaggedEnum({
  Ready: {},
  Arriving: { elapsedMs: MillisNumber, cut: IntroCut },
  Preparation: preparationFields,
  Wave: waveFields,
  Paused: { round: Round },
  Escaped: { wave: Schema.Finite },
  LeftEarly: { wave: Schema.Finite },
  GameOver: { wave: Schema.Finite },
})
export type Phase = typeof Phase.Type

export const isRoundActive = (phase: Phase): boolean =>
  Phase.isAnyOf(['Preparation', 'Wave'])(phase)

export const evolveRoundSpawns: {
  (
    change: (
      spawns: ReadonlyArray<PlannedSpawn>,
    ) => ReadonlyArray<PlannedSpawn>,
  ): (phase: Phase) => Phase
  (
    phase: Phase,
    change: (
      spawns: ReadonlyArray<PlannedSpawn>,
    ) => ReadonlyArray<PlannedSpawn>,
  ): Phase
} = Function.dual(
  2,
  (
    phase: Phase,
    change: (
      spawns: ReadonlyArray<PlannedSpawn>,
    ) => ReadonlyArray<PlannedSpawn>,
  ): Phase =>
    Phase.matchOrElse(
      phase,
      {
        Preparation: round => UiStruct.evolve(round, { spawns: change }),
        Wave: round => UiStruct.evolve(round, { spawns: change }),
      },
      () => phase,
    ),
)

export const roundWaveOf = (phase: Phase): number =>
  Phase.isAnyOf(['Preparation', 'Wave'])(phase) ? phase.wave : 0

export const Boss = UiSchema.TaggedEnum({
  Absent: {},
  Waiting: {
    door: DoorId,
    waitBelow: Schema.Finite,
    hp: Schema.Finite,
    guestHpScale: Schema.Finite,
  },
  Arriving: {
    door: DoorId,
    hp: Schema.Finite,
    guestHpScale: Schema.Finite,
    remainingMs: MillisNumber,
    durationMs: MillisNumber,
  },
  Fighting: {
    id: Schema.Finite,
    guestHpScale: Schema.Finite,
    move: BossMove,
    standingMs: MillisNumber,
    mood: BossMood,
    nextFar: FarAttack,
    belchMs: MillisNumber,
    globs: Schema.Array(Glob),
  },
})
export type Boss = typeof Boss.Type

export const FrenzyPack = Schema.Struct({
  pack: Schema.Finite,
  left: Schema.Finite,
})
export type FrenzyPack = typeof FrenzyPack.Type

export const Hold = Schema.Struct({
  atMs: MillisNumber,
  releaseBelow: Schema.Finite,
  relaxMs: MillisNumber,
})
export type Hold = typeof Hold.Type

export const Beat = UiSchema.TaggedEnum({
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

export const Alarm = UiSchema.TaggedEnum({
  Quiet: {},
  Ringing: { remainingMs: MillisNumber },
})
export type Alarm = typeof Alarm.Type

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
  loneMs: MillisNumber,
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

const LaserSight = Schema.Literals(['None', 'Fitted'])
type LaserSight = typeof LaserSight.Type

export const Purchasable = UiSchema.TaggedEnum({
  Exit: { exit: ExitId },
  Fridge: {},
  Prize: {},
  Stove: {},
  Valve: {},
  Case: { id: Schema.Finite },
  BackDoor: {},
})
export type Purchasable = typeof Purchasable.Type

export const Purchase = UiSchema.TaggedEnum({
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

export const isHolding = Purchase.isAnyOf(['Holding'])

export const Oven = UiSchema.TaggedEnum({
  Ready: {},
  Belching: { remainingMs: MillisNumber, burnedTicks: Schema.Finite },
  Cooling: { remainingMs: MillisNumber },
})
export type Oven = typeof Oven.Type

export const TurretGun = UiSchema.TaggedEnum({
  Armed: {},
  CoolingDown: { remainingMs: MillisNumber },
})
export type TurretGun = typeof TurretGun.Type

export const Trap = UiSchema.TaggedEnum({
  Barricade: {
    id: Schema.Finite,
    door: DoorId,
    hp: Schema.Finite,
    maxHp: Schema.Finite,
    hitRemainingMs: MillisNumber,
  },
  Turret: {
    id: Schema.Finite,
    column: Schema.Finite,
    row: Schema.Finite,
    hp: Schema.Finite,
    maxHp: Schema.Finite,
    hitRemainingMs: MillisNumber,
    facing: Heading,
    gun: TurretGun,
  },
})
export type Trap = typeof Trap.Type
export type Turret = typeof Trap.cases.Turret.Type

export const TrapCounts = Schema.Struct({
  Barricade: Schema.Finite,
  Turret: Schema.Finite,
})
export type TrapCounts = typeof TrapCounts.Type

export const TrapHint = UiSchema.TaggedEnum({
  Unseen: {},
  Showing: {},
  Seen: {},
})
export type TrapHint = typeof TrapHint.Type

export const TrapNotice = UiSchema.TaggedEnum({
  Quiet: {},
  Refused: { reason: Schema.String, remainingMs: MillisNumber },
})
export type TrapNotice = typeof TrapNotice.Type

export const Lesson = UiSchema.TaggedEnum({
  Pending: {},
  Learned: { atMs: MillisNumber },
})
export type Lesson = typeof Lesson.Type

export const Lessons = Schema.Struct({
  move: Lesson,
  fire: Lesson,
  startWave: Lesson,
  swap: Lesson,
  pickup: Lesson,
  timedBreaks: Lesson,
  openBreak: Lesson,
  dareTour: Lesson,
  dareKey: Lesson,
  rattles: Lesson,
  displayCase: Lesson,
  dareCard: Lesson,
  gunLevel: Lesson,
})
export type Lessons = typeof Lessons.Type

export const Practice = Schema.Struct({
  movedPx: Schema.Finite,
  aimedShots: Schema.Finite,
})
export type Practice = typeof Practice.Type

export const DebutCard = UiSchema.TaggedEnum({
  Hidden: {},
  Showing: { kind: ZombieKind, ageMs: MillisNumber },
})
export type DebutCard = typeof DebutCard.Type

export const RunStats = Schema.Struct({
  kills: KillCounts,
  wavesCleared: Schema.Finite,
  readyPoints: Schema.Finite,
  shotsFired: Schema.Finite,
  shotsHit: Schema.Finite,
  heartsLost: Schema.Finite,
  trapsPlaced: Schema.Finite,
  powerUpsGrabbed: Schema.Finite,
  maybeLastHurtBy: Schema.Option(ZombieKind),
  activeFrames: Schema.Finite,
  activeFrameMs: MillisNumber,
  runMs: MillisNumber,
})
export type RunStats = typeof RunStats.Type

export const PlayerSlot = Schema.Finite
export type PlayerSlot = typeof PlayerSlot.Type

export const SOLO_SLOT: PlayerSlot = 0

export const Life = UiSchema.TaggedEnum({
  Standing: {},
  Downed: {
    bleedMs: MillisNumber,
    reviveMs: MillisNumber,
    callMs: MillisNumber,
  },
  BledOut: {},
  Out: {},
})
export type Life = typeof Life.Type
export type DownedLife = typeof Life.cases.Downed.Type

export const Presence = Schema.Literals(['Here', 'Away'])
export type Presence = typeof Presence.Type

const Readiness = Schema.Literals(['Waiting', 'Ready'])
type Readiness = typeof Readiness.Type

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
  keysFound: Schema.Finite,
  graceMs: MillisNumber,
  touchedMs: MillisNumber,
})
export type Seat = typeof Seat.Type

export const SeatState = Schema.Struct({
  seat: Seat,
  player: Player,
  intent: Intent,
  boosts: Boosts,
  trapStock: TrapCounts,
  selectedTrap: TrapKind,
  laserSight: LaserSight,
  purchase: Purchase,
  cooking: Cooking,
  feats: FeatTally,
})
export type SeatState = typeof SeatState.Type

export const Party = UiSchema.TaggedEnum({
  Solo: {},
  Crew: {},
})
export type Party = typeof Party.Type

export const World = Schema.Struct({
  phase: Phase,
  pacing: Pacing,
  boss: Boss,
  frenzyPacks: Schema.Array(FrenzyPack),
  intensity: UnitNumber,
  mode: RunMode,
  difficulty: DifficultySetting,
  modifiers: Modifiers,
  easyBreakSeconds: Schema.Finite,
  dareMark: Schema.Finite,
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
  crates: TrapCrates,
  keys: KeyRing,
  stove: Stove,
  dare: Dare,
  dareThings: Schema.Array(DareThing),
  gasValve: GasValve,
  stations: Stations,
  cases: Schema.Array(DisplayCase),
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
  x: START_LEVEL.start.x,
  y: START_LEVEL.start.y,
  hp: PLAYER_MAX_HP,
  facing: { x: 1, y: 0 },
  fireCooldownMs: 0,
  knockback: { x: 0, y: 0 },
  invulnerability: Invulnerability.Vulnerable(),
  recoilRemainingMs: 0,
  arsenal: Arsenal.OneGun({
    first: { kind: 'Pistol', loaded: PISTOL_MAGAZINE, tier: 0, kills: 0 },
  }),
  reload: Reload.Ready(),
  triggerRestMs: 0,
  charge: Charge.Idle(),
  knifeCooldownMs: 0,
  melee: Melee.Knife(),
  wield: 'Gun',
  calling: 'You',
}

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

const noArmamentKills: ArmamentCounts = {
  Pistol: 0,
  Shotgun: 0,
  Smg: 0,
  Peashooter: 0,
  Cooker: 0,
  Pan: 0,
  Freeze: 0,
  Knife: 0,
  Fire: 0,
  Rifle: 0,
  Blunderbuss: 0,
}

export const freshTally: FeatTally = {
  kills: 0,
  killsWith: noArmamentKills,
  killsOf: noKills,
  cleanWaves: 0,
  streak: 0,
  bestStreak: 0,
  blastKills: 0,
  roomsOpened: 0,
  firesLit: 0,
  markedKeys: 0,
  kitchenKills: 0,
  kitchenStandKills: 0,
  hurtThisWave: false,
}

export const freshStats: RunStats = {
  kills: noKills,
  wavesCleared: 0,
  readyPoints: 0,
  shotsFired: 0,
  shotsHit: 0,
  heartsLost: 0,
  trapsPlaced: 0,
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
  loneMs: 0,
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
const HOUSE_SEED_SALT = 0x40a5e5ed

export const freshLevel = (seed: number): LevelState =>
  startingLevelFor(
    arrangementAt(nextRandom((seed ^ HOUSE_SEED_SALT) >>> 0).value),
  )

export const freshStove = (seed: number): Stove => ({
  rngState: (seed ^ STOVE_SEED_SALT) >>> 0,
  perk: 'Spicy',
  wave: 0,
})

const DARE_SEED_SALT = 0x0da4e5b7

export const freshDare = (seed: number): Dare => ({
  rngState: (seed ^ DARE_SEED_SALT) >>> 0,
  list: [],
  finale: Finale.Hunting(),
})

export const shutValve: GasValve = GasValve.Shut()

const idleStation: StationState = {
  workedMs: 0,
  cooldownMs: 0,
  timesWorked: 0,
}

export const idleStations: Stations = {
  Cleat: idleStation,
  Gramophone: idleStation,
  NorthStack: idleStation,
  SouthStack: idleStation,
  Shelf: idleStation,
  Barrels: idleStation,
  Bulb: idleStation,
  SoupPot: idleStation,
}

export const shutFridge: Fridge = {
  door: FridgeDoor.Shut(),
  pulls: 0,
  luck: 0,
}

export const barePantry: Pantry = Pantry.Bare({ round: 0 })

const CRATE_SEED_SALT = 0x0c7a7e5b

const KEY_SEED_SALT = 0x6b3e75c1

export const freshKeys = (seed: number): KeyRing => ({
  held: 0,
  found: 0,
  spent: 0,
  rngState: (seed ^ KEY_SEED_SALT) >>> 0,
})

export const freshCrates = (seed: number): TrapCrates => ({
  rngState: (seed ^ CRATE_SEED_SALT) >>> 0,
  wave: 0,
  crates: [],
})

export const initialHitStop: HitStop = HitStop.Running({ cooldownMs: 0 })

export const stillShake: Shake = { trauma: 0, offset: { x: 0, y: 0 } }
