// The balance bot: a fair, simple player that drives the game's own init
// model and update. tools/balance/simulate.ts runs it for the campaign
// reports, and the wave snapshot pass replays single waves from a typical
// run state. Nothing here ships with the game. Install a DOM (happy-dom)
// before importing this module, as simulate.ts and vitest do.

import {
  Array as EffectArray,
  Record as EffectRecord,
  Option,
  Schema,
} from 'effect'
import { modifyFields } from 'foldkit/struct'
import { toParentMessage } from 'foldkit/test'

import { DialogBlock } from '@foldkit/ui'

import { assistAim } from '../../src/aimAssist'
import { isCounterOpen, maybeAmmoItemOf } from '../../src/ammoCounter'
import { ammoLevelOf, isOutOfGuns } from '../../src/ammoWarning'
import {
  boxCenter,
  distanceToBox,
  hasLineOfSight,
  levelOf,
} from '../../src/arena'
import { BOSS_RULES } from '../../src/boss'
import {
  cameraFocus,
  cameraFor,
  screenCameraOf,
  viewToWorld,
  worldToView,
  worldWindowOf,
} from '../../src/camera'
import { CHUCKER_RULES, maybeShieldFor } from '../../src/chucker'
import { ShopDialogBinding } from '../../src/bindings'
import { PLAYER_MAX_HP, PLAYER_RADIUS } from '../../src/constants'
import { CRAWLER_RULES } from '../../src/crawler'
import { doorCounts } from '../../src/endlessWaves'
import { EXIT_RULES, KITCHEN_EXIT, isExitOfferOpenFor } from '../../src/exits'
import { FRENZY_RULES } from '../../src/frenzy'
import {
  COOKER_RULES,
  FREEZE_RULES,
  cookerFullMs,
  isFridgeWeapon,
  isSmallKind,
} from '../../src/fridgeWeapons'
import { KNIFE_RULES } from '../../src/knife'
import { FRIDGE_RULES, fridgeBoxOf } from '../../src/leftovers'
import { update } from '../../src/main'
import { Message } from '../../src/message'
import { type Difficulty, ZombieKind, initialModel } from '../../src/model'
import { leadSeatOf } from '../../src/party'
import { maybeOfferInReach } from '../../src/purchase'
import {
  DEFAULT_PORTRAIT_SCREEN,
  LANDSCAPE_TOUCH_SCREEN,
  type Screen,
} from '../../src/screen'
import {
  STALL_BOX,
  isShopOpenFor,
  priceFor,
  repairItemId,
  verdictFor,
} from '../../src/shop'
import { asTutorialDone, asVeteran } from '../../src/veteran'
import { beginPreparation } from '../../src/waves'
import {
  canReload,
  freshGun,
  gunsOf,
  heldGun,
  heldLoaded,
  heldStats,
  isCarrying,
  isReloading,
  isWieldingMelee,
  maxRounds,
  maxTier,
  maybeOtherGun,
  maybePanOf,
} from '../../src/weapons'
import { withWorld } from '../../src/world'
import { BossMove } from '../../src/worldSchema'
import { ZOMBIE_KINDS, bodyRadiusOf } from '../../src/zombies'
import { SURFACE } from '../determinism/script'

export type Model = typeof initialModel
type GameMessage = Parameters<typeof update>[1]
type Vector = { x: number; y: number }
export type Kind = ZombieKind

type BotMode = 'Campaign' | 'Endless'

// What the bot plays: the level, the mode, and how it shops and swaps.
// swapsBack is SWAP=1: it re-arms the spare gun before each wave while it
// has rounds, the way a player swaps back after a refill. The default bot
// never swaps, so once its spare runs dry it fights on with the pistol.
export type BotOptions = {
  difficulty: Difficulty
  mode: BotMode
  swapsBack: boolean
  noUpgrades: boolean
}

export const DEFAULT_OPTIONS: BotOptions = {
  difficulty: 'Normal',
  mode: 'Campaign',
  swapsBack: false,
  noUpgrades: false,
}

export const parseDifficulty = (raw: string | undefined): Difficulty => {
  const name = (raw ?? 'normal').toLowerCase()
  if (name === 'easy') {
    return 'Easy'
  }
  if (name === 'hard') {
    return 'Hard'
  }
  if (name === 'nightmare') {
    return 'Nightmare'
  }
  if (name === 'normal') {
    return 'Normal'
  }
  throw new Error(
    `DIFFICULTY must be easy, normal, hard, or nightmare, not ${name}`,
  )
}

const FRAME_MS = 1000 / 30
const maxRunMs = (options: BotOptions) =>
  (options.mode === 'Endless' ? 90 : 20) * 60 * 1000
const ROOM_CENTER: Vector = { x: 160, y: 95 }
const KEYS = {
  up: 'KeyW',
  down: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  interact: 'Enter',
  knife: 'KeyF',
}

// The options of the run being played. play sets it before every run.
let current: BotOptions = DEFAULT_OPTIONS

export type RunResult = {
  seed: number
  cleared: number
  killedBy: Kind | undefined
  victory: boolean
  runMs: number
  moneyAfterWave: Array<number>
  hurtBy: Record<Kind, number>
  maxAlive: number
  pistolTier: number
  spareTier: number
  upgradeSpend: number
  minHp: number
  waves: Array<WaveLog>
  moneyAtVisit: Array<number | undefined>
  gnomesPlaced: number
  boughtAtVisit: Array<Array<string>>
  dropped: Record<string, number>
  grabbed: Record<string, number>
  boostedMs: number
  waveMs: number
  timelines: Array<WaveTimeline>
  boss: BossLog
  newKinds: NewKindLog
  // The wave whose break the kitchen was bought in, or 0 when it never was.
  kitchenWave: number
  fridge: FridgeLog
}

// What the bot pulled from the Mystery Leftovers fridge and what it did
// with the fridge weapons: lids thrown and popped, Pan swings and the ones
// that connected, sprays, and frozen zombies shattered.
type FridgeLog = {
  pulls: number
  firstPullWave: number
  prizes: Record<string, number>
  lids: number
  pops: number
  swings: number
  clangs: number
  sprays: number
  shatters: number
  // The fridge weapon carried when the run ended, or 'None'.
  endedWith: string
  // Weapons taken from the fridge, and the knife's stabs and hits.
  taken: number
  stabs: number
  stabHits: number
  // Refills bought at the ammo window mid-wave.
  counterBuys: number
}

const emptyFridgeLog = (): FridgeLog => ({
  counterBuys: 0,
  taken: 0,
  stabs: 0,
  stabHits: 0,
  pulls: 0,
  firstPullWave: 0,
  prizes: {},
  lids: 0,
  pops: 0,
  swings: 0,
  clangs: 0,
  sprays: 0,
  shatters: 0,
  endedWith: 'None',
})

// What the Big Leaguer, the Ankle Biter, and frenzied packs did in a run.
export type NewKindLog = {
  throws: number
  shields: number
  throwHits: number
  grabs: number
  surfaced: number
  frenzies: number
  wipes: number
  wipeBonus: number
  heartsWhileClung: number
}

const emptyNewKinds = (): NewKindLog => ({
  throws: 0,
  shields: 0,
  throwHits: 0,
  grabs: 0,
  surfaced: 0,
  frenzies: 0,
  wipes: 0,
  wipeBonus: 0,
  heartsWhileClung: 0,
})

// Each boss wave the run reached: whether the boss walked in, whether it
// fell, how long it stood, and whether the run ended while it stood.
export type BossFight = {
  wave: number
  arrived: boolean
  felled: boolean
  fightMs: number
  diedToIt: boolean
  stomps: number
  stompHits: number
  belches: number
  charges: number
  chargeHits: number
  bonks: number
  spits: number
  spitHits: number
  enraged: boolean
  heartsLost: number
  heartsByAttack: Record<BossBlame, number>
  damageTaken: number
  aimedMs: number
}

type BossBlame = 'Stomp' | 'Charge' | 'Glob' | 'Bite'

const emptyBossBlame = (): Record<BossBlame, number> => ({
  Stomp: 0,
  Charge: 0,
  Glob: 0,
  Bite: 0,
})

type BossLog = Array<BossFight>

// The timeline of one wave in wall time from its start: every pack as it
// walks in, and the stretches with no zombie alive. A stretch is announced
// while a warned pack still waits at its door or the dinner bell rings.
type PackArrival = {
  atMs: number
  pack: number
  door: string
  size: number
  kinds: Array<string>
  formation: string
}

export type EmptyStretch = { fromMs: number; ms: number; announcedMs: number }

type WaveTimeline = {
  packs: Array<PackArrival>
  empty: Array<EmptyStretch>
  restMs: Array<number>
  lengthMs: number
}

// Per wave: hearts lost, seconds with 6 or more zombies within 48 px
// (pressure), seconds with none alive (relax), seconds with none alive,
// none announced, and spawns still to come (quiet, the dead air the pacing
// rules forbid) and its longest stretch, its length, and the most alive at
// once.
type WaveLog = {
  heartsLost: number
  pressureMs: number
  relaxMs: number
  quietMs: number
  quietRunMs: number
  longestQuietMs: number
  lengthMs: number
  peakAlive: number
}

const PRESSURE_PX = 48
const PRESSURE_CROWD = 6

const emptyWaveLog = (): WaveLog => ({
  heartsLost: 0,
  pressureMs: 0,
  relaxMs: 0,
  quietMs: 0,
  quietRunMs: 0,
  longestQuietMs: 0,
  lengthMs: 0,
  peakAlive: 0,
})

const spawnKey = (spawn: { pack: number; offset: number; kind: string }) =>
  `${spawn.pack}:${spawn.offset}:${spawn.kind}`

const pendingSpawns = (model: Model) =>
  model.phase._tag === 'Wave' || model.phase._tag === 'Preparation'
    ? model.phase.spawns
    : []

const isAliveZombie = (zombie: Model['zombies'][number]) =>
  zombie.state._tag === 'Walking' || zombie.state._tag === 'Fusing'

const isAnnounced = (model: Model): boolean => {
  const warned = new Set(model.pacing.warnedPacks)
  return (
    model.pacing.alarm._tag === 'Ringing' ||
    model.boss._tag === 'Arriving' ||
    pendingSpawns(model).some(spawn => warned.has(spawn.pack))
  )
}

const emptyTimeline = (): WaveTimeline => ({
  packs: [],
  empty: [],
  restMs: [],
  lengthMs: 0,
})

const recordTimeline = (
  timeline: WaveTimeline,
  before: Model,
  after: Model,
) => {
  const remaining = new Set(
    after.phase._tag === 'Wave' ? after.phase.spawns.map(spawnKey) : [],
  )
  const released =
    after.phase._tag === 'Wave'
      ? pendingSpawns(before).filter(spawn => !remaining.has(spawnKey(spawn)))
      : []
  const atMs = timeline.lengthMs
  released.forEach(spawn => {
    const known = timeline.packs.find(arrival => arrival.pack === spawn.pack)
    if (known === undefined) {
      timeline.packs.push({
        atMs,
        pack: spawn.pack,
        door: spawn.door,
        size: 1,
        kinds: [spawn.kind],
        formation: spawn.formation,
      })
    } else {
      known.size += 1
      known.kinds.push(spawn.kind)
    }
  })
  timeline.lengthMs += FRAME_MS
  const isEmpty = !after.zombies.some(isAliveZombie)
  const last = timeline.empty[timeline.empty.length - 1]
  const isOngoing = last !== undefined && last.fromMs + last.ms >= atMs - 1
  if (isEmpty) {
    const stretch = isOngoing ? last : { fromMs: atMs, ms: 0, announcedMs: 0 }
    if (!isOngoing) {
      timeline.empty.push(stretch)
    }
    stretch.ms += FRAME_MS
    stretch.announcedMs += isAnnounced(after) ? FRAME_MS : 0
  }
  const resting = after.pacing.beat._tag === 'Resting'
  const wasResting = before.pacing.beat._tag === 'Resting'
  if (resting && !wasResting) {
    timeline.restMs.push(0)
  }
  if (resting) {
    timeline.restMs[timeline.restMs.length - 1] =
      (timeline.restMs[timeline.restMs.length - 1] ?? 0) + FRAME_MS
  }
}

// The longest stretch inside an empty stretch with nothing announced.
export const quietPartMs = (stretch: EmptyStretch) =>
  stretch.ms - stretch.announcedMs

const send = (model: Model, message: GameMessage): Model =>
  update(model, message).model

// The zombies standing in the room: alive, and not under the floor, held
// overhead, or in the air, so the bot can see, shoot, and flee them.
const OUT_OF_REACH = new Set(['Burrowed', 'Carried', 'Flying'])

// VIEW=portrait plays as a phone held upright would: it sees only the
// zombies inside the portrait camera's window, which follows it and leans
// toward its aim like the game's. Zombies out of view are not shot or fled.
// VIEW=touch plays as a phone on its side would, through the landscape
// phone's zoomed window. Both get the touch aim assist, as in the game.
const maybeWindowScreen =
  process.env['VIEW'] === 'portrait'
    ? DEFAULT_PORTRAIT_SCREEN
    : process.env['VIEW'] === 'touch'
      ? LANDSCAPE_TOUCH_SCREEN
      : undefined

const windowCamera = (model: Model, screen: Screen) =>
  cameraFor(levelOf(model), cameraFocus(model), worldWindowOf(screen))

const isInView = (model: Model, zombie: Model['zombies'][number]) => {
  if (maybeWindowScreen === undefined) {
    return true
  }
  const camera = windowCamera(model, maybeWindowScreen)
  return (
    zombie.x >= camera.x &&
    zombie.x <= camera.x + camera.width &&
    zombie.y >= camera.y &&
    zombie.y <= camera.y + camera.height
  )
}

const walking = (model: Model) =>
  model.zombies.filter(
    zombie =>
      zombie.state._tag === 'Walking' &&
      !OUT_OF_REACH.has(zombie.action._tag) &&
      isInView(model, zombie),
  )

const distance = (a: Vector, b: Vector) => Math.hypot(a.x - b.x, a.y - b.y)

const steerToward = (from: Vector, to: Vector): Vector => {
  const length = distance(from, to)
  return length < 2
    ? { x: 0, y: 0 }
    : { x: (to.x - from.x) / length, y: (to.y - from.y) / length }
}

// Keeps its distance from the nearest zombie only once it is inside the
// comfort radius, the way a player plants their feet to shoot until
// something gets close, and drifts back toward the middle otherwise.
const FLEE_PX = Number(process.env['FLEE_PX'] ?? 36)

// It walks over a pickup when nothing is inside its comfort radius, the
// pickup is close, and no zombie stands near the pickup. NO_PICKUPS=1 keeps
// it from ever going for one.
const IGNORES_PICKUPS = process.env['NO_PICKUPS'] !== undefined
const PICKUP_SEEK_PX = Number(process.env['PICKUP_SEEK_PX'] ?? 90)
const PICKUP_SAFE_PX = 28

const safePickup = (model: Model): Vector | undefined => {
  if (IGNORES_PICKUPS) {
    return undefined
  }
  const zombies = walking(model)
  return model.pickups
    .filter(
      pickup =>
        distance(model.player, pickup) < PICKUP_SEEK_PX &&
        zombies.every(zombie => distance(zombie, pickup) > PICKUP_SAFE_PX),
    )
    .sort((a, b) => distance(model.player, a) - distance(model.player, b))[0]
}

// It dodges the boss the way a player who has seen his tells does: out of a
// stomp ring once it winds up, sideways off a charge lane, and out of a glob
// marker or a puddle. It keeps a wider berth from the boss than from the
// horde, since the boss is wider. KITE=1 is the player who never learns the
// tells: it only runs to the far side of the room from the boss and shoots.
const DODGE_MARGIN_PX = Number(process.env['DODGE_MARGIN'] ?? 10)
const NO_DODGE = process.env['NO_DODGE'] !== undefined
const KITES = process.env['KITE'] !== undefined
const BOSS_BODY_PX = 12
const PLAYER_BODY_PX = 4

const bossOf = (model: Model) => {
  const { boss } = model
  return boss._tag === 'Fighting'
    ? walking(model).find(zombie => zombie.id === boss.id)
    : undefined
}

const awayFromLine = (from: Vector, direction: Vector, point: Vector) => {
  const side =
    direction.x * (point.y - from.y) - direction.y * (point.x - from.x) >= 0
      ? 1
      : -1
  return { x: -direction.y * side, y: direction.x * side }
}

const distanceToLane = (
  point: Vector,
  from: Vector,
  direction: Vector,
  length: number,
) => {
  const along = Math.max(
    0,
    Math.min(
      length,
      (point.x - from.x) * direction.x + (point.y - from.y) * direction.y,
    ),
  )
  return distance(point, {
    x: from.x + direction.x * along,
    y: from.y + direction.y * along,
  })
}

const laneDodge = (
  model: Model,
  from: Vector,
  direction: Vector,
  length: number,
): Vector | undefined =>
  distanceToLane(model.player, from, direction, length) <
  BOSS_BODY_PX + PLAYER_BODY_PX + DODGE_MARGIN_PX
    ? awayFromLine(from, direction, model.player)
    : undefined

// Standing on a glob's mark, it steps across the boss's line of fire, to the
// side with more room from the nearest other zombie.
const clearSide = (model: Model, boss: Vector): Vector => {
  const toward = steerToward(boss, model.player)
  const across = { x: -toward.y, y: toward.x }
  const crowd = walking(model)
    .filter(zombie => zombie.kind !== 'Boss')
    .sort((a, b) => distance(model.player, a) - distance(model.player, b))[0]
  if (crowd === undefined) {
    return across
  }
  const left = {
    x: model.player.x + across.x * 10,
    y: model.player.y + across.y * 10,
  }
  const right = {
    x: model.player.x - across.x * 10,
    y: model.player.y - across.y * 10,
  }
  return distance(left, crowd) >= distance(right, crowd)
    ? across
    : { x: -across.x, y: -across.y }
}

// It steps off a thrown Groaner's landing mark the way it steps off a glob's,
// and keeps clear of the cracks where an Ankle Biter is about to come up.
const LANDING_MARGIN_PX = Number(process.env['LANDING_MARGIN'] ?? 6)
const CRACK_BERTH_PX = Number(process.env['CRACK_BERTH'] ?? 8)

const landingDodge = (model: Model): Vector | undefined => {
  const mark = model.zombies.find(
    zombie =>
      zombie.action._tag === 'Flying' &&
      distance(model.player, zombie.action.to) <
        CHUCKER_RULES.landRadius + PLAYER_BODY_PX + LANDING_MARGIN_PX,
  )
  if (mark?.action._tag !== 'Flying') {
    return undefined
  }
  const center = mark.action.to
  return distance(model.player, center) < 3
    ? clearSide(model, mark.action.from)
    : steerToward(center, model.player)
}

const crackDodge = (model: Model): Vector | undefined => {
  const crack = model.zombies.find(
    zombie =>
      zombie.action._tag === 'Burrowed' &&
      distance(model.player, zombie) < CRAWLER_RULES.holdPx + CRACK_BERTH_PX,
  )
  return crack === undefined ? undefined : steerToward(crack, model.player)
}

const floorDodge = (model: Model): Vector | undefined =>
  NO_DODGE ? undefined : (landingDodge(model) ?? crackDodge(model))

const telegraphDodge = (model: Model): Vector | undefined => {
  const floor = floorDodge(model)
  if (floor !== undefined) {
    return floor
  }
  if (NO_DODGE || KITES || model.boss._tag !== 'Fighting') {
    return undefined
  }
  const boss = bossOf(model)
  const marker = model.boss.globs.find(
    glob =>
      (glob._tag === 'Flying' &&
        distance(model.player, glob.to) <
          BOSS_RULES.spitRadius + PLAYER_BODY_PX + DODGE_MARGIN_PX) ||
      (glob._tag === 'Pooled' &&
        distance(model.player, glob.at) < BOSS_RULES.puddleRadius + 2),
  )
  if (marker !== undefined) {
    const center = marker._tag === 'Flying' ? marker.to : marker.at
    return distance(model.player, center) < 3
      ? clearSide(model, boss ?? { x: center.x, y: center.y - 1 })
      : steerToward(center, model.player)
  }
  if (boss === undefined) {
    return undefined
  }
  return BossMove.matchOrElse<Vector | undefined>(
    model.boss.move,
    {
      WindingUp: move =>
        move.attack !== 'Stomp'
          ? undefined
          : distance(model.player, boss) <
              BOSS_RULES.stompRadius + DODGE_MARGIN_PX
            ? steerToward(boss, model.player)
            : { x: 0, y: 0 },
      Bracing: move =>
        laneDodge(
          model,
          boss,
          steerToward(boss, move.target),
          distance(boss, move.target) + BOSS_RULES.chargeOvershootPx,
        ),
      Rushing: move => laneDodge(model, boss, move.direction, move.remainingPx),
    },
    () => undefined,
  )
}

const BOSS_BERTH_PX = Number(process.env['BOSS_BERTH'] ?? 16)

// A frenzied zombie closes the gap faster, so the bot backs off from it
// sooner, in proportion to the frenzy's extra speed.
const frenzyBerthPx = () => Math.round(FLEE_PX * (FRENZY_RULES.paceScale - 1))

// The spots a kiting player runs between: the four corners and the middle
// of each wall, a little in from the walls.
const KITE_SPOTS: Array<Vector> = [
  { x: 40, y: 40 },
  { x: 160, y: 36 },
  { x: 280, y: 40 },
  { x: 36, y: 95 },
  { x: 284, y: 95 },
  { x: 40, y: 150 },
  { x: 160, y: 154 },
  { x: 280, y: 150 },
]

const kiteAway = (model: Model, boss: Vector): Vector => {
  const spot =
    [...KITE_SPOTS].sort((a, b) => distance(b, boss) - distance(a, boss))[0] ??
    model.player
  return distance(model.player, spot) > 6
    ? steerToward(model.player, spot)
    : { x: 0, y: 0 }
}

// ENGAGE=1 holds the middle distance from the boss: outside his stomp
// trigger, inside his charge range. It walks into the horde to get there,
// so it does worse than the default, which holds the middle of the room.
const ENGAGES = process.env['ENGAGE'] !== undefined
const ENGAGE_PX = Number(process.env['ENGAGE_PX'] ?? 58)

const engage = (model: Model, boss: Vector): Vector => {
  const away = steerToward(boss, model.player)
  const spot = {
    x: boss.x + (away.x === 0 && away.y === 0 ? 1 : away.x) * ENGAGE_PX,
    y: boss.y + away.y * ENGAGE_PX,
  }
  return distance(model.player, spot) > 6
    ? steerToward(model.player, spot)
    : { x: 0, y: 0 }
}

// THE KITCHEN ROUTE

// The bot walks straight lines, so the way between the parlour and the
// fridge goes by waypoints: the kitchen's double door, a spot inside it,
// the open floor east of the prep table, up the lane west of the sacks,
// then east to the fridge.
const KITCHEN_DOOR_X = 70
const PARLOUR_SIDE: Vector = { x: KITCHEN_DOOR_X, y: 14 }
const KITCHEN_SIDE: Vector = { x: KITCHEN_DOOR_X, y: -42 }
const KITCHEN_EAST: Vector = { x: 150, y: -48 }
// NOTE: the fridge stands in the north-east corner above a pile of sacks,
// so the bot goes up the open lane west of the sacks, then east to it.
const FRIDGE_LANE: Vector = { x: 150, y: -104 }

const isInKitchen = (point: Vector) => point.y < -2

const isInDoorColumn = (point: Vector) =>
  Math.abs(point.x - KITCHEN_DOOR_X) <= 6

// The next point to walk to on the way to goal.
const routeTo = (from: Vector, goal: Vector): Vector => {
  if (isInKitchen(from) === isInKitchen(goal)) {
    if (!isInKitchen(goal) || goal.y >= -55 || Math.abs(from.x - goal.x) <= 6) {
      return goal
    }
    if (from.y > -55 && Math.abs(from.x - KITCHEN_EAST.x) > 6) {
      return KITCHEN_EAST
    }
    return from.y > FRIDGE_LANE.y + 2 ? FRIDGE_LANE : goal
  }
  if (!isInKitchen(from)) {
    return isInDoorColumn(from) && from.y < 22 ? KITCHEN_SIDE : PARLOUR_SIDE
  }
  if (from.y < -55 && from.x > 135) {
    return KITCHEN_EAST
  }
  return isInDoorColumn(from) && from.y > -48 ? PARLOUR_SIDE : KITCHEN_SIDE
}

// THE FRIDGE WEAPONS' PLAN

// How the bot fights while it carries a fridge weapon, chosen every few
// frames: whether to hold the spare or the pistol, what to aim at, and how
// long to hold a Cooker charge. The Pan is in the melee slot, so its plan
// (panPlanNow) is its own: whether to swing, and the zombie it keeps its
// distance to.
type Zombie = Model['zombies'][number]

type FridgePlan = {
  useSpare: boolean
  target: Zombie | undefined
  lobMs: number
  panTarget: Zombie | undefined
}

const GUN_PLAN: FridgePlan = {
  useSpare: false,
  target: undefined,
  lobMs: 0,
  panTarget: undefined,
}

let fridgePlan: FridgePlan = GUN_PLAN
let panPlanNow: FridgePlan = GUN_PLAN

// The Pan dazes and knocks back the small kinds; it keeps its distance
// from an Exploder, which would burst in its face, and from the big ones.
const isPannable = (zombie: Zombie) =>
  isSmallKind(zombie.kind) && zombie.kind !== 'Exploder'

const PAN_NEAR_PX = 12
const PAN_FAR_PX = 16

const panStance = (model: Model): Vector | undefined => {
  const { panTarget } = panPlanNow
  if (panTarget === undefined) {
    return undefined
  }
  const { player } = model
  const threat = walking(model)
    .filter(zombie => !isPannable(zombie))
    .sort((a, b) => distance(player, a) - distance(player, b))[0]
  if (
    threat !== undefined &&
    distance(player, threat) <
      FLEE_PX + (threat.kind === 'Boss' ? BOSS_BERTH_PX : 0)
  ) {
    return steerToward(threat, player)
  }
  const target = walking(model).find(zombie => zombie.id === panTarget.id)
  if (target === undefined) {
    return undefined
  }
  const gap = distance(player, target)
  if (gap < PAN_NEAR_PX) {
    return steerToward(target, player)
  }
  if (gap > PAN_FAR_PX) {
    return steerToward(player, target)
  }
  return { x: 0, y: 0 }
}

// THE KNIFE

// The knife is the third slot: F draws it and the trigger then stabs. The
// bot draws it while a zombie is within the knife's reach and its gun
// cannot shoot (mid-reload, empty with nothing to load, or a spent fridge
// weapon); with every gun dry the game draws it by itself. A reload carries
// on while the knife is out, so it goes back to its last gun (Q) as soon
// as that gun can shoot again and a gun has rounds.
const STAB_SLACK_PX = 1

const isGunIdle = (model: Model): boolean => {
  const { player } = model
  const held = heldGun(player.arsenal)
  return (
    isReloading(player) ||
    isSpent(held) ||
    (heldLoaded(player) <= 0 && !canReload(player))
  )
}

const isWithinKnife = (model: Model): boolean =>
  walking(model).some(
    zombie =>
      distance(model.player, zombie) - bodyRadiusOf(zombie) - PLAYER_RADIUS <=
      KNIFE_RULES.reachPx - STAB_SLACK_PX,
  )

// With the Pan in the melee slot the same rules draw it, and while its
// plan swings it the bot keeps it out.
const handleKnife = (model: Model): Model => {
  if (!isWieldingMelee(model.player)) {
    return isWithinKnife(model) && isGunIdle(model)
      ? tapKey(model, KEYS.knife)
      : model
  }
  return !panPlanNow.useSpare && !isOutOfGuns(model.player) && !isGunIdle(model)
    ? tapKey(model, 'KeyQ')
    : model
}

const kite = (model: Model): Vector => {
  const { player } = model
  const dodge = telegraphDodge(model)
  if (dodge !== undefined) {
    return dodge
  }
  const stance = panStance(model)
  if (stance !== undefined) {
    return stance
  }
  const reach = (zombie: Model['zombies'][number]) =>
    distance(player, zombie) -
    (zombie.kind === 'Boss' ? BOSS_BERTH_PX : 0) -
    (zombie.frenzy._tag === 'Frenzied' ? frenzyBerthPx() : 0)
  // A zombie frozen solid by Brain Freeze cannot bite, so it is not fled.
  const nearest = walking(model)
    .filter(zombie => !KITES || zombie.kind !== 'Boss')
    .filter(zombie => zombie.action._tag !== 'Frozen')
    .sort((a, b) => reach(a) - reach(b))[0]
  if (nearest !== undefined && reach(nearest) < FLEE_PX) {
    return steerToward(nearest, player)
  }
  if (isInKitchen(player)) {
    return steerToward(player, routeTo(player, ROOM_CENTER))
  }
  const boss = bossOf(model)
  if (boss !== undefined && KITES) {
    return kiteAway(model, boss)
  }
  if (boss !== undefined && ENGAGES) {
    return engage(model, boss)
  }

  const pickup = safePickup(model)
  if (pickup !== undefined) {
    return steerToward(player, pickup)
  }
  return distance(player, ROOM_CENTER) > 40
    ? steerToward(player, ROOM_CENTER)
    : { x: 0, y: 0 }
}

const desiredKeys = (direction: Vector): Set<string> => {
  const keys = new Set<string>()
  const length = Math.hypot(direction.x, direction.y)
  if (length < 1e-6) {
    return keys
  }
  const x = direction.x / length
  const y = direction.y / length
  if (x > 0.38) {
    keys.add(KEYS.right)
  }
  if (x < -0.38) {
    keys.add(KEYS.left)
  }
  if (y > 0.38) {
    keys.add(KEYS.down)
  }
  if (y < -0.38) {
    keys.add(KEYS.up)
  }
  return keys
}

const pressKeys = (model: Model, wanted: Set<string>): Model => {
  const held = new Set(model.input.pressedKeys)
  const released = [...held].filter(
    key => Object.values(KEYS).includes(key) && !wanted.has(key),
  )
  const pressed = [...wanted].filter(key => !held.has(key))
  const afterRelease = released.reduce(
    (sent, code) => send(sent, Message.ReleasedKey({ code })),
    model,
  )
  return pressed.reduce(
    (sent, code) => send(sent, Message.PressedKey({ code })),
    afterRelease,
  )
}

const tapKey = (model: Model, code: string): Model =>
  send(send(model, Message.PressedKey({ code })), Message.ReleasedKey({ code }))

// The bot is a fair player, not an aimbot: it re-aims only every few
// frames, aims where the target was a moment ago, and its hand shakes.
const AIM_EVERY_FRAMES = Number(process.env['AIM_EVERY'] ?? 5)
const AIM_NOISE_RADIANS = Number(process.env['AIM_NOISE'] ?? 0.22)
const MOVE_EVERY_FRAMES = Number(process.env['MOVE_EVERY'] ?? 4)

let botRandom = 1
const nextBotRandom = () => {
  botRandom = (botRandom * 1103515245 + 12345) >>> 0
  return botRandom / 0xffffffff
}

// It shoots the nearest zombie it can see, but while the boss stands it
// shoots him unless something else is within FOCUS_PX, and it always shoots
// him while he is dazed.
// NO_FOCUS=1 always shoots the nearest.
const FOCUSES_BOSS = process.env['NO_FOCUS'] === undefined
const FOCUS_PX = Number(process.env['FOCUS_PX'] ?? 60)
// A Big Leaguer holding his shield toward the bot, and the zombie he holds,
// only soak up shots, so the bot shoots something else while there is
// anything else to shoot.
const isBehindShield = (model: Model, zombie: Model['zombies'][number]) => {
  if (zombie.action._tag === 'Shielded') {
    return true
  }
  const length = Math.max(1, distance(model.player, zombie))
  const toward = {
    x: (zombie.x - model.player.x) / length,
    y: (zombie.y - model.player.y) / length,
  }
  return Option.isSome(maybeShieldFor(zombie, toward))
}

const nearestVisible = (model: Model) => {
  const inSight = walking(model)
    .filter(zombie => hasLineOfSight(levelOf(model), model.player, zombie))
    .sort((a, b) => distance(model.player, a) - distance(model.player, b))
  const open = inSight.filter(zombie => !isBehindShield(model, zombie))
  const visible = open.length > 0 ? open : inSight
  const nearest = visible[0]
  const boss = FOCUSES_BOSS
    ? visible.find(zombie => zombie.kind === 'Boss')
    : undefined
  const isDazed =
    model.boss._tag === 'Fighting' && model.boss.move._tag === 'Dazed'
  return boss !== undefined &&
    nearest !== undefined &&
    (isDazed ||
      nearest.kind === 'Boss' ||
      distance(model.player, nearest) > FOCUS_PX)
    ? boss
    : nearest
}

// Reloads when nothing is in sight and the magazine is under half, or when
// the room is empty, the way a player tops off between fights instead of
// every time a zombie ducks behind cover. An empty gun reloads on its own.
const topOff = (model: Model): Model => {
  const isLow = heldLoaded(model.player) < heldStats(model.player).magazine / 2
  return canReload(model.player) && (isLow || walking(model).length === 0)
    ? tapKey(model, 'KeyR')
    : model
}

// VIEW=portrait and VIEW=touch also get the touch aim assist
// (src/aimAssist.ts) the way the game gives it to a phone: every tick the
// trigger is held, the aim from where the bot last pointed bends onto the
// zombie it is almost on, in view of the phone's window. NO_ASSIST=1 plays
// either without it.
const maybeAssistScreen =
  process.env['NO_ASSIST'] === undefined ? maybeWindowScreen : undefined
const AIM_REACH_PX = 40
let maybeRawAim: Vector | undefined

const assistedPoint = (model: Model, rawPoint: Vector): Vector => {
  if (maybeAssistScreen === undefined) {
    return rawPoint
  }
  const camera = screenCameraOf(model)
  const raw = viewToWorld(camera, rawPoint)
  const length = Math.max(1e-6, distance(model.player, raw))
  const aim = assistAim(
    levelOf(model),
    windowCamera(model, maybeAssistScreen),
    model.player,
    model.zombies,
    {
      x: (raw.x - model.player.x) / length,
      y: (raw.y - model.player.y) / length,
    },
  )
  return worldToView(camera, {
    x: model.player.x + aim.x * AIM_REACH_PX,
    y: model.player.y + aim.y * AIM_REACH_PX,
  })
}

const holdAssistedAim = (model: Model): Model => {
  if (
    maybeAssistScreen === undefined ||
    maybeRawAim === undefined ||
    model.input.mouseButton._tag !== 'Held'
  ) {
    return model
  }
  const point = assistedPoint(model, maybeRawAim)
  return send(model, Message.MovedMouse({ clientX: point.x, clientY: point.y }))
}

// Points the mouse at target, with the hand's shake, and returns the
// screen point it aimed at.
const aimAt = (
  model: Model,
  target: Vector,
): { model: Model; point: Vector } => {
  const angle =
    Math.atan2(target.y - model.player.y, target.x - model.player.x) +
    (nextBotRandom() + nextBotRandom() - 1) * AIM_NOISE_RADIANS
  // The mouse lives in screen pixels, so the aim point goes through the
  // camera, which scrolls once the kitchen is open.
  const rawPoint = worldToView(screenCameraOf(model), {
    x: model.player.x + Math.cos(angle) * AIM_REACH_PX,
    y: model.player.y + Math.sin(angle) * AIM_REACH_PX,
  })
  maybeRawAim = rawPoint
  const point = assistedPoint(model, rawPoint)
  return {
    model: send(
      model,
      Message.MovedMouse({ clientX: point.x, clientY: point.y }),
    ),
    point,
  }
}

const pressFire = (model: Model, point: Vector): Model =>
  model.input.mouseButton._tag === 'Held'
    ? model
    : send(
        model,
        Message.PressedPointer({
          pointerId: 1,
          device: 'Mouse',
          clientX: point.x,
          clientY: point.y,
        }),
      )

const holdFire = (model: Model): Model =>
  model.input.mouseButton._tag === 'Held'
    ? send(model, Message.ReleasedPointer({ pointerId: 1 }))
    : model

const aimAndFire = (
  model: Model,
  frame: number,
  maybeTarget?: Zombie,
): Model => {
  if (frame % AIM_EVERY_FRAMES !== 0) {
    return holdAssistedAim(model)
  }
  const target = maybeTarget ?? nearestVisible(model)
  if (target === undefined) {
    return topOff(holdFire(model))
  }
  const aimed = aimAt(model, target)
  return pressFire(aimed.model, aimed.point)
}

// FIGHTING WITH A FRIDGE WEAPON

type Gun = ReturnType<typeof heldGun>

const gunsOfBot = (model: Model): ReadonlyArray<Gun> =>
  gunsOf(model.player.arsenal)

// The Clang Pan in the melee slot, if the fridge has given one.
const panOf = (model: Model): Gun | undefined =>
  Option.getOrUndefined(maybePanOf(model.player))

// The fridge weapon the bot carries in a gun slot (the Cooker or Brain
// Freeze; the Pan is in the melee slot).
const fridgeSpareOf = (model: Model): Gun | undefined =>
  gunsOfBot(model).find(gun => isFridgeWeapon(gun.kind))

type FridgeSpare = Gun

// The gun the bot bought from Rattles (the Barn Buster or the Chatterbox).
const firearmOf = (model: Model): Gun | undefined =>
  gunsOfBot(model).find(gun => gun.kind === 'Smg' || gun.kind === 'Shotgun')

const pistolOf = (model: Model): Gun | undefined =>
  gunsOfBot(model).find(gun => gun.kind === 'Pistol')

// What the bot used to call its spare: the gun it bought, else its fridge
// weapon. The pistol is never the spare.
const spareOf = (model: Model): Gun | undefined =>
  firearmOf(model) ?? fridgeSpareOf(model)

// A fridge weapon with nothing left to throw or spray.
const isSpent = (gun: Gun): boolean =>
  (gun.kind === 'Freeze' || gun.kind === 'Cooker') && gun.rounds <= 0

// How much the bot values a gun in a slot, to choose which one a new gun
// replaces: a spent fridge weapon is worth nothing, the pistol little, and
// an upgraded Chatterbox the most.
const gunValue = (gun: Gun): number => {
  if (isSpent(gun)) {
    return 0
  }
  if (gun.kind === 'Pistol') {
    return 1 + gun.tier
  }
  if (gun.kind === 'Shotgun') {
    return 2 + gun.tier
  }
  if (gun.kind === 'Smg') {
    return 3 + gun.tier * 1.5
  }
  if (gun.kind === 'Freeze') {
    return 3
  }
  return 4 + gun.tier
}

// The gun a new one would replace: none while a slot is free, else the
// weakest of the two.
const weakerGun = (model: Model): Gun | undefined => {
  const guns = gunsOfBot(model)
  return guns.length < 2
    ? undefined
    : [...guns].sort((a, b) => gunValue(a) - gunValue(b))[0]
}

// A new gun replaces the one in the player's hands, so before it buys or
// takes one the bot holds the gun it means to give up.
const holdToReplace = (model: Model, gun: Gun | undefined): Model =>
  gun !== undefined && heldGun(model.player.arsenal).kind !== gun.kind
    ? tapKey(model, 'KeyQ')
    : model

const visibleZombies = (model: Model) =>
  walking(model).filter(zombie =>
    hasLineOfSight(levelOf(model), model.player, zombie),
  )

const nearestOf = (from: Vector, zombies: ReadonlyArray<Zombie>) =>
  [...zombies].sort((a, b) => distance(from, a) - distance(from, b))[0]

// The gap from the player's edge to a zombie's body, the way the Pan's and
// Brain Freeze's reach are measured.
const edgeGap = (model: Model, zombie: Zombie) =>
  distance(model.player, zombie) - bodyRadiusOf(zombie) - PLAYER_RADIUS

const gunPlan = (target?: Zombie): FridgePlan => ({ ...GUN_PLAN, target })

// The Cooker lobs at a group at least LOB_MIN_PX away: the zombie with the
// most others within LOB_GROUP_PX, the boss and Big Lugs counting double.
// It holds the charge that throws the lid that far (the throw runs from
// minThrowPx to maxThrowPx with the charge, from just past the player's
// edge), so it lets go before the dial fills and never pops it. With
// something closer than LOB_SAFE_PX, or no group, it uses the pistol.
const LOB_MIN_PX = 40
const LOB_GROUP_PX = 20
const LOB_SAFE_PX = 22
const LID_START_PX = COOKER_RULES.lidRadius + PLAYER_RADIUS
const LOB_OVERSHOOT_PX = 4

const lobHoldMs = (gap: number, tier: number): number => {
  const share =
    (gap - LID_START_PX + LOB_OVERSHOOT_PX - COOKER_RULES.minThrowPx) /
    (COOKER_RULES.maxThrowPx - COOKER_RULES.minThrowPx)
  return (
    cookerFullMs(tier) * Math.max(COOKER_RULES.minCharge, Math.min(1, share))
  )
}

const cookerPlan = (model: Model, spare: FridgeSpare): FridgePlan => {
  if (spare.rounds <= 0) {
    return gunPlan()
  }
  const { player } = model
  const seen = visibleZombies(model)
  const nearest = nearestOf(player, seen)
  if (nearest !== undefined && distance(player, nearest) < LOB_SAFE_PX) {
    return gunPlan()
  }
  const farthest = COOKER_RULES.maxThrowPx + LID_START_PX
  const weight = (zombie: Zombie) =>
    zombie.kind === 'Boss' || zombie.kind === 'Tank' ? 2 : 1
  const score = (zombie: Zombie) =>
    seen
      .filter(other => distance(other, zombie) <= LOB_GROUP_PX)
      .reduce((total, other) => total + weight(other), 0)
  const best = seen
    .filter(zombie => {
      const gap = distance(player, zombie)
      return gap >= LOB_MIN_PX && gap <= farthest
    })
    .map(zombie => ({ zombie, score: score(zombie) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        distance(player, a.zombie) - distance(player, b.zombie),
    )[0]
  if (best === undefined || best.score < 2) {
    return gunPlan()
  }
  return {
    useSpare: true,
    target: best.zombie,
    lobMs: lobHoldMs(distance(player, best.zombie), spare.tier),
    panTarget: undefined,
  }
}

// The Pan swings at the nearest small zombie within PAN_ENGAGE_PX, which
// the bot closes to PAN_NEAR_PX to PAN_FAR_PX of (panStance), fire held.
// With a Big Lug, the boss, or an Exploder near, it backs off and uses the
// pistol, and it shoots with the pistol what is still far off.
const PAN_ENGAGE_PX = 40
const PAN_THREAT_PX = 50

const panPlan = (model: Model): FridgePlan => {
  const { player } = model
  const seen = visibleZombies(model)
  const isThreat = seen.some(
    zombie =>
      !isPannable(zombie) &&
      distance(player, zombie) <
        PAN_THREAT_PX + (zombie.kind === 'Boss' ? BOSS_BERTH_PX : 0),
  )
  if (isThreat) {
    return gunPlan()
  }
  const target = nearestOf(
    player,
    seen.filter(
      zombie => isPannable(zombie) && distance(player, zombie) < PAN_ENGAGE_PX,
    ),
  )
  return target === undefined
    ? gunPlan()
    : { useSpare: true, target, lobMs: 0, panTarget: target }
}

// Brain Freeze sprays at a small zombie close by, or at a group of two or
// more in its reach, then the bot shoots the frozen ones with the pistol,
// where any hit does triple damage.
const FREEZE_CLOSE_PX = 30
const FREEZE_GROUP_PX = 20

const freezePlan = (model: Model, spare: FridgeSpare): FridgePlan => {
  const { player } = model
  const seen = visibleZombies(model)
  const isFrozen = (zombie: Zombie) => zombie.action._tag === 'Frozen'
  const frozen = nearestOf(player, seen.filter(isFrozen))
  if (spare.rounds <= 0) {
    return gunPlan(frozen)
  }
  const freezable = seen.filter(
    zombie =>
      isSmallKind(zombie.kind) &&
      !isFrozen(zombie) &&
      edgeGap(model, zombie) <= FREEZE_RULES.reachPx - 4,
  )
  const close = nearestOf(
    player,
    freezable.filter(zombie => distance(player, zombie) < FREEZE_CLOSE_PX),
  )
  const spray = (target: Zombie): FridgePlan => ({
    useSpare: true,
    target,
    lobMs: 0,
    panTarget: undefined,
  })
  if (close !== undefined) {
    return spray(close)
  }
  if (frozen !== undefined) {
    return gunPlan(frozen)
  }
  const group = freezable
    .map(zombie => ({
      zombie,
      count: freezable.filter(
        other => distance(other, zombie) <= FREEZE_GROUP_PX,
      ).length,
    }))
    .sort((a, b) => b.count - a.count)[0]
  return group !== undefined && group.count >= 2
    ? spray(group.zombie)
    : gunPlan()
}

const planFor = (model: Model, spare: FridgeSpare): FridgePlan =>
  spare.kind === 'Cooker' ? cookerPlan(model, spare) : freezePlan(model, spare)

// The Pan swings as the knife stabs: F draws it, fire held swings at the
// planned zombie, and handleKnife puts it away (Q) once the plan has no
// target and a gun can shoot.
const swingPan = (model: Model, frame: number): Model => {
  const drawn = isWieldingMelee(model.player)
    ? model
    : tapKey(model, KEYS.knife)
  const { target } = panPlanNow
  if (frame % AIM_EVERY_FRAMES !== 0 || target === undefined) {
    return holdAssistedAim(drawn)
  }
  const aimed = aimAt(drawn, target)
  return pressFire(aimed.model, aimed.point)
}

// The Pan out with no target to swing at goes back to the last gun at
// once, unless no gun can shoot.
const sheathPan = (model: Model): Model =>
  isWieldingMelee(model.player) &&
  panOf(model) !== undefined &&
  !isOutOfGuns(model.player) &&
  !isGunIdle(model)
    ? tapKey(model, 'KeyQ')
    : model

const isHoldingSpare = (model: Model) =>
  isFridgeWeapon(heldGun(model.player.arsenal).kind)

// The Cooker's trigger, every frame: let go once the charge reaches the
// planned hold, and never hold past full.
const workCooker = (model: Model, spare: FridgeSpare): Model => {
  const { charge } = model.player
  if (charge._tag === 'Building') {
    const limit = Math.min(fridgePlan.lobMs, cookerFullMs(spare.tier))
    return charge.heldMs >= limit ? holdFire(model) : model
  }
  return charge._tag === 'Spent' ? holdFire(model) : model
}

// Every few frames the bot picks its plan and swaps to the weapon it wants
// (the swap is free); in between it only times the Cooker's release.
const fightWithFridge = (
  model: Model,
  frame: number,
  spare: FridgeSpare,
): Model => {
  if (frame % AIM_EVERY_FRAMES !== 0) {
    return isHoldingSpare(model) && spare.kind === 'Cooker'
      ? workCooker(model, spare)
      : holdAssistedAim(model)
  }
  fridgePlan = planFor(model, spare)
  const swapped =
    fridgePlan.useSpare !== isHoldingSpare(model)
      ? tapKey(model, 'KeyQ')
      : model
  if (!fridgePlan.useSpare || !isHoldingSpare(swapped)) {
    return aimAndFire(swapped, frame, fridgePlan.target)
  }
  const { target } = fridgePlan
  if (target === undefined) {
    return holdFire(swapped)
  }
  const aimed = aimAt(swapped, target)
  if (spare.kind !== 'Cooker') {
    return pressFire(aimed.model, aimed.point)
  }
  const { charge, fireCooldownMs } = aimed.model.player
  return charge._tag === 'Idle' && fireCooldownMs <= 0
    ? pressFire(aimed.model, aimed.point)
    : workCooker(aimed.model, spare)
}

// SHOPPING

const STALL_FRONT: Vector = {
  x: (STALL_BOX.left + STALL_BOX.right) / 2,
  y: STALL_BOX.top - 3,
}

// NOTE: where the bot stands at the ammo window, just below the counter.
const STALL_BELOW: Vector = {
  x: (STALL_BOX.left + STALL_BOX.right) / 2,
  y: STALL_BOX.bottom + 6,
}

// The bot shops the way a careful player would: a heart when low, the
// first gun it can afford (the cheap shotgun right after the tutorial, the
// SMG once it can), ammo below half, two Plank Piles, then upgrades and a
// Grumpy Gnome while it keeps a small reserve for a refill and a heart. It
// takes the spare to its top tier before it upgrades the pistol.
// NO_GNOME=1 keeps the old bot that never buys a gnome, and NO_PLANKS=1 a
// bot that never buys a Plank Pile, to check planks help without carrying.
const NO_GNOME = process.env['NO_GNOME'] !== undefined
const NO_PLANKS = process.env['NO_PLANKS'] !== undefined
const RESERVE = Number(process.env['RESERVE'] ?? 30)

type ItemId = Parameters<typeof priceFor>[1]
type SpareKind = FridgeSpare['kind']

// Each spare's ammo and upgrade on Rattles' shelves. The Cooker's ammo is a
// Lid Stack; the Pan never needs any and Brain Freeze is never refilled.
const REFILLS: Partial<Record<SpareKind, ItemId>> = {
  Smg: 'SmgRounds',
  Shotgun: 'ShotgunShells',
  Cooker: 'LidStack',
}

const UPGRADES: Partial<Record<SpareKind, ItemId>> = {
  Smg: 'SmgUpgrade',
  Shotgun: 'ShotgunUpgrade',
  Cooker: 'CookerUpgrade',
  Pan: 'PanUpgrade',
}

// The gun a purchase would replace, if it is a gun.
const replacedBy = (model: Model, item: ItemId): Gun | undefined => {
  if (item === 'Pistol') {
    return gunsOfBot(model).find(isSpent) ?? weakerGun(model)
  }
  if (item !== 'Smg' && item !== 'Shotgun') {
    return undefined
  }
  const guns = gunsOfBot(model)
  if (guns.length < 2) {
    return undefined
  }
  return (
    guns.find(gun => gun.kind === 'Shotgun') ??
    guns.find(isSpent) ??
    weakerGun(model)
  )
}

const wantedPurchase = (model: Model): ItemId | undefined => {
  const firearm = firearmOf(model)
  const fridge = fridgeSpareOf(model)
  const spare = spareOf(model)
  const isAvailable = (item: ItemId) =>
    verdictFor(model, item)._tag === 'Available'
  const canSpare = (item: ItemId) =>
    isAvailable(item) && model.wallet.balance - priceFor(model, item) >= RESERVE
  if (model.player.hp <= 3 && isAvailable('Heart')) {
    return 'Heart'
  }
  // Traded the pistol for a fridge weapon that is now spent: Rattles gives
  // the pistol back for nothing, in place of the spent one.
  if (
    pistolOf(model) === undefined &&
    fridge !== undefined &&
    isSpent(fridge) &&
    isAvailable('Pistol')
  ) {
    return 'Pistol'
  }
  // A spent fridge weapon is as good as no spare at all.
  if (
    firearm === undefined &&
    (fridge === undefined || (isSpent(fridge) && isAvailable('Smg')))
  ) {
    if (isAvailable('Smg')) {
      return 'Smg'
    }
    if (isAvailable('Shotgun')) {
      return 'Shotgun'
    }
    return undefined
  }
  if (spare === undefined) {
    return undefined
  }
  if (spare.kind === 'Shotgun' && spare.tier === 0 && isAvailable('Smg')) {
    return 'Smg'
  }
  const refills = [firearm, fridge].flatMap(gun => {
    if (gun === undefined) {
      return []
    }
    const refill = REFILLS[gun.kind]
    const cap = maxRounds(gun.kind, gun.tier)
    return refill !== undefined && gun.rounds < cap / 2 && isAvailable(refill)
      ? [refill]
      : []
  })
  if (refills[0] !== undefined) {
    return refills[0]
  }
  const barricades =
    model.trapStock.Barricade +
    model.traps.filter(trap => trap._tag === 'Barricade').length
  if (!NO_PLANKS && barricades < 2 && isAvailable('Barricade')) {
    return 'Barricade'
  }
  if (model.player.hp <= 4 && isAvailable('Heart')) {
    return 'Heart'
  }
  const repairs = model.traps
    .map(trap => repairItemId(trap.id))
    .filter(item => isAvailable(item))
  const repairTotal = repairs.reduce(
    (total, item) => total + priceFor(model, item),
    0,
  )
  if (repairs.length > 0 && repairTotal <= 25) {
    return repairs[0]
  }
  if (current.noUpgrades) {
    return undefined
  }
  const turrets =
    model.trapStock.Turret +
    model.traps.filter(trap => trap._tag === 'Turret').length
  // A fridge weapon's upgrades (Rattles' line for a carried Cooker or Pan)
  // come after the hearts, planks, repairs, and the first gnome.
  const spareUpgrade = UPGRADES[spare.kind]
  const isFridgeSpare = isFridgeWeapon(spare.kind)
  if (
    !isFridgeSpare &&
    spareUpgrade !== undefined &&
    spare.tier < 1 &&
    canSpare(spareUpgrade)
  ) {
    return spareUpgrade
  }
  if (!NO_GNOME && turrets < 1 && canSpare('Turret')) {
    return 'Turret'
  }
  if (wantsKitchen(model)) {
    return undefined
  }
  if (
    spareUpgrade !== undefined &&
    spare.tier < maxTier(spare.kind) &&
    canSpare(spareUpgrade)
  ) {
    return spareUpgrade
  }
  // With a gun and a fridge weapon, the fridge weapon's tiers come next.
  const fridgeUpgrade =
    fridge !== undefined && fridge !== spare ? UPGRADES[fridge.kind] : undefined
  if (
    spare.tier >= maxTier(spare.kind) &&
    fridge !== undefined &&
    fridgeUpgrade !== undefined &&
    fridge.tier < maxTier(fridge.kind) &&
    canSpare(fridgeUpgrade)
  ) {
    return fridgeUpgrade
  }
  // The Pan in the melee slot gets its tiers in the same place.
  const pan = panOf(model)
  if (
    spare.tier >= maxTier(spare.kind) &&
    pan !== undefined &&
    pan.tier < maxTier(pan.kind) &&
    canSpare('PanUpgrade')
  ) {
    return 'PanUpgrade'
  }
  if (spare.tier >= maxTier(spare.kind) && canSpare('PistolUpgrade')) {
    return 'PistolUpgrade'
  }
  if (!NO_GNOME && turrets < 2 && spare.tier >= 2 && canSpare('Turret')) {
    return 'Turret'
  }
  return undefined
}

// THE KITCHEN

// The bot buys the kitchen open the way the analytical model does: once it
// holds the SMG at its second upgrade, both Plank Piles, and a Grumpy Gnome,
// while it keeps its reserve. It walks to the boarded door and holds the interact key. KITCHEN=0 is the bot
// that never opens it, to see what the kitchen does to a run.
const NO_KITCHEN = process.env['KITCHEN'] === '0'
const KITCHEN_DOOR_PUSH: Vector = { x: 70, y: 16 }

const isKitchenOpen = (model: Model) =>
  levelOf(model).openExits.includes(KITCHEN_EXIT)

const turretCount = (model: Model) =>
  model.trapStock.Turret +
  model.traps.filter(trap => trap._tag === 'Turret').length

const plankCount = (model: Model) =>
  model.trapStock.Barricade +
  model.traps.filter(trap => trap._tag === 'Barricade').length

const wantsKitchen = (model: Model): boolean => {
  const spare = firearmOf(model)
  return (
    !NO_KITCHEN &&
    !isKitchenOpen(model) &&
    isExitOfferOpenFor(model.phase) &&
    spare?.kind === 'Smg' &&
    spare.tier >= 2 &&
    (NO_GNOME || turretCount(model) >= 1) &&
    (NO_PLANKS || plankCount(model) >= 2) &&
    model.wallet.balance - EXIT_RULES.price >= RESERVE
  )
}

let kitchenWave = 0

// THE AMMO WINDOW

// Mid-wave, when the gun in its hands runs low and it stands near the
// stall with the price in hand, the bot walks up to the ammo window
// (src/ammoCounter.ts) and holds the interact key until it buys. It keeps
// shooting on the way, so standing alone never buys for it. AMMO=0 is the
// bot that never uses the window.
const NO_AMMO_WINDOW = process.env['AMMO'] === '0'
const AMMO_WINDOW_NEAR_PX = 70

const wantsAmmoWindow = (model: Model): boolean => {
  const gun = heldGun(model.player.arsenal)
  return (
    !NO_AMMO_WINDOW &&
    isCounterOpen(model) &&
    ammoLevelOf(gun) !== 'Plenty' &&
    Option.exists(
      maybeAmmoItemOf(gun.kind),
      item => model.wallet.balance >= priceFor(model, item),
    ) &&
    distance(model.player, STALL_FRONT) < AMMO_WINDOW_NEAR_PX
  )
}

const isAtAmmoOffer = (model: Model): boolean =>
  Option.exists(maybeOfferInReach(model), offer => offer.target._tag === 'Ammo')

const holdingAtWindow = (model: Model, keys: Set<string>): Set<string> =>
  wantsAmmoWindow(model) && isAtAmmoOffer(model)
    ? new Set([...keys, KEYS.interact])
    : keys

const towardWindow = (model: Model, direction: Vector): Vector =>
  wantsAmmoWindow(model) && !isAtAmmoOffer(model)
    ? steerToward(model.player, STALL_BELOW)
    : direction

// The bot buys the room as a player does: it holds the interact key at the
// boards until the hold fills (src/purchase.ts), mid-wave too when it
// happens to stand there while it wants the room.
const holdingAtKitchen = (model: Model, keys: Set<string>): Set<string> =>
  wantsKitchen(model) && Option.isSome(maybeOfferInReach(model))
    ? new Set([...keys, KEYS.interact])
    : keys

// THE FRIDGE

// The bot pulls from Mystery Leftovers in a break once the kitchen is open,
// after it has shopped, placed its traps, and kept its reserve: the balance
// after the pull must still cover RESERVE, a heart while it is down to 4
// hearts or fewer, and whatever its shopping list still wants. It never
// pulls while the door is open or slammed. A weapon is offered, not given:
// see wouldTake.
// FRIDGE=0 is the bot that never pulls.
const NO_FRIDGE = process.env['FRIDGE'] === '0'
const FRIDGE_STAND_PX = 6

const fridgeStand = (model: Model): Vector | undefined =>
  Option.getOrUndefined(
    Option.map(fridgeBoxOf(levelOf(model)), box => ({
      x: (box.left + box.right) / 2,
      y: box.bottom + FRIDGE_STAND_PX,
    })),
  )

const isFridgeInReach = (model: Model): boolean =>
  Option.exists(
    fridgeBoxOf(levelOf(model)),
    box => distanceToBox(model.player, box) <= FRIDGE_RULES.reachPx - 2,
  )

// NOTE: take it or leave it: the bot takes a weapon on offer when it beats
// the weaker of its two guns (or a slot is free), and gives that gun up for
// it. With an upgraded Chatterbox and a plain pistol, the pistol goes, and
// Rattles sells it back for $0 once the fridge weapon is spent.
const FRIDGE_PRIZES = ['Cooker', 'Pan', 'Freeze'] as const

// The Pan takes the knife's place, not a gun's, so it always beats what
// it replaces.
const beatsWeaker = (model: Model, kind: Gun['kind']): boolean => {
  const weaker = weakerGun(model)
  return (
    kind === 'Pan' ||
    weaker === undefined ||
    gunValue(freshGun(kind)) > gunValue(weaker)
  )
}

const offeredWeapon = (model: Model): Gun['kind'] | undefined => {
  const { door } = model.fridge
  return door._tag === 'Offering' &&
    (door.prize === 'Cooker' || door.prize === 'Pan' || door.prize === 'Freeze')
    ? door.prize
    : undefined
}

const wouldTake = (model: Model): boolean => {
  const prize = offeredWeapon(model)
  return prize !== undefined && beatsWeaker(model, prize)
}

// It pulls only when it would take whatever weapon came out: the worst of
// the weapons the fridge can still give it (never the one it carries) must
// beat its weaker gun. Otherwise the $75 buys a prize it walks away from.
const wouldTakeAnyPrize = (model: Model): boolean =>
  FRIDGE_PRIZES.filter(kind => !isCarrying(model.player, kind)).every(kind =>
    beatsWeaker(model, kind),
  )

const isOfferedToBot = (model: Model): boolean =>
  model.fridge.door._tag === 'Offering' &&
  model.fridge.door.slot === leadSeatOf(model).slot

const fridgeReserve = (model: Model): number => {
  const heart =
    model.player.hp <= 4 && model.player.hp < PLAYER_MAX_HP
      ? priceFor(model, 'Heart')
      : 0
  const want = wantedPurchase(model)
  return RESERVE + heart + (want === undefined ? 0 : priceFor(model, want))
}

const wantsFridge = (model: Model): boolean =>
  !NO_FRIDGE &&
  model.phase._tag === 'Preparation' &&
  isKitchenOpen(model) &&
  fridgeStand(model) !== undefined &&
  (model.fridge.door._tag === 'Open' ||
    (isOfferedToBot(model) && wouldTake(model)) ||
    (model.fridge.door._tag === 'Shut' &&
      wouldTakeAnyPrize(model) &&
      model.wallet.balance - FRIDGE_RULES.price >= fridgeReserve(model)))

// At the fridge it holds the interact key while the door is shut, lets go
// once a pull is done so the next hold starts fresh, and waits while the
// door stands open.
const fridgeKeys = (model: Model): Set<string> =>
  (model.fridge.door._tag === 'Shut' ||
    (isOfferedToBot(model) && wouldTake(model))) &&
  model.purchase._tag !== 'Done'
    ? new Set([KEYS.interact])
    : new Set()

let fridgeLog: FridgeLog = emptyFridgeLog()

let spentOnUpgrades = 0
let gnomeTries = 0
let gnomesPlaced = 0
let boughtLog: Array<Array<string>> = []

// NOTE: what the shop dialog's close button sends: a Dialog Message in its
// Binding's envelope (src/composition.ts).
const closeShopDialog = () =>
  toParentMessage(ShopDialogBinding, DialogBlock.Message.RequestedClose())

const shop = (model: Model): Model => {
  const item = wantedPurchase(model)
  if (item === undefined) {
    return send(model, closeShopDialog())
  }
  const bought = send(model, Message.ClickedBuyButton({ item }))
  if (item.endsWith('Upgrade')) {
    spentOnUpgrades += model.wallet.balance - bought.wallet.balance
  }
  if (
    bought.wallet.balance !== model.wallet.balance &&
    model.phase._tag === 'Preparation'
  ) {
    ;(boughtLog[model.phase.wave] ??= []).push(item)
  }
  return bought.wallet.balance === model.wallet.balance
    ? send(bought, closeShopDialog())
    : bought
}

// The bot holds the parlour, so its planks go in the parlour's doorways.
const isParlourDoor = Schema.is(
  Schema.Literals(['North', 'West', 'East', 'South']),
)

const busiestDoor = (model: Model) => {
  if (model.phase._tag !== 'Preparation') {
    return undefined
  }
  // Counts follow the planks already up: a boarded door's packs come through
  // the next open door, so the second pile goes where they pile up.
  const counts = new Map<string, number>()
  doorCounts(model.phase.spawns, model.traps, levelOf(model).doorIds).forEach(
    ({ door, count }) => {
      counts.set(door, count)
    },
  )
  const boarded = new Set<string>(
    model.traps.flatMap(trap => (trap._tag === 'Barricade' ? [trap.door] : [])),
  )
  return [...counts.entries()]
    .flatMap(([door, count]) =>
      !boarded.has(door) && isParlourDoor(door) ? [{ door, count }] : [],
    )
    .sort((a, b) => b.count - a.count)[0]?.door
}

type PrepPlan =
  | 'Shop'
  | 'Kitchen'
  | 'Barricade'
  | 'Gnome'
  | 'Fridge'
  | 'Return'
  | 'Go'

// Gnomes go a little off the middle of the room, where the bot fights.
const GNOME_SPOTS: Array<Vector> = [
  { x: 146, y: 88 },
  { x: 176, y: 104 },
]

const gnomeSpot = (model: Model): Vector =>
  GNOME_SPOTS[
    Math.min(
      GNOME_SPOTS.length - 1,
      model.traps.filter(trap => trap._tag === 'Turret').length,
    )
  ] ?? model.player

const prepPlan = (model: Model, shopped: boolean): PrepPlan => {
  if (
    isShopOpenFor(model.phase) &&
    !shopped &&
    wantedPurchase(model) !== undefined
  ) {
    return 'Shop'
  }
  if (wantsKitchen(model)) {
    return 'Kitchen'
  }
  if (model.trapStock.Barricade > 0 && busiestDoor(model) !== undefined) {
    return 'Barricade'
  }
  if (model.trapStock.Turret > 0 && gnomeTries < 90) {
    return 'Gnome'
  }
  if (wantsFridge(model)) {
    return 'Fridge'
  }
  if (isInKitchen(model.player)) {
    return 'Return'
  }
  return 'Go'
}

// RUN

export const KINDS: ReadonlyArray<Kind> = Object.keys(ZOMBIE_KINDS).filter(
  Schema.is(ZombieKind),
)

export const emptyHurt = (): Record<Kind, number> =>
  EffectRecord.fromIterableWith(KINDS, kind => [kind, 0])

// NOTE: adds a fresh log entry and hands it back to fill in.
const pushed = <A>(log: Array<A>, entry: A): A => {
  log.push(entry)
  return entry
}

const bossBlameOf = (after: Model): BossBlame | undefined => {
  const tags = new Set(after.frameEvents.map(event => event._tag))
  if (tags.has('BossRammed')) {
    return 'Charge'
  }
  if (tags.has('BossStomped')) {
    return 'Stomp'
  }
  if (tags.has('GlobLanded')) {
    return 'Glob'
  }
  return undefined
}

const blamedKind = (before: Model, after: Model): Kind | undefined => {
  const burst = after.frameEvents.some(
    event =>
      event._tag === 'Exploded' &&
      Math.hypot(event.x - after.player.x, event.y - after.player.y) < 34,
  )
  if (burst) {
    return 'Exploder'
  }
  if (after.frameEvents.some(event => event._tag === 'ZombieLanded')) {
    return 'Thrower'
  }
  if (bossBlameOf(after) !== undefined) {
    return 'Boss'
  }
  return walking(before).sort(
    (a, b) => distance(before.player, a) - distance(before.player, b),
  )[0]?.kind
}

// Charges the hearts lost this frame to a kind and returns that kind.
const blame = (
  before: Model,
  after: Model,
  hurtBy: Record<Kind, number>,
): Kind | undefined => {
  const lost = before.player.hp - after.player.hp
  if (lost <= 0) {
    return undefined
  }
  const kind = blamedKind(before, after)
  if (kind !== undefined) {
    hurtBy[kind] += lost
  }
  return kind
}

// The model of a fresh run on the title, already started.
const startedRun = (seed: number, options: BotOptions): Model => {
  const ready = send(
    modifyFields(asTutorialDone(asVeteran(initialModel)), {
      rngState: () => seed,
      difficulty: () => ({ chosen: options.difficulty, nightmare: 'Unlocked' }),
    }),
    Message.MeasuredGameSurface(SURFACE),
  )
  return tapKey(
    options.mode === 'Endless' ? tapKey(ready, 'KeyE') : ready,
    'Enter',
  )
}

// How far play goes: to the end of the run, to the end of the wave it
// starts in, or to the start of a wave's Preparation.
type Stop =
  | { _tag: 'RunEnd' }
  | { _tag: 'WaveEnd' }
  | { _tag: 'WaveStart'; wave: number }

// Called with the model on the first frame of each wave's Preparation,
// before the bot shops, which is where a wave snapshot is taken.
type OnPreparation = (wave: number, model: Model) => void

const play = (
  start: Model,
  seed: number,
  options: BotOptions,
  stop: Stop,
  onPreparation: OnPreparation = () => {},
): RunResult => {
  current = options
  const hurtBy = emptyHurt()
  const moneyAfterWave: Array<number> = []
  let model = start
  let killedBy: Kind | undefined = undefined
  const startWave =
    model.phase._tag === 'Preparation' || model.phase._tag === 'Wave'
      ? model.phase.wave
      : 0
  let preparedWave = 0
  let shoppedWave = 0
  let stuckFrames = 0
  let lastPosition: Vector = model.player
  let strafe = 1
  let frame = 0
  let maxAlive = 0
  let minHp = model.player.hp
  const waves: Array<WaveLog> = []
  const moneyAtVisit: Array<number | undefined> = []
  const dropped: Record<string, number> = {}
  const grabbed: Record<string, number> = {}
  let boostedMs = 0
  let waveMs = 0
  const timelines: Array<WaveTimeline> = []
  const bossLog: BossLog = []
  const newKinds = emptyNewKinds()
  botRandom = seed
  maybeRawAim = undefined
  spentOnUpgrades = 0
  kitchenWave = 0
  fridgeLog = emptyFridgeLog()
  fridgePlan = GUN_PLAN
  panPlanNow = GUN_PLAN
  boughtLog = []
  gnomeTries = 0
  gnomesPlaced = 0
  while (
    (model.phase._tag === 'Preparation' || model.phase._tag === 'Wave') &&
    model.stats.runMs < maxRunMs(options) &&
    !(
      stop._tag === 'WaveEnd' &&
      model.phase._tag === 'Preparation' &&
      model.phase.wave !== startWave
    )
  ) {
    const wave = model.phase.wave
    if (model.phase._tag === 'Preparation' && preparedWave !== wave) {
      preparedWave = wave
      onPreparation(wave, model)
      if (stop._tag === 'WaveStart' && wave >= stop.wave) {
        break
      }
    }
    if (
      model.phase._tag === 'Preparation' &&
      isShopOpenFor(model.phase) &&
      moneyAtVisit[wave] === undefined
    ) {
      moneyAtVisit[wave] = model.wallet.balance
    }
    if (model.shop._tag === 'Browsing') {
      model = shop(model)
      if (model.shop._tag !== 'Browsing') {
        shoppedWave = wave
      }
      continue
    }
    if (model.phase._tag === 'Preparation') {
      model = holdFire(model)
      const plan = prepPlan(model, shoppedWave === wave)
      if (plan === 'Go') {
        gnomeTries = 0
        model = pressKeys(model, new Set())
        const other = Option.getOrUndefined(maybeOtherGun(model.player.arsenal))
        if (
          current.swapsBack &&
          heldGun(model.player.arsenal).kind === 'Pistol' &&
          other !== undefined &&
          other.rounds > 0
        ) {
          model = tapKey(model, 'KeyQ')
        }
        model = tapKey(topOff(model), 'Enter')
        continue
      }
      const target =
        plan === 'Shop'
          ? STALL_FRONT
          : plan === 'Kitchen'
            ? KITCHEN_DOOR_PUSH
            : plan === 'Gnome'
              ? gnomeSpot(model)
              : plan === 'Fridge'
                ? (fridgeStand(model) ?? ROOM_CENTER)
                : plan === 'Return'
                  ? ROOM_CENTER
                  : boxCenter(
                      levelOf(model).thresholds[busiestDoor(model) ?? 'North']
                        .box,
                    )
      if (plan === 'Shop') {
        const item = wantedPurchase(model)
        model = holdToReplace(
          model,
          item === undefined ? undefined : replacedBy(model, item),
        )
      }
      if (
        plan === 'Fridge' &&
        isOfferedToBot(model) &&
        wouldTake(model) &&
        offeredWeapon(model) !== 'Pan'
      ) {
        model = holdToReplace(model, weakerGun(model))
      }
      if (plan === 'Fridge' && isFridgeInReach(model)) {
        model = pressKeys(model, fridgeKeys(model))
      } else if (plan === 'Gnome' && distance(model.player, target) < 6) {
        gnomeTries += 1
        const selected =
          model.selectedTrap === 'Turret' ? model : tapKey(model, 'KeyG')
        const placed = tapKey(selected, 'KeyT')
        gnomesPlaced += placed.trapStock.Turret < model.trapStock.Turret ? 1 : 0
        model = pressKeys(placed, new Set())
      } else if (plan === 'Barricade' && distance(model.player, target) < 8) {
        const placed = tapKey(model, 'KeyT')
        model =
          placed.trapStock.Barricade < model.trapStock.Barricade
            ? placed
            : pressKeys(placed, desiredKeys(steerToward(placed.player, target)))
      } else {
        const direction = steerToward(
          model.player,
          routeTo(model.player, target),
        )
        const moved = distance(model.player, lastPosition)
        stuckFrames = moved < 0.3 ? stuckFrames + 1 : 0
        if (stuckFrames > 20) {
          strafe = -strafe
          stuckFrames = 0
        }
        const sidestep =
          stuckFrames > 5
            ? { x: -direction.y * strafe, y: direction.x * strafe }
            : direction
        model = pressKeys(model, holdingAtKitchen(model, desiredKeys(sidestep)))
      }
    } else {
      if (frame % MOVE_EVERY_FRAMES === 0) {
        model = handleKnife(
          pressKeys(
            model,
            holdingAtWindow(
              model,
              holdingAtKitchen(
                model,
                desiredKeys(towardWindow(model, kite(model))),
              ),
            ),
          ),
        )
      }
      if (panOf(model) === undefined) {
        panPlanNow = GUN_PLAN
      } else if (frame % AIM_EVERY_FRAMES === 0) {
        panPlanNow = panPlan(model)
      }
      const fridgeSpare = fridgeSpareOf(model)
      if (panPlanNow.useSpare) {
        model = swingPan(model, frame)
      } else if (fridgeSpare === undefined) {
        fridgePlan = GUN_PLAN
        model = aimAndFire(sheathPan(model), frame)
      } else {
        model = fightWithFridge(sheathPan(model), frame, fridgeSpare)
      }
    }
    lastPosition = model.player
    frame += 1
    const before = model
    model = send(model, Message.TickedFrame({ deltaTime: FRAME_MS }))
    if (!isKitchenOpen(before) && isKitchenOpen(model)) {
      kitchenWave = wave
    }
    const blamed = blame(before, model, hurtBy)
    if (model.player.hp <= 0 && before.player.hp > 0) {
      killedBy = blamed
    }
    model.frameEvents.forEach(event => {
      if (event._tag === 'ZombieThrown') {
        newKinds.throws += 1
      }
      if (event._tag === 'ShieldRaised') {
        newKinds.shields += 1
      }
      if (event._tag === 'AnklesGrabbed') {
        newKinds.grabs += 1
      }
      if (event._tag === 'CrawlerSurfaced') {
        newKinds.surfaced += 1
      }
      if (event._tag === 'PackFrenzied') {
        newKinds.frenzies += 1
      }
      if (event._tag === 'PackWiped') {
        newKinds.wipes += 1
        newKinds.wipeBonus += event.bonus
      }
      if (event._tag === 'FridgeOpened') {
        fridgeLog.pulls += 1
        fridgeLog.firstPullWave ||= wave
        fridgeLog.prizes[event.prize] = (fridgeLog.prizes[event.prize] ?? 0) + 1
      }
      if (event._tag === 'LidLaunched') {
        fridgeLog.lids += 1
      }
      if (event._tag === 'CookerPopped') {
        fridgeLog.pops += 1
      }
      if (event._tag === 'PanSwung') {
        fridgeLog.swings += 1
      }
      if (event._tag === 'PanClanged') {
        fridgeLog.clangs += 1
      }
      if (event._tag === 'KnifeStabbed') {
        fridgeLog.stabs += 1
      }
      if (event._tag === 'KnifeHit') {
        fridgeLog.stabHits += 1
      }
      if (event._tag === 'PrizeTaken') {
        fridgeLog.taken += 1
      }
      if (
        event._tag === 'Purchased' &&
        model.phase._tag === 'Wave' &&
        distance(event, STALL_BELOW) < AMMO_WINDOW_NEAR_PX
      ) {
        fridgeLog.counterBuys += 1
      }
      if (event._tag === 'FreezeSprayed') {
        fridgeLog.sprays += 1
      }
      if (event._tag === 'ZombieShattered') {
        fridgeLog.shatters += 1
      }
    })
    if (
      model.player.hp < before.player.hp &&
      model.frameEvents.some(event => event._tag === 'ZombieLanded')
    ) {
      newKinds.throwHits += 1
    }
    if (
      model.player.hp < before.player.hp &&
      before.zombies.some(zombie => zombie.action._tag === 'Clinging')
    ) {
      newKinds.heartsWhileClung += before.player.hp - model.player.hp
    }
    model.frameEvents.forEach(event => {
      if (event._tag === 'PickupDropped') {
        dropped[event.kind] = (dropped[event.kind] ?? 0) + 1
      }
      if (event._tag === 'PickupGrabbed') {
        grabbed[event.kind] = (grabbed[event.kind] ?? 0) + 1
      }
    })
    if (before.phase._tag === 'Wave') {
      waveMs += FRAME_MS
      if (Object.values(model.boosts).some(timer => timer._tag === 'On')) {
        boostedMs += FRAME_MS
      }
    }
    if (before.phase._tag === 'Wave') {
      const hasBoss = before.boss._tag !== 'Absent'
      const known = bossLog.find(fight => fight.wave === wave)
      const fight =
        known ??
        (hasBoss
          ? pushed(bossLog, {
              wave,
              arrived: false,
              felled: false,
              fightMs: 0,
              diedToIt: false,
              stomps: 0,
              stompHits: 0,
              belches: 0,
              charges: 0,
              chargeHits: 0,
              bonks: 0,
              spits: 0,
              spitHits: 0,
              enraged: false,
              heartsLost: 0,
              heartsByAttack: emptyBossBlame(),
              damageTaken: 0,
              aimedMs: 0,
            })
          : undefined)
      if (fight !== undefined) {
        if (model.boss._tag === 'Fighting') {
          fight.arrived = true
          fight.fightMs += FRAME_MS
        }
        model.frameEvents.forEach(event => {
          if (event._tag === 'ZombieKilled' && event.kind === 'Boss') {
            fight.felled = true
          }
          if (event._tag === 'BossStomped') {
            fight.stomps += 1
          }
          if (event._tag === 'BossBelched') {
            fight.belches += 1
          }
          if (event._tag === 'BossRushed') {
            fight.charges += 1
          }
          if (event._tag === 'BossRammed') {
            fight.chargeHits += 1
          }
          if (event._tag === 'BossBonked') {
            fight.bonks += 1
          }
          if (event._tag === 'BossSpat') {
            fight.spits += 1
          }
          if (event._tag === 'BossEnraged') {
            fight.enraged = true
          }
          if (
            (event._tag === 'ZombieHit' || event._tag === 'ZombieKilled') &&
            event.kind === 'Boss' &&
            event._tag === 'ZombieHit'
          ) {
            fight.damageTaken += event.damage
          }
        })
        if (
          model.boss._tag === 'Fighting' &&
          nearestVisible(before)?.kind === 'Boss'
        ) {
          fight.aimedMs += FRAME_MS
        }
        const lost = before.player.hp - model.player.hp
        if (lost > 0 && model.boss._tag === 'Fighting') {
          fight.heartsLost += lost
          const cause = bossBlameOf(model)
          const nearest = walking(before).sort(
            (a, b) => distance(before.player, a) - distance(before.player, b),
          )[0]
          if (cause !== undefined) {
            fight.heartsByAttack[cause] += lost
            if (cause === 'Glob') {
              fight.spitHits += 1
            }
          } else if (nearest?.kind === 'Boss') {
            fight.heartsByAttack.Bite += lost
          }
        }
        if (
          model.frameEvents.some(event => event._tag === 'BossStomped') &&
          model.player.hp < before.player.hp
        ) {
          fight.stompHits += 1
        }
        if (model.player.hp <= 0 && model.boss._tag === 'Fighting') {
          fight.diedToIt = true
        }
      }
    }
    maxAlive = Math.max(maxAlive, model.zombies.length)
    minHp = Math.min(minHp, model.player.hp)
    if (
      before.phase._tag === 'Wave' ||
      (before.phase._tag === 'Preparation' && model.phase._tag === 'Wave')
    ) {
      recordTimeline((timelines[wave - 1] ??= emptyTimeline()), before, model)
    }
    if (before.phase._tag === 'Wave') {
      const log = (waves[wave - 1] ??= emptyWaveLog())
      const alive = model.zombies.filter(
        zombie => zombie.state._tag !== 'Dying',
      )
      const crowd = alive.filter(
        zombie => distance(model.player, zombie) <= PRESSURE_PX,
      ).length
      log.heartsLost += Math.max(0, before.player.hp - model.player.hp)
      log.lengthMs += FRAME_MS
      log.pressureMs += crowd >= PRESSURE_CROWD ? FRAME_MS : 0
      log.relaxMs += alive.length === 0 ? FRAME_MS : 0
      const isQuiet =
        model.phase._tag === 'Wave' &&
        alive.length === 0 &&
        model.boss._tag !== 'Fighting' &&
        pendingSpawns(model).length > 0 &&
        !isAnnounced(model)
      log.quietMs += isQuiet ? FRAME_MS : 0
      log.quietRunMs = isQuiet ? log.quietRunMs + FRAME_MS : 0
      log.longestQuietMs = Math.max(log.longestQuietMs, log.quietRunMs)
      log.peakAlive = Math.max(log.peakAlive, alive.length)
    }
    if (
      process.env['BOSS_TRACE'] !== undefined &&
      process.env['BOSS_TRACE'] !== '' &&
      frame % 150 === 0 &&
      model.boss._tag === 'Fighting'
    ) {
      const boss = bossOf(model)
      console.log(
        'boss',
        boss?.x.toFixed(0),
        boss?.y.toFixed(0),
        model.boss.move._tag,
        'player',
        model.player.x.toFixed(0),
        model.player.y.toFixed(0),
        'alive',
        walking(model).length,
      )
    }
    if (
      process.env['DEBUG'] !== undefined &&
      process.env['DEBUG'] !== '' &&
      frame % 150 === 0
    ) {
      const near = walking(model).map(z => distance(model.player, z))
      console.log(
        model.phase._tag,
        wave,
        'zombies',
        near.length,
        'closest',
        Math.min(...near).toFixed(0),
        'player',
        model.player.x.toFixed(0),
        model.player.y.toFixed(0),
        'hp',
        model.player.hp,
        'shots',
        model.stats.shotsFired,
        model.stats.shotsHit,
        model.player.arsenal._tag,
      )
    }
    if (model.frameEvents.some(event => event._tag === 'WaveCleared')) {
      moneyAfterWave.push(model.wallet.earned)
    }
  }
  const finalSpare = spareOf(model)
  const finalFridge = fridgeSpareOf(model)
  return {
    seed,
    cleared: model.stats.wavesCleared,
    killedBy,
    victory: model.phase._tag === 'Victory',
    runMs: model.stats.runMs,
    moneyAfterWave,
    hurtBy,
    maxAlive,
    pistolTier: pistolOf(model)?.tier ?? 0,
    spareTier: finalSpare?.tier ?? 0,
    upgradeSpend: spentOnUpgrades,
    minHp,
    waves,
    moneyAtVisit,
    gnomesPlaced,
    boughtAtVisit: boughtLog,
    dropped,
    grabbed,
    boostedMs,
    waveMs,
    timelines,
    boss: bossLog,
    newKinds,
    kitchenWave,
    fridge: {
      ...fridgeLog,
      endedWith: finalFridge?.kind ?? 'None',
    },
  }
}

export const runOnce = (seed: number, options: BotOptions): RunResult =>
  play(startedRun(seed, options), seed, options, { _tag: 'RunEnd' })

// SEEDS

export const seedAt = (firstSeed: number, index: number) =>
  firstSeed + index * 7919

// NOTE: a wave run's roll and the bot's hand both come from this seed, kept
// apart from the campaign seeds so a replayed wave never repeats the roll
// its snapshot was taken with.
export const waveSeedAt = (firstSeed: number, index: number) =>
  1_000_003 + firstSeed + index * 7919

// WAVE SNAPSHOTS

// A wave snapshot is the model on the first frame of a wave's Preparation in
// a campaign run the bot played from a seed: its money, guns, upgrades,
// traps, and hearts are what a typical run brings to that wave. Snapshots
// are derived by playing, never stored, so they always match the current
// game, and they are cached for the life of the process.
export type WaveSnapshot = { wave: number; seed: number; model: Model }

type DerivedStarts = { untilWave: number; starts: ReadonlyMap<number, Model> }

const derivedStarts = new Map<string, DerivedStarts>()

const startsKey = (seed: number, options: BotOptions) =>
  `${options.difficulty}:${options.swapsBack}:${options.noUpgrades}:${seed}`

// The models at the start of every wave the run of seed reached, up to and
// including untilWave.
export const waveStarts = (
  seed: number,
  options: BotOptions,
  untilWave: number,
): ReadonlyMap<number, Model> => {
  const key = startsKey(seed, options)
  const known = derivedStarts.get(key)
  if (known !== undefined && known.untilWave >= untilWave) {
    return known.starts
  }
  const campaign: BotOptions = { ...options, mode: 'Campaign' }
  const starts = new Map<number, Model>()
  play(
    startedRun(seed, campaign),
    seed,
    campaign,
    { _tag: 'WaveStart', wave: untilWave },
    (wave, model) => {
      starts.set(wave, model)
    },
  )
  derivedStarts.set(key, { untilWave, starts })
  return starts
}

// How many campaign seeds a snapshot slot tries before it gives up on a
// wave the bot rarely reaches.
const SNAPSHOT_TRIES = 12

// Slot k of slots takes its snapshot from the first of the seeds k,
// k + slots, k + 2 slots, and so on whose run reached the wave. Every slot
// is found on its own, so workers can split the slots between them.
export const snapshotFor = (
  wave: number,
  slot: number,
  slots: number,
  options: BotOptions,
  firstSeed: number,
  untilWave: number = wave,
): WaveSnapshot | undefined =>
  EffectArray.makeBy(SNAPSHOT_TRIES, attempt =>
    seedAt(firstSeed, slot + attempt * slots),
  ).reduce<WaveSnapshot | undefined>((found, seed) => {
    if (found !== undefined) {
      return found
    }
    const model = waveStarts(seed, options, untilWave).get(wave)
    return model === undefined ? undefined : { wave, seed, model }
  }, undefined)

// The same wave start with the wave rolled again from waveSeed: new packs,
// doors, kinds, and boss door, the same money, gear, traps, and hearts.
export const rerolled = (model: Model, waveSeed: number): Model => {
  const { phase } = model
  return phase._tag === 'Preparation'
    ? withWorld(modifyFields(model, { rngState: () => waveSeed }), world =>
        beginPreparation(world, phase.wave, phase.durationMs, phase.clock),
      )
    : model
}

type WaveOutcome = 'Cleared' | 'Died' | 'TimedOut'

export type WaveRun = {
  wave: number
  snapshotSeed: number
  waveSeed: number
  outcome: WaveOutcome
  heartsLost: number
  lengthMs: number
  emptyMs: number
  quietMs: number
  longestQuietMs: number
  pressureMs: number
  peakAlive: number
  killedBy: Kind | undefined
  hurtBy: Record<Kind, number>
}

export const playSnapshot = (
  snapshot: WaveSnapshot,
  waveSeed: number,
  options: BotOptions,
): WaveRun => {
  const result = play(
    rerolled(snapshot.model, waveSeed),
    waveSeed,
    { ...options, mode: 'Campaign' },
    { _tag: 'WaveEnd' },
  )
  const log = result.waves[snapshot.wave - 1] ?? emptyWaveLog()
  const outcome: WaveOutcome =
    result.victory || result.cleared >= snapshot.wave
      ? 'Cleared'
      : result.minHp <= 0
        ? 'Died'
        : 'TimedOut'
  return {
    wave: snapshot.wave,
    snapshotSeed: snapshot.seed,
    waveSeed,
    outcome,
    heartsLost: log.heartsLost,
    lengthMs: log.lengthMs,
    emptyMs: log.relaxMs,
    quietMs: log.quietMs,
    longestQuietMs: log.longestQuietMs,
    pressureMs: log.pressureMs,
    peakAlive: log.peakAlive,
    killedBy: result.killedBy,
    hurtBy: result.hurtBy,
  }
}

export type WavePass = {
  waves: ReadonlyArray<number>
  runs: number
  slots: number
  firstSeed: number
  // Runs to skip in the seed list, so a second batch rolls new waves.
  seedOffset: number
}

// Plays runs of every wave in the pass. Run i of a wave starts from slot
// i % slots and rolls its wave from waveSeedAt(seedOffset + i). ownsSlot picks the slots
// this process plays, so workers can split a pass by slot.
export const playWavePass = (
  pass: WavePass,
  options: BotOptions,
  ownsSlot: (slot: number) => boolean = () => true,
): Array<WaveRun> => {
  const untilWave = Math.max(...pass.waves)
  return pass.waves.flatMap(wave =>
    EffectArray.makeBy(pass.runs, index => index).flatMap(index => {
      const slot = index % pass.slots
      if (!ownsSlot(slot)) {
        return []
      }
      const snapshot = snapshotFor(
        wave,
        slot,
        pass.slots,
        options,
        pass.firstSeed,
        untilWave,
      )
      return snapshot === undefined
        ? []
        : [
            playSnapshot(
              snapshot,
              waveSeedAt(pass.firstSeed, pass.seedOffset + index),
              options,
            ),
          ]
    }),
  )
}
