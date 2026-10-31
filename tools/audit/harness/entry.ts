import { Array, Effect, Layer, Option, Record, Scope } from 'effect'

// NOTE: next, so the build's prebuilt sprite atlas is in place before any
// game module builds a sprite, as in the game's own entry.
import '@game/spriteAtlasBoot'

import './harness.css'
import { Block, Canvas, Dom, Program, Runtime } from 'foldkit'
import type * as Command from 'foldkit/command'
import type { Document } from 'foldkit/html'
import { modifyFields } from 'foldkit/struct'
import { toParentMessage } from 'foldkit/test'

import { DialogBlock } from '@foldkit/ui'
import {
  BODIES,
  HAIR_COLORS,
  HAIR_STYLES,
  ON_OFF,
  OUTFITS,
  PRINTS,
  SHIRT_COLORS,
  SKIN_TONES,
  playerSprites,
} from '@game/appearance'
import { PARLOUR, levelOf, openExitIn } from '@game/arena'
import { LoadSave } from '@game/boot'
import { BOSS_RULES, hasBoss, planBoss } from '@game/boss'
import { cameraOf, worldToView } from '@game/camera'
import { ApplicationComposition, ProfileDialogBinding } from '@game/composition'
import { DECAL_MAX, PLAYER_MAX_HP, SHADOW_COLOR } from '@game/constants'
import * as CoopModel from '@game/coop/model'
import {
  CODE as COOP_CODE,
  lobbyOf,
  memberOf,
  playingSession,
  quietCoopNet,
  stagedWorld,
} from '@game/coop/testing'
import { withBests } from '@game/difficulty'
import { noteRecords } from '@game/endBeat'
import { rollSpawns } from '@game/endlessWaves'
import { KITCHEN_EXIT } from '@game/exits'
import { pressHoldButton, pressKey, releaseAll } from '@game/input'
import { quietLayer as quietInstallPrompt } from '@game/install'
import { EffectsLayer } from '@game/layer'
import { sceneShapes } from '@game/layers'
import { init, update } from '@game/main'
import { Message } from '@game/message'
import {
  type Appearance,
  Arsenal,
  type Boosts,
  type Boss,
  type BossMove,
  BreakClock,
  type Decal,
  type DecalKind,
  DifficultyCard,
  FridgeDoor,
  type Glob,
  Lesson,
  Melee,
  type Model,
  MouseButton,
  Oven,
  Phase,
  type PickupKind,
  type ProfileTab,
  RunMode,
  Stick,
  Tour,
  Trap,
  TrapHint,
  type WeaponKind,
  type Zombie,
  ZombieAction,
  type ZombieKind,
  defaultAppearance,
  initialModel,
} from '@game/model'
import { raiseDebutCard } from '@game/onboarding'
import { advanceParticles } from '@game/particles'
import { creditKills, seatCrew } from '@game/party'
import { LinkFlow, PlayerScopeStatus, SyncState } from '@game/playerSync'
import { FLOOR_COLOR } from '@game/roomPalette'
import { startOrResume } from '@game/runFlow'
import { screenOf } from '@game/screen'
import { STALL_BOX } from '@game/shop'
import { shedParts } from '@game/simulation'
import { frameAt, group } from '@game/sprite'
import { gunSprite } from '@game/sprites/guns'
import { stepWhen } from '@game/stepWhen'
import { layer as PlayerStoreLayer } from '@game/store'
import { subscriptions } from '@game/subscriptions'
import { managedResources } from '@game/update/sound'
import { withInput } from '@game/update/step'
import { RUNNING_BUILD } from '@game/version'
import { view } from '@game/view'
import { planFor } from '@game/wavePlans'
import { pause } from '@game/waves'
import { STARTING_PISTOL, freshGun, mapGuns } from '@game/weapons'
import { withWorld } from '@game/world'
import { ZOMBIE_KINDS, ZOMBIE_KIND_ORDER, scaledHp } from '@game/zombies'
import { Session } from '@munch/netcode'

import { cardShapes } from './cards'
import { type HarnessConfig, decodeHarnessConfig } from './config'
import * as Director from './director'
import { settle } from './readiness'

const readConfig = () => {
  try {
    return decodeHarnessConfig(location.search)
  } catch (error) {
    const root = document.getElementById('root')
    if (root !== null) {
      root.textContent = `Bad harness query: ${String(error)}`
      root.className = 'harness-error'
    }
    throw error
  }
}
const PLAYER_X = 160
const PLAYER_Y = 90

// NOTE: the scene's settings. They are module state, not constants, because
// `window.__loadScene` swaps in another scene without reloading the page.
let config: HarnessConfig = readConfig()
let gasbagRoom = 0
let px = PLAYER_X
let py = PLAYER_Y
let god = false
let instrument = false
// NOTE: `hold` holds the interact key (on touch, a finger on the hold
// button) from the first frame, so `tick=N` shows the ring N frames in.
const HOLD_POINTER_ID = 99
const STAB_POINTER_ID = 98

let freezeAfter = Infinity
const useConfig = (next: HarnessConfig) => {
  config = next
  gasbagRoom = next.gasroom
  px = next.px ?? PLAYER_X
  py = next.py ?? PLAYER_Y
  god = next.god
  instrument = next.instrument
  freezeAfter =
    next.tick !== undefined || next.director ? 0 : (next.freeze ?? Infinity)
}
useConfig(config)
const ROAMING: Zombie['action'] = { _tag: 'Roaming' }
const CALM: Zombie['frenzy'] = { _tag: 'Calm' }

const KINDS: ReadonlyArray<DecalKind> = [
  'Blood',
  'Meat',
  'Rot',
  'Shell',
  'Bone',
  'Hide',
  'Goo',
  'Scorch',
  'Wood',
]

const makeDecals = (count: number): Array<Decal> => {
  const out: Array<Decal> = []
  let s = 12345
  const r = () => (s = (s * 1103515245 + 12345) >>> 0) / 0xffffffff
  for (let i = 0; i < count; i++) {
    out.push({
      kind: KINDS[i % KINDS.length] ?? 'Blood',
      x: Math.round(24 + r() * 272),
      y: Math.round(24 + r() * 132),
      width: 2 + Math.round(r() * 5),
      height: 1 + Math.round(r() * 3),
    })
  }
  return out
}

const FRIDGE_GUNS: Readonly<Record<'cooker' | 'pan' | 'freeze', WeaponKind>> = {
  cooker: 'Cooker',
  pan: 'Pan',
  freeze: 'Freeze',
}

// NOTE: Mystery Leftovers. `fridge=open|offering|slammed` with `fridgeMs` left sets
// the fridge's door (`prize` names an open door's prize), `fridgeseed` sets
// the fridge's own stream, so a real pull draws a chosen prize, `lobs` puts
// three Pressure Cooker lids in the air ahead of the player (one landing a
// few frames before `tick` runs out), and `iced=freeze|pan` stands zombies
// in front of the player, frozen and chilled or reeling.
const ICED_SPOTS: ReadonlyArray<
  Readonly<{
    dx: number
    dy: number
    kind: 'Shambler' | 'Runner' | 'Exploder' | 'Tank'
    freeze: 'Frozen' | 'Chilled' | 'Roaming'
    pan: 'Reeling' | 'Roaming'
  }>
> = [
  { dx: 18, dy: -6, kind: 'Shambler', freeze: 'Frozen', pan: 'Reeling' },
  { dx: 24, dy: 8, kind: 'Runner', freeze: 'Frozen', pan: 'Reeling' },
  { dx: 44, dy: 0, kind: 'Tank', freeze: 'Chilled', pan: 'Roaming' },
  { dx: 30, dy: -8, kind: 'Exploder', freeze: 'Frozen', pan: 'Reeling' },
  { dx: 12, dy: 3, kind: 'Shambler', freeze: 'Roaming', pan: 'Roaming' },
]

const icedAction = (action: 'Frozen' | 'Chilled' | 'Roaming' | 'Reeling') =>
  action === 'Frozen'
    ? ZombieAction.Frozen({ remainingMs: 3000, durationMs: 3200 })
    : action === 'Chilled'
      ? ZombieAction.Chilled({ remainingMs: 3000 })
      : action === 'Reeling'
        ? ZombieAction.Reeling({ remainingMs: 600, durationMs: 700 })
        : ZombieAction.Roaming()

const LID_FLIGHT_MS = 520

const withLeftovers = (start: Model): Model => {
  let model = start
  const door = config.fridge
  if (door !== undefined) {
    model = modifyFields(model, {
      fridge: fridge => ({
        ...fridge,
        door:
          door === 'open'
            ? FridgeDoor.Open({
                prize: config.prize ?? 'Cooker',
                slot: 0,
                remainingMs: config.fridgeMs,
                durationMs: 1100,
              })
            : door === 'offering'
              ? FridgeDoor.Offering({
                  prize: config.prize ?? 'Cooker',
                  slot: 0,
                  remainingMs: config.fridgeMs,
                  durationMs: 6000,
                })
              : FridgeDoor.Slammed({
                  remainingMs: config.fridgeMs,
                  durationMs: 30_000,
                }),
      }),
    })
  }
  const fridgeSeed = config.fridgeseed
  if (fridgeSeed !== undefined) {
    model = modifyFields(model, {
      loot: loot => ({ ...loot, fridgeRngState: fridgeSeed >>> 0 }),
    })
  }
  const iced = config.iced
  if (iced !== undefined) {
    model = modifyFields(model, {
      zombies: zombies => [
        ...zombies,
        ...ICED_SPOTS.map((spot, index): Zombie => ({
          id: 9400 + index,
          kind: spot.kind,
          x: px + spot.dx,
          y: py + spot.dy,
          speed: spot.kind === 'Tank' ? 12 : 20,
          hp: spot.kind === 'Tank' ? 30 : 6,
          maxHp: spot.kind === 'Tank' ? 30 : 6,
          knockback: { x: 0, y: 0 },
          hitRemainingMs: 0,
          state: { _tag: 'Walking' as const },
          action: icedAction(iced === 'freeze' ? spot.freeze : spot.pan),
          frenzy: CALM,
        })),
      ],
    })
  }
  if (config.lobs) {
    const landsInMs = Math.max(20, ((config.tick ?? 0) - 5) * (1000 / 60))
    const flights = [
      { to: { x: px + 70, y: py - 28 }, remainingMs: landsInMs },
      { to: { x: px + 100, y: py - 4 }, remainingMs: landsInMs + 260 },
      { to: { x: px + 45, y: py - 44 }, remainingMs: landsInMs + 420 },
    ]
    model = modifyFields(model, {
      lobs: () =>
        flights.map((flight, index) => {
          const durationMs = Math.max(LID_FLIGHT_MS, flight.remainingMs + 120)
          const progress = 1 - flight.remainingMs / durationMs
          return {
            id: 9500 + index,
            x: px + (flight.to.x - px) * progress,
            y: py + (flight.to.y - py) * progress,
            from: { x: px, y: py },
            to: flight.to,
            remainingMs: flight.remainingMs,
            durationMs,
            charge: 0.8,
            tier: 0,
          }
        }),
    })
  }
  return model
}

const roomModel = (): Model => {
  const wave = config.wave
  if (wave === 0) {
    return initialModel
  }
  const mode =
    config.mode === 'endless' ? RunMode.Endless() : RunMode.Campaign()
  const begun = startOrResume(initialModel, mode)
  const started = config.kitchen
    ? modifyFields(begun, {
        level: level => openExitIn(level, KITCHEN_EXIT),
      })
    : begun
  const [rngState, spawns] = rollSpawns(
    started.rngState,
    wave,
    levelOf(started).doorIds,
  )
  const gun = config.gun
  const smgRounds = config.rounds ?? 360
  const shotgunRounds = config.rounds ?? 48
  const firstGun = config.first
  const first =
    firstGun === undefined
      ? STARTING_PISTOL
      : firstGun === 'smg'
        ? { ...freshGun('Smg'), rounds: smgRounds, tier: config.tier }
        : firstGun === 'shotgun'
          ? { ...freshGun('Shotgun'), rounds: shotgunRounds, tier: config.tier }
          : { ...freshGun(FRIDGE_GUNS[firstGun]), tier: config.tier }
  let model: Model = modifyFields(started, {
    rngState: () => rngState,
    phase: () =>
      config.start === 'wave'
        ? Phase.Wave({ wave, elapsedMs: config.elapsed, spawns })
        : Phase.Preparation({
            wave,
            remainingMs: config.prep,
            durationMs: 20000,
            spawns,
            clock:
              config.break === 'open'
                ? BreakClock.Waiting({ elapsedMs: config.breakMs })
                : BreakClock.Counting(),
          }),
    wallet: w => ({
      ...w,
      balance: config.money,
      shown: config.money,
      earned: config.money,
    }),
    decals: () => (config.fill ? makeDecals(DECAL_MAX) : []),
    trapStock: () => ({
      Barricade: config.barricades,
      Turret: config.turrets,
    }),
    player: p =>
      gun === 'smg'
        ? {
            ...p,
            arsenal: Arsenal.HoldingSecond({
              first,
              second: {
                kind: 'Smg',
                rounds: smgRounds,
                loaded: Math.min(config.loaded, smgRounds),
                tier: config.tier,
              },
            }),
          }
        : gun === 'pan'
          ? {
              ...p,
              arsenal: Arsenal.OneGun({ first }),
              melee: Melee.Pan({
                pan: { ...freshGun('Pan'), tier: config.tier },
              }),
              wield: 'Melee',
            }
          : gun === 'cooker' || gun === 'freeze'
            ? {
                ...p,
                arsenal: Arsenal.HoldingSecond({
                  first,
                  second: { ...freshGun(FRIDGE_GUNS[gun]), tier: config.tier },
                }),
              }
            : gun === 'shotgun'
              ? {
                  ...p,
                  arsenal: Arsenal.HoldingSecond({
                    first,
                    second: {
                      kind: 'Shotgun',
                      rounds: shotgunRounds,
                      loaded: Math.min(6, shotgunRounds),
                      tier: config.tier,
                    },
                  }),
                }
              : p,
  })
  const crowd = config.crowd ?? gasbagRoom
  const toughness = config.tough ? 40 : 1
  if (crowd > 0) {
    const kinds = [
      'Shambler',
      'Runner',
      'Shambler',
      'Exploder',
      'Shambler',
      'Runner',
      'Shambler',
    ] as const
    const spots: ReadonlyArray<readonly [number, number]> = [
      [40, 40],
      [280, 40],
      [40, 140],
      [250, 120],
      [160, 30],
      [160, 150],
      [30, 90],
      [290, 90],
    ]
    const zombies = globalThis.Array.from({ length: crowd }, (_, i): Zombie => {
      const kind =
        gasbagRoom > 0
          ? 'Exploder'
          : i < 4
            ? 'Tank'
            : (kinds[i % kinds.length] ?? 'Shambler')
      const [sx, sy] = spots[i % spots.length] ?? [0, 0]
      return {
        id: 1000 + i,
        kind,
        x: sx + ((i * 7) % 13) - 6,
        y: sy + ((i * 5) % 11) - 5,
        speed: kind === 'Runner' ? 46 : kind === 'Tank' ? 12 : 22,
        hp: (kind === 'Tank' ? 14 : kind === 'Runner' ? 1 : 2) * toughness,
        maxHp: (kind === 'Tank' ? 30 : kind === 'Runner' ? 2 : 3) * toughness,
        knockback: { x: 0, y: 0 },
        hitRemainingMs: 0,
        state: { _tag: 'Walking' },
        action: ROAMING,
        frenzy: CALM,
      }
    })
    model = modifyFields(model, {
      zombies: () => zombies,
      nextEntityId: () => 2000,
    })
  }
  const lineup = config.lineup
  const stageHp = (kind: LineupKind, maxHp: number, stage: number) =>
    stage === 0
      ? maxHp
      : Math.max(
          1,
          Math.floor(maxHp * (ZOMBIE_KINDS[kind].wear[stage - 1]?.below ?? 1)),
        )
  type LineupKind = ZombieKind
  const standing = (
    id: number,
    kind: LineupKind,
    x: number,
    y: number,
    maxHp: number,
    stage: number,
  ): Zombie => ({
    id,
    kind,
    x,
    y,
    speed: 0,
    hp: stageHp(kind, maxHp, stage),
    maxHp,
    knockback: { x: 0, y: 0 },
    hitRemainingMs: 0,
    state: { _tag: 'Walking' },
    action: ROAMING,
    frenzy: CALM,
  })
  if (lineup === 'wear') {
    const rows: Array<[LineupKind, number, number, number]> = [
      ['Shambler', 4, 50, 50],
      ['Runner', 2, 50, 72],
      ['Exploder', 7, 50, 96],
      ['Tank', 36, 180, 64],
      ['Thrower', 15, 180, 100],
      ['Crawler', 2, 50, 118],
    ]
    const zombies = rows.flatMap(([kind, maxHp, left, y], row) =>
      globalThis.Array.from(
        { length: ZOMBIE_KINDS[kind].wear.length + 1 },
        (_, stage) =>
          standing(
            1000 + row * 10 + stage,
            kind,
            left + stage * (kind === 'Tank' ? 30 : 28),
            y,
            maxHp,
            stage,
          ),
      ),
    )
    model = modifyFields(model, {
      zombies: () => zombies,
      nextEntityId: () => 2000,
    })
  }
  if (lineup === 'sizes') {
    const kinds: Array<[LineupKind, number]> = [
      ['Crawler', 2],
      ['Runner', 2],
      ['Shambler', 4],
      ['Exploder', 7],
      ['Thrower', 15],
      ['Tank', 36],
    ]
    const zombies = kinds.map(([kind, maxHp], index) =>
      standing(1000 + index, kind, 70 + index * 24, 100, maxHp, 0),
    )
    model = modifyFields(model, {
      zombies: () => zombies,
      nextEntityId: () => 2000,
    })
  }
  if (lineup === 'armor') {
    const stages = ZOMBIE_KINDS.Tank.wear.length + 1
    const at = (stage: number) => ({ x: 70 + stage * 50, y: 90 })
    const fresh = globalThis.Array.from({ length: stages }, (_, stage) =>
      standing(1000 + stage, 'Tank', at(stage).x, at(stage).y, 36, 0),
    )
    const worn = globalThis.Array.from({ length: stages }, (_, stage) =>
      standing(1000 + stage, 'Tank', at(stage).x, at(stage).y, 36, stage),
    )
    const before = modifyFields(model, { zombies: () => fresh })
    const after = modifyFields(model, { zombies: () => worn })
    model = modifyFields(
      advanceParticles(
        { ...after, ...shedParts(before, after) },
        1 / 60,
        1000 / 60,
      ),
      { nextEntityId: () => 2000 },
    )
  }
  if (lineup === 'boss') {
    const zombies = globalThis.Array.from({ length: 5 }, (_, stage) =>
      standing(1100 + stage, 'Boss', 48 + stage * 56, 80, 99, stage),
    )
    model = modifyFields(model, {
      zombies: () => zombies,
      nextEntityId: () => 2000,
    })
  }
  const bossParam = config.boss
  if (bossParam !== undefined) {
    const bossMaxHp = scaledHp(ZOMBIE_KINDS.Boss.hp, planFor(8).hpScale)
    const bossHp = Math.round(bossMaxHp * config.bosshp)
    const { bx, by } = config
    const bossZombie: Zombie = {
      ...standing(1500, 'Boss', bx, by, bossMaxHp, 0),
      hp: bossHp,
      speed: 10,
    }
    const door = config.door ?? 'East'
    const target = { x: config.tx, y: config.ty }
    const toTarget = Math.hypot(target.x - bx, target.y - by) || 1
    const direction = {
      x: (target.x - bx) / toTarget,
      y: (target.y - by) / toTarget,
    }
    const windMs = config.windMs
    const puddles = (config.puddles ?? []).map(([x, y]): Glob => ({
      _tag: 'Pooled',
      at: { x, y },
      remainingMs: config.puddleMs,
      durationMs: BOSS_RULES.puddleMs,
    }))
    const flying: ReadonlyArray<Glob> =
      bossParam === 'spit'
        ? [
            {
              _tag: 'Flying',
              from: { x: bx, y: by },
              to: target,
              remainingMs: config.globMs,
              durationMs: BOSS_RULES.spitFlightMs,
            },
          ]
        : []
    const moves: Readonly<Record<string, () => BossMove>> = {
      stomp: () => ({
        _tag: 'WindingUp',
        attack: 'Stomp',
        remainingMs: windMs,
        durationMs: 1000,
      }),
      belch: () => ({
        _tag: 'WindingUp',
        attack: 'Belch',
        remainingMs: windMs,
        durationMs: 1000,
      }),
      charge: () => ({
        _tag: 'Bracing',
        target,
        remainingMs: windMs,
        durationMs: BOSS_RULES.windUpMs.Charge,
      }),
      rush: () => ({
        _tag: 'Rushing',
        direction,
        remainingPx: toTarget + BOSS_RULES.chargeOvershootPx,
      }),
      dazed: () => ({
        _tag: 'Dazed',
        remainingMs: windMs,
        durationMs: BOSS_RULES.dazedMs,
      }),
    }
    const moveFor = (): BossMove =>
      (
        moves[bossParam] ??
        ((): BossMove => ({ _tag: 'Stalking', cooldownMs: config.cooldownMs }))
      )()
    const bossState: Boss =
      bossParam === 'arriving'
        ? {
            _tag: 'Arriving',
            door,
            hp: bossMaxHp,
            remainingMs: config.arriveMs,
            durationMs: 2600,
          }
        : {
            _tag: 'Fighting',
            id: 1500,
            standingMs: 4000,
            move: moveFor(),
            mood: config.enraged ? 'Enraged' : 'Calm',
            nextFar: 'Charge',
            belchMs: 60_000,
            globs: [...puddles, ...flying],
          }
    model = modifyFields(model, {
      boss: () => bossState,
      zombies: zombies =>
        bossParam === 'arriving' ? zombies : [...zombies, bossZombie],
      nextEntityId: () => 2000,
    })
  } else if (hasBoss(wave)) {
    const planned =
      model.phase._tag === 'Preparation' || model.phase._tag === 'Wave'
        ? model.phase.spawns
        : []
    const [bossRng, plannedBoss] = planBoss(
      levelOf(model).doorIds,
      model.rngState,
      wave,
      planned,
    )
    model = modifyFields(model, {
      boss: () => plannedBoss,
      rngState: () => bossRng,
    })
  }
  const staged: Array<Zombie> = []
  const stagedZombie = (
    id: number,
    kind: LineupKind,
    x: number,
    y: number,
    extra: Partial<Zombie> = {},
  ): Zombie => ({
    ...standing(id, kind, x, y, ZOMBIE_KINDS[kind].hp, 0),
    speed: 20,
    ...extra,
  })
  if (config.gasbags) {
    staged.push(
      stagedZombie(1700, 'Exploder', 70, 60),
      stagedZombie(1701, 'Exploder', px + 22, py - 4, {
        hp: 1,
      }),
      stagedZombie(1702, 'Exploder', 240, 120, {
        hp: 0,
        state: { _tag: 'Fusing', remainingMs: config.fuseMs },
      }),
    )
  }
  if (config.frenzy) {
    const pack = 4242
    const kinds: Array<LineupKind> = [
      'Shambler',
      'Shambler',
      'Runner',
      'Shambler',
      'Exploder',
    ]
    kinds.forEach((kind, index) =>
      staged.push(
        stagedZombie(
          1720 + index,
          kind,
          50 + (index % 3) * 10,
          80 + Math.floor(index / 3) * 12 + (index % 2) * 3,
          {
            frenzy: { _tag: 'Frenzied', pack, apartMs: 0 },
          },
        ),
      ),
    )
    staged.push(
      stagedZombie(1730, 'Shambler', 120, 150, {
        frenzy: { _tag: 'Fading', pack, remainingMs: 500 },
      }),
    )
    model = modifyFields(model, {
      popups: () => [
        {
          kind: 'Horde' as const,
          value: 0,
          x: 40,
          y: 72,
          velocityX: 0,
          ageMs: config.hordeAge,
        },
        ...(config.wipe
          ? [
              {
                kind: 'Wipe' as const,
                value: 5,
                x: 200,
                y: 80,
                velocityX: 0,
                ageMs: 400,
              },
            ]
          : []),
      ],
    })
  }
  const chucker = config.chucker
  if (chucker === 'heft') {
    staged.push(
      stagedZombie(1740, 'Thrower', config.cx ?? 230, config.cy ?? 70, {
        action: {
          _tag: 'Hefting',
          victimId: 1741,
          remainingMs: config.heftMs,
          durationMs: 900,
        },
      }),
      stagedZombie(1741, 'Shambler', config.cx ?? 230, config.cy ?? 70, {
        action: { _tag: 'Carried', byId: 1740 },
      }),
    )
  }
  if (chucker === 'throw') {
    const from = { x: config.cx ?? 240, y: config.cy ?? 60 }
    const to = { x: px, y: py }
    const durationMs = 900
    const remainingMs = config.flyMs
    const progress = 1 - remainingMs / durationMs
    staged.push(
      stagedZombie(1750, 'Thrower', from.x, from.y, {
        action: { _tag: 'Winded', remainingMs: 2000 },
      }),
      stagedZombie(
        1751,
        'Shambler',
        from.x + (to.x - from.x) * progress,
        from.y + (to.y - from.y) * progress,
        {
          action: { _tag: 'Flying', from, to, remainingMs, durationMs },
        },
      ),
    )
  }
  if (chucker === 'taunt') {
    staged.push(
      stagedZombie(1755, 'Thrower', config.cx ?? 230, config.cy ?? 70, {
        action: { _tag: 'Winded', remainingMs: 3100 },
      }),
    )
  }
  if (chucker === 'shield') {
    const at = { x: config.cx ?? 200, y: config.cy ?? 80 }
    const aim = Math.atan2(py - at.y, px - at.x)
    staged.push(
      stagedZombie(1790, 'Thrower', at.x, at.y, {
        action: {
          _tag: 'Shielding',
          victimId: 1791,
          remainingMs: config.shieldMs,
          aim,
        },
      }),
      stagedZombie(
        1791,
        'Shambler',
        at.x + Math.cos(aim) * 7,
        at.y + Math.sin(aim) * 7,
        {
          action: { _tag: 'Shielded', byId: 1790 },
        },
      ),
    )
  }
  if (chucker === 'dazed') {
    staged.push(
      stagedZombie(1760, 'Shambler', px + 14, py + 4, {
        action: { _tag: 'Dazed', remainingMs: 700, durationMs: 1000 },
      }),
    )
  }
  const crawler = config.crawler
  if (crawler === 'surfacing') {
    staged.push(
      stagedZombie(1770, 'Crawler', config.wx, config.wy, {
        action: {
          _tag: 'Burrowed',
          remainingMs: config.surfMs,
          durationMs: 1500,
        },
      }),
      stagedZombie(1771, 'Crawler', 230, 50, {
        action: { _tag: 'Burrowed', remainingMs: 1100, durationMs: 1500 },
      }),
    )
  }
  if (crawler === 'cling') {
    staged.push(
      stagedZombie(1780, 'Crawler', px, py + 2, {
        action: { _tag: 'Clinging', remainingMs: 800 },
      }),
      stagedZombie(1781, 'Crawler', px + 40, py + 20),
    )
  }
  if (staged.length > 0) {
    model = modifyFields(model, {
      zombies: zombies => [...zombies, ...staged],
      nextEntityId: () => 3000,
    })
  }
  const sampleStats = {
    kills: {
      Shambler: 41,
      Runner: 17,
      Tank: 2,
      Exploder: 9,
      Thrower: 2,
      Crawler: 3,
      Boss: 0,
    },
    wavesCleared: Math.max(0, wave - 1),
    shotsFired: 1240,
    shotsHit: 532,
    heartsLost: 7,
    trapsPlaced: 3,
    runMs: 371_000,
  }
  if (config.stats) {
    model = modifyFields(model, {
      stats: s => ({ ...s, ...sampleStats }),
      wallet: w => ({ ...w, earned: 615 }),
    })
  }
  if (config.py !== undefined) {
    model = modifyFields(model, {
      player: p => ({ ...p, x: config.px ?? p.x, y: py }),
      hintBand: () => (py < 70 ? 'Bottom' : 'Top'),
    })
  }
  const { best, pistol, aim, card } = config
  if (best !== undefined) {
    model = withBests(model, bests => ({
      ...bests,
      maybeBestEndlessWave: Option.some(best),
    }))
  }
  if (pistol !== undefined) {
    model = modifyFields(model, {
      player: p => ({
        ...p,
        arsenal: mapGuns(p.arsenal, held =>
          held.kind === 'Pistol' ? { ...held, tier: pistol } : held,
        ),
      }),
    })
  }
  if (aim !== undefined) {
    const [aimX, aimY] = aim
    model = modifyFields(model, {
      input: input => ({
        ...input,
        mouseButton: MouseButton.Held({ pointerId: 1 }),
        maybeMouseInView: Option.some({ x: aimX, y: aimY }),
      }),
    })
  }
  // NOTE: `stick=dx,dy` holds the trigger aimed that way from the player:
  // on touch with the aim stick, thumbed down at the lower right, and with
  // a keyboard and mouse with the mouse button over that spot.
  const stick = config.stick
  if (stick !== undefined) {
    const [dx, dy] = stick
    const originX = Math.round(window.innerWidth * 0.8)
    const originY = Math.round(window.innerHeight * 0.72)
    const aimed = { x: model.player.x + dx, y: model.player.y + dy }
    model = modifyFields(model, {
      input: input =>
        config.device === 'touch'
          ? {
              ...input,
              aimStick: Stick.Active({
                pointerId: 2,
                originX,
                originY,
                currentX: originX + dx,
                currentY: originY + dy,
              }),
            }
          : {
              ...input,
              mouseButton: MouseButton.Held({ pointerId: 1 }),
              maybeMouseInView: Option.some(
                worldToView(cameraOf(model), aimed),
              ),
            },
    })
  }
  if (config.device === 'touch') {
    model = modifyFields(model, { lastDevice: () => 'Touch' as const })
  }
  const seen = config.seen
  if (seen !== undefined) {
    model = raiseDebutCard(
      modifyFields(model, {
        introducedKinds: () => (seen === 'all' ? ZOMBIE_KIND_ORDER : seen),
      }),
    )
  }
  const debutCard = model.debutCard
  if (card !== undefined && debutCard._tag === 'Showing') {
    model = modifyFields(model, {
      debutCard: () => ({ ...debutCard, ageMs: card }),
    })
  }
  const PICKUP_KINDS: ReadonlyArray<PickupKind> = [
    'RapidFire',
    'Damage',
    'Speed',
    'Pierce',
    'Burp',
    'Heart',
  ]
  const kindsOf = (
    picked: 'all' | ReadonlyArray<PickupKind> | undefined,
  ): ReadonlyArray<PickupKind> =>
    picked === undefined ? [] : picked === 'all' ? PICKUP_KINDS : picked
  const pickupKinds = kindsOf(config.pickups)
  if (pickupKinds.length > 0) {
    const pickupY = config.pickupY
    model = modifyFields(model, {
      pickups: () =>
        pickupKinds.map((kind, index) => ({
          id: 3000 + index,
          kind,
          x: Math.round(160 + (index - (pickupKinds.length - 1) / 2) * 26),
          y: pickupY,
          ageMs: config.pickupAge + index * 170,
        })),
    })
  }
  const seenPowerUps = kindsOf(config.seenpowerups)
  if (seenPowerUps.length > 0) {
    model = modifyFields(model, { seenPowerUps: () => seenPowerUps })
  }
  const boostKinds = kindsOf(config.boosts).filter(
    kind => kind !== 'Burp' && kind !== 'Heart',
  )
  if (boostKinds.length > 0) {
    const boostMs = config.boostMs
    model = modifyFields(model, {
      boosts: boosts => {
        const next: { -readonly [Kind in keyof Boosts]: Boosts[Kind] } = {
          ...boosts,
        }
        boostKinds.forEach((kind, index) => {
          next[kind] = {
            _tag: 'On',
            remainingMs: Math.max(1, boostMs - index * 2200),
            durationMs: 8000,
          }
        })
        return next
      },
    })
  }
  const calloutKind = config.callout
  if (calloutKind !== undefined) {
    model = modifyFields(model, {
      callouts: () => [
        {
          kind: calloutKind,
          look: config.calloutLook ?? 'Explained',
          x: model.player.x,
          y: model.player.y,
          ageMs: config.calloutAge,
        },
      ],
    })
  }
  if (config.bounty) {
    model = modifyFields(model, {
      popups: () => [
        {
          kind: 'Kill' as const,
          value: 3,
          x: 90,
          y: 80,
          velocityX: 0,
          ageMs: 50,
        },
        {
          kind: 'Kill' as const,
          value: 20,
          x: 150,
          y: 80,
          velocityX: 0,
          ageMs: 400,
        },
        {
          kind: 'Payday' as const,
          value: 35,
          x: 225,
          y: 80,
          velocityX: 0,
          ageMs: 600,
        },
      ],
    })
  }
  const { party } = config
  const PARTY_KILLS: ReadonlyArray<number> = [31, 47, 12, 8]
  if (party !== undefined) {
    model = withWorld(model, world =>
      Array.reduce(
        Array.range(0, party - 1),
        seatCrew(world, party),
        (seated, slot) => creditKills(seated, slot, PARTY_KILLS[slot] ?? 0),
      ),
    )
  }
  const phase = config.phase
  const beforeEnd = model
  if (phase === 'victory') {
    model = modifyFields(model, {
      phase: () => Phase.Victory(),
      stats: s => ({
        ...s,
        wavesCleared: 8,
        kills: { ...s.kills, Shambler: s.kills.Shambler + 432 },
      }),
    })
  }
  if (phase === 'paused') {
    model = pause(model)
  }
  if (phase === 'gameover') {
    model = modifyFields(model, {
      phase: () => Phase.GameOver({ wave }),
      stats: s => ({
        ...s,
        kills: { ...s.kills, Shambler: s.kills.Shambler + 123 },
      }),
    })
  }
  // NOTE: a staged end screen breaks the records the run would have, so
  // `best` below the wave shows its NEW BEST.
  return noteRecords(beforeEnd, model)
}

// NOTE: co-op staged at one screen, with a fake network that never
// answers, so the screen holds still for a screenshot.
const coopRoom = (
  members: ReadonlyArray<ReturnType<typeof memberOf>>,
  status: 'Lobby' | 'Playing',
  extra: Partial<CoopModel.Room> = {},
): CoopModel.Room => {
  const world = stagedWorld(members.map(member => member.slot))
  return {
    code: COOP_CODE,
    slot: 0,
    maybePlayerId: Option.some('player-0'),
    maybeLobby: Option.some(lobbyOf(members, status)),
    link: 'Online',
    session: {
      ...(status === 'Playing'
        ? playingSession(world, 0)
        : Session.makeSession(0)),
      rttMs: COOP_PINGS[0] ?? 0,
      rtts: members.map(member => ({
        slot: member.slot,
        rttMs: COOP_PINGS[member.slot] ?? 0,
      })),
    },
    maybeWorld: status === 'Playing' ? Option.some(world) : Option.none(),
    frameEvents: [],
    eventsTick: 0,
    predictedShots: 0,
    tracers: [],
    tracerCount: 0,
    hits: { looked: 0, confirmed: 0 },
    presses: CoopModel.noPresses,
    share: 'Idle',
    departure: 'Staying',
    ...extra,
  }
}

const COOP_NAMES = ['Tanner', 'Mo', 'Pip', 'Grumbles']

// NOTE: the looks the staged teammates sent with their joins; the first
// seat is the page's own player, who wears the page's own look.
// NOTE: each staged player's round trip: good, fair, poor, good.
const COOP_PINGS = [48, 140, 260, 90]

const COOP_LOOKS = [
  '',
  'Male.Curls.Blonde.Deep.Red',
  'Female.Long.Black.Fair.Yellow',
  'Male.Crop.Pink.Medium.Purple',
]

const coopScreen = (stage: NonNullable<typeof config.coop>) => {
  const Screen = CoopModel.Screen
  const queue = (
    waiting: number,
    offer: number,
    answer: CoopModel.OfferAnswer,
  ) =>
    Screen.Queue({
      queue: {
        names: COOP_NAMES.slice(0, waiting),
        waiting,
        position: 1,
        groupSize: 4,
        offerPlayers: offer,
        accepted: answer === 'Accepted' ? 2 : 1,
        answer,
      },
    })
  const members = (count: number, readyCount = 0) =>
    COOP_NAMES.slice(0, count).map((name, slot) =>
      modifyFields(
        memberOf(slot, name, slot < readyCount, COOP_LOOKS[slot] ?? ''),
        { pingMs: () => COOP_PINGS[slot] ?? 0 },
      ),
    )
  switch (stage) {
    case 'tile':
      return Screen.Closed()
    case 'hub':
      return Screen.Hub({ maybeProblem: Option.none() })
    case 'problem':
      return Screen.Hub({ maybeProblem: Option.some('Full') })
    case 'code':
      return Screen.Code({ typed: 'MN', maybeProblem: Option.none() })
    case 'asking':
      return Screen.Asking({ request: { _tag: 'Create' } })
    case 'queue':
      return queue(2, 0, 'Unanswered')
    case 'offer':
      return queue(3, 3, 'Unanswered')
    case 'accepted':
      return queue(3, 3, 'Accepted')
    case 'lobby':
      return Screen.InRoom({ room: coopRoom(members(2), 'Lobby') })
    case 'host':
      return Screen.InRoom({ room: coopRoom(members(4, 1), 'Lobby') })
    case 'picks': {
      const room = coopRoom(members(2, 1), 'Lobby')
      return Screen.InRoom({
        room: {
          ...room,
          maybeLobby: Option.map(room.maybeLobby, lobby => ({
            ...lobby,
            mode: 'Endless' as const,
            difficulty: 'Hard' as const,
          })),
        },
      })
    }
    case 'keep': {
      const room = coopRoom(
        members(2).map(member =>
          member.slot === 0
            ? modifyFields(member, { canNightmare: () => true })
            : member,
        ),
        'Lobby',
        {
          slot: 1,
          maybePlayerId: Option.some('player-1'),
        },
      )
      return Screen.InRoom({
        room: {
          ...room,
          maybeLobby: Option.map(room.maybeLobby, lobby => ({
            ...lobby,
            mode: 'KeepGoing' as const,
            canKeepGoing: true,
            difficulty: 'Nightmare' as const,
          })),
        },
      })
    }
    case 'ready':
      return Screen.InRoom({
        room: coopRoom(
          members(3, 3).map((member, slot) =>
            slot === 2 ? modifyFields(member, { ready: () => false }) : member,
          ),
          'Lobby',
        ),
      })
    case 'result': {
      const room = coopRoom(members(3), 'Lobby')
      return Screen.InRoom({
        room: {
          ...room,
          maybeLobby: Option.map(room.maybeLobby, lobby => ({
            ...lobby,
            result: Option.some({
              round: 1,
              reason: 'GameOver' as const,
              ticks: 10800,
              scores: members(3).map((member, slot) => ({
                playerId: member.playerId,
                slot,
                score: [7, 12, 3][slot] ?? 0,
              })),
            }),
          })),
        },
      })
    }
    case 'arena':
      return Screen.InRoom({ room: coopRoom(members(3), 'Playing') })
    case 'away':
      return Screen.InRoom({
        room: coopRoom(members(3), 'Playing', { link: 'Reconnecting' }),
      })
    case 'ended': {
      const room = coopRoom(members(3), 'Playing')
      return Screen.InRoom({
        room: {
          ...room,
          session: {
            ...room.session,
            phase: { _tag: 'Ended', reason: 'GameOver' },
          },
        },
      })
    }
  }
}

// NOTE: a staged run draws its room's World as the game, one frame of it,
// as an online run does (src/coopPlay.ts).
const withCoop = (model: Model): Model => {
  const stage = config.coop
  if (stage === undefined) {
    return model
  }
  const staged = modifyFields(model, {
    lessons: lessons => ({
      ...lessons,
      openBreak: Lesson.Learned({ atMs: 0 }),
    }),
    coop: coop => ({ ...coop, screen: coopScreen(stage) }),
  })
  return update(staged, Message.TickedRoomFrame({ nowMs: 0 })).model
}

const scenarioModel = (): Model => withCoop(scenarioModelOf())

const scenarioModelOf = (): Model => {
  let model = roomModel()
  const runs = config.runs
  if (runs !== undefined) {
    model = modifyFields(model, {
      bests: bests => ({ ...bests, runsPlayed: runs }),
    })
  }
  const learned = config.learned
  if (learned !== undefined) {
    model = modifyFields(model, {
      lessons: lessons => ({
        ...lessons,
        ...Object.fromEntries(
          learned.map(name => [name, Lesson.Learned({ atMs: 0 })]),
        ),
      }),
    })
  }
  const traphint = config.traphint
  if (traphint !== undefined) {
    model = modifyFields(model, {
      trapHint: () => TrapHint.Showing(),
      selectedTrap: () => traphint,
    })
  }
  const quest = config.quest
  if (quest !== undefined) {
    model =
      quest === 'kitchendone'
        ? modifyFields(model, { kitchenTour: () => Tour.Done({ ageMs: 0 }) })
        : modifyFields(model, {
            firstBreakQuest: () =>
              quest === 'done' ? Tour.Done({ ageMs: 0 }) : Tour.Running(),
          })
  }
  const newer = config.newer
  if (newer !== undefined) {
    model = modifyFields(model, {
      maybeNewerBuild: () => Option.some(newer || 'next'),
    })
  }
  if (config.unwrap) {
    model = modifyFields(model, { updateGift: () => 'Unwrapping' })
  }
  if (config.install) {
    model = modifyFields(model, { installOffer: () => 'Ready' })
  }
  if (config.support) {
    model = modifyFields(model, {
      maybeSupportUrl: () => Option.some('https://buy.stripe.com/test_harness'),
    })
  }
  if (config.bests) {
    model = modifyFields(
      withBests(model, current => ({
        ...current,
        maybeBestEndlessWave: Option.some(12),
        maybeFastestWinMs: Option.some(402_000),
      })),
      { bests: bests => ({ ...bests, totalKills: 341 }) },
    )
  }
  const kills = config.kills
  if (kills !== undefined) {
    const counts = Object.fromEntries(kills)
    model = modifyFields(model, {
      bests: bests => {
        const killsByKind = { ...bests.killsByKind, ...counts }
        return {
          ...bests,
          killsByKind,
          totalKills: Object.values(killsByKind).reduce(
            (sum, count) => sum + count,
            0,
          ),
        }
      },
    })
  }
  model = modifyFields(model, {
    home: home => ({
      ...home,
      mode: config.homemode === 'endless' ? 'Endless' : home.mode,
      maybeSeenNewsDay: config.newsseen
        ? Option.some('October 29, 2026')
        : home.maybeSeenNewsDay,
      openedEntries: config.opened ?? home.openedEntries,
      newEntries: config.newentries ?? home.newEntries,
    }),
  })
  model = modifyFields(model, {
    difficultyCard: () =>
      config.ask ? DifficultyCard.Unseen() : DifficultyCard.Seen(),
    difficulty: setting => ({
      chosen: config.difficulty ?? setting.chosen,
      nightmare: config.nightmare ?? setting.nightmare,
    }),
  })
  const ovenState = config.ovens
  if (ovenState !== undefined) {
    model = modifyFields(model, {
      ovens: ovens =>
        ovens.map(() =>
          ovenState === 'belch'
            ? Oven.Belching({ remainingMs: config.ovenMs, burnedTicks: 4 })
            : Oven.Cooling({ remainingMs: config.ovenMs }),
        ),
    })
  }
  if (config.slip) {
    model = modifyFields(model, {
      zombies: zombies => [
        ...zombies,
        ...[
          { x: 152, y: -62 },
          { x: 47, y: -92 },
          { x: 65, y: -32 },
        ].map((at, index) => ({
          id: 9300 + index,
          kind: 'Shambler' as const,
          x: at.x,
          y: at.y,
          speed: 20,
          hp: 3,
          maxHp: 3,
          knockback: { x: 0, y: 0 },
          hitRemainingMs: 0,
          state: { _tag: 'Walking' as const },
          action: { _tag: 'Dazed' as const, remainingMs: 800, durationMs: 900 },
          frenzy: CALM,
        })),
      ],
    })
  }
  model = withLeftovers(model)
  const planks = config.planks
  if (planks !== undefined) {
    model = modifyFields(model, {
      traps: traps => [
        ...traps,
        ...planks.map((door, index) =>
          Trap.Barricade({
            id: 9000 + index,
            door,
            hp: config.plankhp,
            hitRemainingMs: 0,
          }),
        ),
      ],
    })
  }
  const chewers = config.chewers
  if (chewers > 0) {
    const spots = [
      { x: 16, y: 84 },
      { x: 16, y: 96 },
      { x: 30, y: 88 },
      { x: 34, y: 100 },
      { x: 44, y: 80 },
    ]
    model = modifyFields(model, {
      zombies: zombies => [
        ...zombies,
        ...spots.slice(0, chewers).map((at, index) => ({
          id: 9100 + index,
          kind: index === 4 ? ('Tank' as const) : ('Shambler' as const),
          x: at.x,
          y: at.y,
          speed: 18,
          hp: index === 4 ? 30 : 3,
          maxHp: index === 4 ? 30 : 3,
          knockback: { x: 0, y: 0 },
          hitRemainingMs: 0,
          state: { _tag: 'Walking' as const },
          action: ROAMING,
          frenzy: CALM,
        })),
      ],
    })
  }
  // NOTE: zombies mid-entry at every door, hurt so their bars show: two in
  // the north doorway behind the lintel, one just inside the north wall, and
  // one in each other doorway, and one in the kitchen's doorway when it is
  // open.
  if (config.doorway) {
    const spots: ReadonlyArray<
      readonly ['Shambler' | 'Runner' | 'Tank', number, number]
    > = [
      ['Tank', 216, 6],
      ['Runner', 226, -2],
      ['Shambler', 200, 22],
      ['Tank', 240, 26],
      ['Shambler', 90, 172],
      ['Shambler', 5, 88],
      ['Runner', 315, 92],
      ...(config.openexits?.includes('Kitchen') === true
        ? ([['Shambler', 70, 8]] as const)
        : []),
    ]
    model = modifyFields(model, {
      zombies: zombies => [
        ...zombies,
        ...spots.map(([kind, x, y], index) => ({
          id: 9200 + index,
          kind,
          x,
          y,
          speed: 0,
          hp: kind === 'Tank' ? 10 : 1,
          maxHp: kind === 'Tank' ? 30 : 3,
          knockback: { x: 0, y: 0 },
          hitRemainingMs: 0,
          state: { _tag: 'Walking' as const },
          action: ROAMING,
          frenzy: CALM,
        })),
      ],
    })
  }
  const openexits = config.openexits
  if (openexits !== undefined) {
    model = modifyFields(model, {
      level: level => ({ ...level, openExits: openexits }),
    })
  }
  const name = config.name
  if (name !== undefined) {
    model = modifyFields(model, { playerName: () => name })
  }
  const sync = config.sync
  if (sync !== undefined) {
    const devices = config.devices
    model = modifyFields(model, {
      syncState: () =>
        sync === 'local'
          ? SyncState.LocalOnly()
          : sync === 'connecting'
            ? SyncState.Connecting()
            : sync === 'offline'
              ? SyncState.Offline({ devices })
              : SyncState.Synced({ devices }),
      playerScopeStatus: () =>
        sync === 'broken'
          ? PlayerScopeStatus.Failed({ reason: 'harness' })
          : PlayerScopeStatus.Ready({ seq: 1, fresh: sync === 'synced' }),
    })
  }
  const link = config.link
  if (link !== undefined) {
    model = modifyFields(model, {
      linkFlow: () =>
        link === 'requesting'
          ? LinkFlow.Requesting()
          : link === 'showing'
            ? LinkFlow.Showing({ code: 'KZ7QWM' })
            : link === 'entering'
              ? LinkFlow.Entering({ code: 'KZ7' })
              : link === 'redeeming'
                ? LinkFlow.Redeeming({ code: 'KZ7QWM' })
                : link === 'linked'
                  ? LinkFlow.Linked()
                  : LinkFlow.Failed({ problem: 'WrongCode' }),
    })
  }
  const look = config.look
  if (look !== undefined) {
    const [
      body,
      hairStyle,
      hairColor,
      skinTone,
      shirtColor,
      outfit,
      print,
      beard,
      glasses,
    ] = look
    model = modifyFields(model, {
      appearance: a => ({
        body: body || a.body,
        hairStyle: hairStyle || a.hairStyle,
        hairColor: hairColor || a.hairColor,
        skinTone: skinTone || a.skinTone,
        shirtColor: shirtColor || a.shirtColor,
        outfit: outfit || a.outfit,
        print: print || a.print,
        beard: beard === 'Beard' || a.beard,
        glasses: glasses === 'Glasses' || a.glasses,
      }),
    })
  }
  return model
}

// NOTE: `gasroom=N` keeps N Kaboomers in the room: when shots and chain bursts
// pop them, new ones walk in at the doors, so a measurement window stays full
// of fusing, bursting, and spawning Kaboomers.
const GASBAG_DOORS: ReadonlyArray<readonly [number, number]> = [
  [160, 8],
  [312, 90],
  [160, 172],
  [8, 90],
]
const topUpGasbags = (model: Model): Model => {
  const alive = model.zombies.filter(
    z => z.kind === 'Exploder' && z.state._tag === 'Walking',
  ).length
  const missing = Math.max(0, Math.min(4, gasbagRoom - alive))
  if (missing === 0 || model.phase._tag !== 'Wave') {
    return model
  }
  const fresh = globalThis.Array.from({ length: missing }, (_, i): Zombie => {
    const [x, y] = GASBAG_DOORS[
      (model.nextEntityId + i) % GASBAG_DOORS.length
    ] ?? [0, 0]
    return {
      id: model.nextEntityId + i,
      kind: 'Exploder',
      x,
      y,
      speed: 22,
      hp: 3,
      maxHp: 3,
      knockback: { x: 0, y: 0 },
      hitRemainingMs: 0,
      state: { _tag: 'Walking' },
      action: ROAMING,
      frenzy: CALM,
    }
  })
  return modifyFields(model, {
    zombies: zombies => [...zombies, ...fresh],
    nextEntityId: id => id + missing,
  })
}
window.__shapeCounts = []

const countShapes = (shapes: ReadonlyArray<Canvas.Shape>): number =>
  shapes.reduce(
    (n, s) => n + 1 + (s._tag === 'Group' ? countShapes(s.shapes) : 0),
    0,
  )
window.__countShapes = () => countShapes(sceneShapes(window.__model))

window.__timings = { update: [], view: [] }
const FIXED_FRAME_MS = 1000 / 60
let framesRun = 0
const QUIET_MESSAGES = new Set([
  'TickedFrame',
  'MovedPointer',
  'MovedMouse',
  'CompletedPlaySound',
  'CompletedCueMusic',
  'FailedCueMusic',
  'FailedPlaySound',
])
window.__messages = []

type HarnessReturn = Director.Return

// NOTE: what the harness adds after every update: full health with `god`,
// and fresh Kaboomers at the doors with `gasroom`.
const keepScene = (result: HarnessReturn, message: Message): HarnessReturn => {
  const kept = god
    ? {
        ...result,
        model: modifyFields(result.model, {
          player: p => ({ ...p, hp: PLAYER_MAX_HP }),
        }),
      }
    : result
  return gasbagRoom > 0 && message._tag === 'TickedFrame'
    ? { ...kept, model: topUpGasbags(kept.model) }
    : kept
}

// NOTE: `tick=N` plays N frames of a fixed 1/60 second at once, before the
// first render, and holds the picture there. The game is deterministic, so
// this is the picture `freeze=N` waits N real frames for, with no waiting.
// The Commands those frames give, such as opening the shop's dialog, run
// once the scene is in, as they would have frame by frame.
const advance = (scene: HarnessReturn, frames: number): HarnessReturn => {
  let current = scene.model
  const commands = [...(scene.commands ?? [])]
  for (let frame = 0; frame < frames; frame++) {
    const message = Message.TickedFrame({ deltaTime: FIXED_FRAME_MS })
    const next = keepScene(update(current, message), message)
    current = next.model
    commands.push(...(next.commands ?? []))
  }
  return { model: current, commands }
}

// NOTE: every Message the runtime dispatches, its children's envelopes
// included, as `Tag:ChildTag` chains, for the tap and close audits. The
// runtime reports each update through its `slow` hook, with a budget no
// update can beat.
const logMessage = (incoming: unknown) => {
  const chain = (message: unknown): Array<string> =>
    typeof message === 'object' &&
    message !== null &&
    '_tag' in message &&
    typeof message._tag === 'string'
      ? [message._tag, ...('message' in message ? chain(message.message) : [])]
      : []
  const tags = chain(incoming)
  if (tags[0] !== undefined && !QUIET_MESSAGES.has(tags[0])) {
    window.__messages.push(tags.join(':'))
  }
}

const gameUpdate = (model: Model, incoming: Message): HarnessReturn => {
  const isFrozenFrame =
    incoming._tag === 'TickedFrame' && framesRun >= freezeAfter
  const isFreezing = Number.isFinite(freezeAfter)
  if (isFrozenFrame) {
    return { model }
  }
  // NOTE: a director shot steps the co-op room itself, on the shot's clock.
  if (config.director && incoming._tag === 'TickedRoomFrame') {
    return { model }
  }
  if (isFreezing && incoming._tag === 'CompletedGenerateSeed') {
    return { model }
  }
  // NOTE: a frozen run starts counting frames once the surface is measured,
  // so how long the first render takes cannot change which frame the
  // measurement lands on, and two builds freeze on the same picture.
  if (
    isFreezing &&
    incoming._tag === 'TickedFrame' &&
    Option.isNone(model.maybeSurface)
  ) {
    return { model }
  }
  if (
    config.fit !== undefined &&
    incoming._tag === 'CompletedDetectScreenFit'
  ) {
    return {
      model: modifyFields(model, {
        screenFit: () => (config.fit === 'home' ? 'HomeScreen' : 'Fullscreen'),
      }),
    }
  }
  if (
    config.sync !== undefined &&
    (incoming._tag === 'UpdatedSyncStatus' ||
      incoming._tag === 'UpdatedPlayerScopeStatus')
  ) {
    return { model }
  }
  if (config.rotate && incoming._tag === 'CompletedDetectOrientationLock') {
    return {
      model: modifyFields(model, { orientationLock: () => 'Supported' }),
    }
  }
  // NOTE: `install` keeps Chrome's offer on, and `greet` reads as the page
  // just reloaded onto this build. The gift never reloads the harness: it
  // stays mid-unwrap, as `unwrap` shows it.
  if (config.install && incoming._tag === 'ChangedInstallOffer') {
    return { model }
  }
  if (incoming._tag === 'CompletedWaitForUnwrap') {
    return { model }
  }
  const message =
    incoming._tag === 'TickedFrame' && isFreezing
      ? Message.TickedFrame({ deltaTime: FIXED_FRAME_MS })
      : config.greet && incoming._tag === 'CompletedReadUpdateMarker'
        ? Message.CompletedReadUpdateMarker({
            maybeBuild: Option.some(RUNNING_BUILD),
          })
        : incoming
  if (message._tag === 'TickedFrame') {
    framesRun++
  }
  window.__isFrozen = framesRun >= freezeAfter
  const t0 = performance.now()
  const result = update(model, message)
  if (instrument && message._tag === 'TickedFrame') {
    window.__timings.update.push(performance.now() - t0)
  }
  const next = keepScene(result, message)
  window.__model = next.model
  return next
}

// NOTE: the Profile open on a tab, as openProfile (src/update/profile.ts)
// opens it, without its menu check: the tab and the name draft, the input
// let go, then the Dialog's own open through its Binding.
const openProfileOn = (model: Model, tab: ProfileTab): HarnessReturn =>
  update(
    withInput(
      modifyFields(model, {
        tutorialReset: () => 'Idle',
        profile: profile =>
          modifyFields(profile, {
            tab: () => tab,
            fx: () => 'Still',
            nameDraft: () => model.playerName,
          }),
      }),
      releaseAll,
    ),
    toParentMessage(ProfileDialogBinding, DialogBlock.Message.RequestedOpen()),
  )

// NOTE: the scene's Model from the current config: seeded when it is frozen
// or given a seed, with the Profile opened by `picker` or `profile`, and played
// `tick` frames ahead.
const sceneOf = (model: Model): HarnessReturn => {
  const seeded =
    config.seed !== undefined || Number.isFinite(freezeAfter)
      ? modifyFields(model, { rngState: () => config.seed ?? 1 })
      : model
  const profileTab = config.profile
  const opened: HarnessReturn = stepWhen(
    (_: Model) => config.picker || profileTab !== undefined,
    current =>
      openProfileOn(
        modifyFields(current, { screenMs: () => 99999 }),
        profileTab === 'name'
          ? 'Name'
          : profileTab === 'account'
            ? 'Account'
            : profileTab === 'settings'
              ? 'Settings'
              : 'Look',
      ),
  )(seeded)
  const lookSection = config.looksection
  const sectioned: HarnessReturn =
    lookSection === undefined
      ? opened
      : {
          ...opened,
          model: modifyFields(opened.model, {
            character: picker =>
              modifyFields(picker, { section: () => lookSection }),
          }),
        }
  const holding: HarnessReturn = config.hold
    ? {
        ...sectioned,
        model: modifyFields(sectioned.model, {
          input: input =>
            sectioned.model.lastDevice === 'Touch'
              ? pressHoldButton(input, HOLD_POINTER_ID)
              : pressKey(input, 'Enter'),
        }),
      }
    : sectioned
  const panned: HarnessReturn = config.pan
    ? {
        ...holding,
        model: modifyFields(holding.model, {
          player: player =>
            modifyFields(player, {
              melee: () =>
                Melee.Pan({ pan: { ...freshGun('Pan'), tier: config.tier } }),
            }),
        }),
      }
    : holding
  const knifed: HarnessReturn =
    config.knife || config.stab
      ? {
          ...panned,
          model: modifyFields(panned.model, {
            player: player => modifyFields(player, { wield: () => 'Melee' }),
          }),
        }
      : panned
  const held: HarnessReturn = config.stab
    ? {
        ...knifed,
        model: modifyFields(knifed.model, {
          input: input =>
            modifyFields(input, {
              mouseButton: () =>
                MouseButton.Held({ pointerId: STAB_POINTER_ID }),
            }),
        }),
      }
    : knifed
  const dried: HarnessReturn = config.dry
    ? {
        ...held,
        model: modifyFields(held.model, {
          player: player =>
            modifyFields(player, {
              arsenal: arsenal =>
                mapGuns(arsenal, gun =>
                  modifyFields(gun, { rounds: () => 0, loaded: () => 0 }),
                ),
            }),
        }),
      }
    : held
  return config.tick === undefined ? dried : advance(dried, config.tick)
}

// THE READY SIGNAL

// NOTE: `window.__harnessReady` (and `data-harness-ready` on the root
// element, with the scene's number) is set once the scene has rendered with
// every image decoded, once the boot has read the save (a save read later
// could change the scene), and, with `freeze`, once the frozen frame is
// reached.
// Scripts wait for it instead of sleeping. Loading another scene clears it.
let sceneNumber = 0
const clearReady = () => {
  window.__harnessReady = false
  delete document.documentElement.dataset['harnessReady']
}
const markReadyWhenSettled = (number: number) => {
  clearReady()
  void settle(
    () =>
      window.__model.saveStatus !== 'Unread' &&
      (!Number.isFinite(freezeAfter) || framesRun >= freezeAfter),
  ).then(() => {
    if (number === sceneNumber) {
      window.__harnessReady = true
      document.documentElement.dataset['harnessReady'] = String(number)
    }
  })
}

// SCENE SWITCHING

const decodeScene = (query: string): HarnessConfig | undefined => {
  try {
    return decodeHarnessConfig(query)
  } catch (error) {
    window.__sceneError = String(error)
    return undefined
  }
}

// NOTE: a fresh page's boot, minus what a page does once. The Model comes
// from the query as in init. The surface's measurement carries over, since
// the page and its size are the same. The save counts as read and empty, as
// in a fresh browser context, whatever earlier scenes wrote to storage, so
// init's Commands run again without LoadSave: the seed and the device,
// screen fit, and orientation lock checks. The load steps they finish are
// already done.
const nextSceneOf = (model: Model): HarnessReturn => {
  const scene = sceneOf(
    modifyFields(scenarioModel(), {
      maybeSurface: () => model.maybeSurface,
      orientation: () => model.orientation,
      saveStatus: () => 'Read' as const,
    }),
  )
  return {
    model: scene.model,
    commands: [
      ...(init().commands ?? []).filter(
        command => command.name !== LoadSave.name,
      ),
      ...(scene.commands ?? []),
    ],
  }
}

// NOTE: an open dialog holds page state outside the Model: the inert,
// hidden background, the focus trap, and the scroll lock. A dialog closed by
// swapping the Model never runs its CloseDialog Command, so this releases
// what every dialog holds, as that Command does, before the next scene.
const releaseDialogs = Effect.suspend(() =>
  Effect.forEach(
    globalThis.Array.from(document.querySelectorAll('dialog[id]')),
    dialog =>
      Dom.releaseDialogResources(dialog.id).pipe(
        Effect.flatMap(isReleased =>
          isReleased ? Dom.unlockScroll : Effect.void,
        ),
      ),
    { discard: true },
  ),
)

// NOTE: the first scene boots as a page does; each later one boots from the
// Model the last scene left (see nextSceneOf).
let maybeCarriedModel: Option.Option<Model> = Option.none()

// NOTE: a scene's Commands come from the game's update, so a Message one
// gives back may be a child's envelope (the Profile dialog's open, from
// `profile`). Foldkit types an init's Commands with the root's own Messages
// only, since child Messages come through Binding Steps there; the runtime
// routes an envelope from an init Command as it does one from update. A
// typed harness init needs a Foldkit hook for a Composition's init that
// takes update's Commands.
type InitCommand = Command.Command<
  Message,
  never,
  Effect.Services<Director.GameCommand['effect']>
>
const asInitCommands = (
  commands: ReadonlyArray<Director.GameCommand>,
): ReadonlyArray<InitCommand> =>
  // oxlint-disable-next-line typescript/consistent-type-assertions
  commands as ReadonlyArray<InitCommand>

const harnessInit = ApplicationComposition.makeInit(() => {
  const scene = Option.match(maybeCarriedModel, {
    onNone: () => {
      const base = init()
      const first = sceneOf(scenarioModel())
      return {
        model: first.model,
        commands: [...(base.commands ?? []), ...(first.commands ?? [])],
      }
    },
    onSome: nextSceneOf,
  })
  window.__isFrozen = framesRun >= freezeAfter
  window.__model = scene.model
  markReadyWhenSettled(sceneNumber)
  return { model: scene.model, commands: asInitCommands(scene.commands ?? []) }
})

// THE DIRECTOR

// NOTE: a director step is the game's own update, with what the scene adds.
const directorStep = (model: Model, message: Message): HarnessReturn =>
  keepScene(update(model, message), message)

const directed = (result: HarnessReturn): HarnessReturn => {
  window.__model = result.model
  window.__directedTick = Director.currentTick()
  return result
}

type DirectorRequest =
  | Readonly<{ _tag: 'Start'; plan: string }>
  | Readonly<{ _tag: 'Step'; ticks: number }>

// NOTE: the video tool's requests, waiting for the runtime to carry them in.
// The harness has no Message of its own (the root is the game's Block), so
// a request rides on the page-restore Subscription: the page raises a
// `pageshow` from the cache, and the RestoredPageFromCache it becomes runs
// the waiting requests in place of the build check it would start.
const directorRequests: Array<DirectorRequest> = []

const raiseDirectorRequest = (request: DirectorRequest) => {
  directorRequests.push(request)
  window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
}

const runDirectorRequests = (model: Model): HarnessReturn => {
  const requests = directorRequests.splice(0)
  return requests.reduce<HarnessReturn>(
    (current, request) => {
      const next =
        request._tag === 'Start'
          ? Director.startShot(current.model, Director.decodePlan(request.plan))
          : Director.stepShot(current.model, request.ticks, directorStep)
      return directed({
        model: next.model,
        commands: [...(current.commands ?? []), ...(next.commands ?? [])],
      })
    },
    { model },
  )
}

const harnessStep = (model: Model, message: Message): HarnessReturn =>
  message._tag === 'RestoredPageFromCache' && directorRequests.length > 0
    ? runDirectorRequests(model)
    : Director.logBetweenTicks(gameUpdate(model, message))

// NOTE: the video tool's controls (tools/video, with `director` in the
// query). `start` takes the shot's script as JSON, `step(n)` plays n fixed
// ticks; each sets `window.__directedTick` once the Model holds them, and
// `audio()` is the sound and music log so far.
window.__director = {
  start: (plan: string) => {
    window.__directedTick = undefined
    raiseDirectorRequest({ _tag: 'Start', plan })
  },
  step: (ticks: number) => raiseDirectorRequest({ _tag: 'Step', ticks }),
  audio: () => Director.audioLog(),
  seats: () => Director.seatsOnScreen(window.__model),
}

// NOTE: the harness's update is the game's, wrapped for the scene's
// settings (gameUpdate). A Composition's update is authored as one handler
// per local Message, so every tag gets the same wrapper. Child envelopes go
// to their Bindings as in the game.
// NOTE: the union's variant Schemas by tag, which Effect's TaggedUnion keeps
// at runtime as `cases`; Foldkit's MessageUnion type leaves the field out.
const hasCases = (
  union: object,
): union is Readonly<{ cases: Readonly<Record<Message['_tag'], unknown>> }> =>
  'cases' in union && typeof union.cases === 'object' && union.cases !== null
if (!hasCases(Message)) {
  throw new Error('the Message union has no cases')
}
const harnessUpdate = ApplicationComposition.makeUpdate(
  Record.map(Message.cases, () => harnessStep),
)

// NOTE: a director shot's card (cards.ts) on a canvas the screen's size in
// game pixels, over the game. The wrapper has no box of its own, so the
// game's root lays out as it always does.
type ViewHtml = Parameters<
  Parameters<typeof ApplicationComposition.makeView>[0]
>[1]

const withDirectorCard = (
  model: Model,
  document: Document,
  h: ViewHtml,
): Document => {
  const screen = screenOf(model)
  return {
    ...document,
    body: h.div(
      [h.Class('director-stage')],
      [
        document.body,
        ...Option.match(Director.cardNow(), {
          onNone: () => [],
          onSome: ({ card, age }) => [
            Canvas.view(
              {
                width: screen.width,
                height: screen.height,
                shapes: cardShapes(card, screen, age),
                className: 'director-card',
                key: 'director-card',
              },
              h,
            ),
          ],
        }),
      ],
    ),
  }
}

const harnessView = ApplicationComposition.makeView((model, h): Document => {
  if (config.looksheet) {
    return lookSheetView(h)
  }
  const t0 = performance.now()
  const out = view(model, h)
  if (instrument) {
    window.__timings.view.push(performance.now() - t0)
  }
  return config.director ? withDirectorCard(model, out, h) : out
})

const prepareHarness = () =>
  ApplicationComposition.prepareBlock({
    init: harnessInit,
    update: harnessUpdate,
    view: harnessView,
    subscriptions,
    managedResources,
    EffectsLayer,
  })
const HarnessBlock: Block.FromAssemblyWithView<
  typeof Model,
  typeof prepareHarness
> = Block.assemble(prepareHarness)

// NOTE: the services are built once for the page and shared by every
// scene, as one runtime shared them before scenes restarted it: the player
// store keeps one SQLite worker.
const harnessServices = Effect.runSync(
  Effect.flatMap(Scope.make(), scope =>
    Layer.buildWithScope(
      Layer.mergeAll(PlayerStoreLayer, quietCoopNet, quietInstallPrompt),
      scope,
    ),
  ),
)

const startScene = () =>
  Runtime.embed(
    Program.make({
      block: HarnessBlock,
      container: document.getElementById('root'),
      slow: {
        show: 'Always',
        measuredPhases: ['Update'],
        thresholdOverrides: { Update: -1 },
        onSlow: context => {
          if (context._tag === 'Update') {
            logMessage(context.message)
            window.__model = context.nextModel
          }
        },
      },
      ...(config.nodev ? { devTools: false as const } : {}),
    }).provide(Layer.succeedContext(harnessServices)),
  )

let running = startScene()

// NOTE: a disposed runtime puts its empty container back on its own time,
// so the next scene waits for `#root` before it starts.
const containerRestored = async () => {
  for (let frame = 0; frame < 120; frame++) {
    if (document.getElementById('root') !== null) {
      return
    }
    await Effect.runPromise(
      Effect.callback<void>(resume => {
        requestAnimationFrame(() => resume(Effect.void))
      }),
    )
  }
  throw new Error('the harness container did not come back')
}

// NOTE: `window.__loadScene('wave=3&start=wave')` swaps the scene in place:
// the runtime stops, as a page leaving would, and starts again on the new
// scene's Model. It resets what a new page would: open dialogs, focus, full
// screen, and scroll. Wait for the ready signal afterwards. `nodev` belongs
// to the page, not the scene.
window.__loadScene = async (query: string) => {
  const next = decodeScene(query.replace(/^\?/, ''))
  if (next === undefined) {
    return
  }
  clearReady()
  await Effect.runPromise(releaseDialogs)
  if (document.fullscreenElement !== null) {
    await document.exitFullscreen().catch(() => undefined)
  }
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur()
  }
  window.scrollTo(0, 0)
  maybeCarriedModel = Option.some(window.__model)
  running.dispose()
  await containerRestored()
  window.__sceneError = undefined
  useConfig(next)
  framesRun = 0
  window.__messages.length = 0
  window.__timings = { update: [], view: [] }
  sceneNumber++
  running = startScene()
}

const CELL_W = 12
const CELL_H = 16
const SHEET_W = 168
const SHEET_H = 268

// NOTE: the look sheet: one row per part, each option of it on the classic
// look (the bodies three times: in a tee, in a dress, and in overalls with
// the Rainbow print, a beard, and glasses), then walk frames, both facings,
// and the hit flash for four mixed looks.
const lookSheetShapes = (): Array<Canvas.Shape> => {
  const shapes: Array<Canvas.Shape> = [
    Canvas.Rect({
      x: 0,
      y: 0,
      width: SHEET_W,
      height: SHEET_H,
      fill: FLOOR_COLOR,
    }),
  ]
  const draw = (
    appearance: Appearance,
    x: number,
    y: number,
    frames: 'walk' | 'idle',
    frame: number,
    facing: 'Left' | 'Right',
    tone: 'Normal' | 'Flash',
  ) => {
    const sprites = playerSprites(appearance)
    shapes.push(
      Canvas.Rect({
        x: x - 3,
        y: y - 1,
        width: 7,
        height: 2,
        fill: SHADOW_COLOR,
      }),
      group({
        translate: { x, y },
        shapes: frameAt(sprites[frames], frame)[tone][facing],
      }),
      group({
        translate: { x: x + (facing === 'Right' ? 2 : -2), y: y - 5 },
        shapes: gunSprite('Pistol', 0, facing === 'Right' ? 0 : Math.PI),
      }),
    )
  }
  const base = defaultAppearance
  const rows: ReadonlyArray<ReadonlyArray<Appearance>> = [
    BODIES.map(body => modifyFields(base, { body: () => body })),
    BODIES.map(body =>
      modifyFields(base, {
        body: () => body,
        outfit: () => 'Dress',
        hairStyle: () => 'Long',
      }),
    ),
    BODIES.map(body =>
      modifyFields(base, {
        body: () => body,
        outfit: () => 'Overalls',
        print: () => 'Rainbow',
        beard: () => true,
        glasses: () => true,
      }),
    ),
    HAIR_STYLES.map(hairStyle =>
      modifyFields(base, { hairStyle: () => hairStyle }),
    ),
    HAIR_COLORS.map(hairColor =>
      modifyFields(base, {
        hairColor: () => hairColor,
        hairStyle: () => 'Long',
      }),
    ),
    SKIN_TONES.map(skinTone =>
      modifyFields(base, { skinTone: () => skinTone }),
    ),
    SHIRT_COLORS.map(shirtColor =>
      modifyFields(base, { shirtColor: () => shirtColor }),
    ),
    OUTFITS.map(outfit => modifyFields(base, { outfit: () => outfit })),
    PRINTS.map(print => modifyFields(base, { print: () => print })),
    OUTFITS.flatMap(outfit =>
      PRINTS.map(print =>
        modifyFields(base, {
          outfit: () => outfit,
          print: () => print,
          body: () => 'Slim',
        }),
      ),
    ),
    ON_OFF.flatMap(beard =>
      ON_OFF.map(glasses =>
        modifyFields(base, { beard: () => beard, glasses: () => glasses }),
      ),
    ),
  ]
  rows.forEach((row, r) =>
    row.forEach((appearance, c) =>
      draw(
        appearance,
        c * CELL_W + 8,
        r * CELL_H + 15,
        'idle',
        0,
        'Right',
        'Normal',
      ),
    ),
  )
  const samples: Array<Appearance> = [
    {
      ...base,
      body: 'Slim',
      hairStyle: 'Mohawk',
      hairColor: 'Pink',
      skinTone: 'Tan',
      outfit: 'Hoodie',
      print: 'Rainbow',
      glasses: true,
    },
    {
      ...base,
      body: 'Broad',
      hairStyle: 'Curly',
      hairColor: 'Black',
      skinTone: 'Deep',
      outfit: 'Overalls',
      shirtColor: 'Yellow',
      beard: true,
    },
    {
      ...base,
      body: 'Slim',
      hairStyle: 'Long',
      hairColor: 'Blonde',
      skinTone: 'Fair',
      outfit: 'Dress',
      shirtColor: 'Purple',
      print: 'Stripes',
    },
    {
      ...base,
      body: 'Broad',
      hairStyle: 'Bald',
      hairColor: 'Grey',
      skinTone: 'Brown',
      shirtColor: 'Red',
      beard: true,
      glasses: true,
    },
  ]
  samples.forEach((appearance, i) => {
    const y = rows.length * CELL_H + 18 + i * CELL_H
    ;[0, 1, 2, 3].forEach(f =>
      draw(appearance, 8 + f * CELL_W, y, 'walk', f, 'Right', 'Normal'),
    )
    ;[0, 1].forEach(f =>
      draw(appearance, 8 + (4 + f) * CELL_W, y, 'idle', f, 'Right', 'Normal'),
    )
    draw(appearance, 8 + 6 * CELL_W, y, 'walk', 0, 'Left', 'Normal')
    draw(appearance, 8 + 7 * CELL_W, y, 'idle', 0, 'Left', 'Normal')
    draw(appearance, 8 + 8 * CELL_W, y, 'idle', 0, 'Right', 'Flash')
  })
  return shapes
}

const lookSheetView = (h: ViewHtml): Document => ({
  title: 'Looks',
  body: h.div(
    [h.Style({ background: '#000', padding: '8px' })],
    [
      Canvas.view(
        {
          width: SHEET_W,
          height: SHEET_H,
          shapes: lookSheetShapes(),
          className: 'look-sheet',
        },
        h,
      ),
    ],
  ),
})

window.__stall = STALL_BOX
window.__doors = PARLOUR.doors

// NOTE: for scripts after a click or a key: resolves once the page has
// rendered and every image it asked for has decoded.
window.__whenSettled = () => settle(() => true)
