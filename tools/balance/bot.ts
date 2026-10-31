// The balance bot: a fair, simple player that drives the game's own init
// model and update. tools/balance/simulate.ts runs it for the campaign
// reports, and the wave snapshot pass replays single waves from a typical
// run state. Nothing here ships with the game. Install a DOM (happy-dom)
// before importing this module, as simulate.ts and vitest do.
//
// This module plays a run: the frame loop, and what it logs. The bot's
// parts live in tools/balance/bot/, and the run's state they share is one
// BotState (bot/state.ts) made fresh for each run.

import { Option } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { boxCenter, levelOf } from '../../src/arena'
import { Message } from '../../src/message'
import { initialModel } from '../../src/model'
import { isShopOpenFor } from '../../src/shop'
import { asTutorialDone, asVeteran } from '../../src/veteran'
import { heldGun, maybeOtherGun } from '../../src/weapons'
import { SURFACE } from '../determinism/script'
import {
  type BotOptions,
  FRAME_MS,
  type Kind,
  type Model,
  ROOM_CENTER,
  type Vector,
  desiredKeys,
  distance,
  maxRunMs,
  pressKeys,
  send,
  steerToward,
  tapKey,
  walking,
} from './bot/basics'
import { bossOf } from './bot/dodging'
import {
  AIM_EVERY_FRAMES,
  MOVE_EVERY_FRAMES,
  aimAndFire,
  handleKnife,
  holdFire,
  kite,
  nearestVisible,
  topOff,
} from './bot/fighting'
import {
  fightWithFridge,
  panPlan,
  sheathPan,
  swingPan,
} from './bot/fridgeFighting'
import {
  fridgeSpareOf,
  holdToReplace,
  panOf,
  pistolOf,
  spareOf,
  weakerGun,
} from './bot/guns'
import {
  type BossBlame,
  type BossLog,
  PRESSURE_CROWD,
  PRESSURE_PX,
  type RunResult,
  type WaveLog,
  type WaveTimeline,
  emptyBossBlame,
  emptyHurt,
  emptyNewKinds,
  emptyTimeline,
  emptyWaveLog,
  isAnnounced,
  pendingSpawns,
  recordTimeline,
} from './bot/logs'
import { routeTo } from './bot/route'
import {
  AMMO_WINDOW_NEAR_PX,
  KITCHEN_DOOR_PUSH,
  STALL_BELOW,
  STALL_FRONT,
  busiestDoor,
  fridgeKeys,
  fridgeStand,
  gnomeSpot,
  holdingAtKitchen,
  holdingAtWindow,
  isFridgeInReach,
  isKitchenOpen,
  isOfferedToBot,
  offeredWeapon,
  prepPlan,
  replacedBy,
  shop,
  towardWindow,
  wantedPurchase,
  wouldTake,
} from './bot/shopping'
import { GUN_PLAN, freshState } from './bot/state'

// RUN

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
export const startedRun = (seed: number, options: BotOptions): Model => {
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

export const play = (
  start: Model,
  seed: number,
  options: BotOptions,
  stop: Stop,
  onPreparation: OnPreparation = () => {},
): RunResult => {
  const state = freshState(seed, options)
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
      model = shop(state, model)
      if (model.shop._tag !== 'Browsing') {
        shoppedWave = wave
      }
      continue
    }
    if (model.phase._tag === 'Preparation') {
      model = holdFire(model)
      const plan = prepPlan(state, model, shoppedWave === wave)
      if (plan === 'Go') {
        state.gnomeTries = 0
        model = pressKeys(model, new Set())
        const other = Option.getOrUndefined(maybeOtherGun(model.player.arsenal))
        if (
          state.options.swapsBack &&
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
        const item = wantedPurchase(state, model)
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
        state.gnomeTries += 1
        const selected =
          model.selectedTrap === 'Turret' ? model : tapKey(model, 'KeyG')
        const placed = tapKey(selected, 'KeyT')
        state.gnomesPlaced +=
          placed.trapStock.Turret < model.trapStock.Turret ? 1 : 0
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
          state,
          pressKeys(
            model,
            holdingAtWindow(
              model,
              holdingAtKitchen(
                model,
                desiredKeys(towardWindow(model, kite(state, model))),
              ),
            ),
          ),
        )
      }
      if (panOf(model) === undefined) {
        state.panPlanNow = GUN_PLAN
      } else if (frame % AIM_EVERY_FRAMES === 0) {
        state.panPlanNow = panPlan(model)
      }
      const fridgeSpare = fridgeSpareOf(model)
      if (state.panPlanNow.useSpare) {
        model = swingPan(state, model, frame)
      } else if (fridgeSpare === undefined) {
        state.fridgePlan = GUN_PLAN
        model = aimAndFire(state, sheathPan(model), frame)
      } else {
        model = fightWithFridge(state, sheathPan(model), frame, fridgeSpare)
      }
    }
    lastPosition = model.player
    frame += 1
    const before = model
    model = send(model, Message.TickedFrame({ deltaTime: FRAME_MS }))
    if (!isKitchenOpen(before) && isKitchenOpen(model)) {
      state.kitchenWave = wave
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
        state.fridgeLog.pulls += 1
        state.fridgeLog.firstPullWave ||= wave
        state.fridgeLog.prizes[event.prize] =
          (state.fridgeLog.prizes[event.prize] ?? 0) + 1
      }
      if (event._tag === 'LidLaunched') {
        state.fridgeLog.lids += 1
      }
      if (event._tag === 'CookerPopped') {
        state.fridgeLog.pops += 1
      }
      if (event._tag === 'PanSwung') {
        state.fridgeLog.swings += 1
      }
      if (event._tag === 'PanClanged') {
        state.fridgeLog.clangs += 1
      }
      if (event._tag === 'KnifeStabbed') {
        state.fridgeLog.stabs += 1
      }
      if (event._tag === 'KnifeHit') {
        state.fridgeLog.stabHits += 1
      }
      if (event._tag === 'PrizeTaken') {
        state.fridgeLog.taken += 1
      }
      if (
        event._tag === 'Purchased' &&
        model.phase._tag === 'Wave' &&
        distance(event, STALL_BELOW) < AMMO_WINDOW_NEAR_PX
      ) {
        state.fridgeLog.counterBuys += 1
      }
      if (event._tag === 'FreezeSprayed') {
        state.fridgeLog.sprays += 1
      }
      if (event._tag === 'ZombieShattered') {
        state.fridgeLog.shatters += 1
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
    upgradeSpend: state.spentOnUpgrades,
    minHp,
    waves,
    moneyAtVisit,
    gnomesPlaced: state.gnomesPlaced,
    boughtAtVisit: state.boughtLog,
    dropped,
    grabbed,
    boostedMs,
    waveMs,
    timelines,
    boss: bossLog,
    newKinds,
    kitchenWave: state.kitchenWave,
    fridge: {
      ...state.fridgeLog,
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
