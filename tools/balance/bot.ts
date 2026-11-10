// The balance bot: a fair, simple player that drives the game's own init
// model and update. tools/balance/simulate.ts runs it for the campaign
// reports, and the wave snapshot pass replays single waves from a typical
// run state. Nothing here ships with the game. Install a DOM (happy-dom)
// before importing this module, as simulate.ts and vitest do.
//
// This module plays a run: the frame loop, and what it logs. The bot's
// parts live in tools/balance/bot/, and the run's state they share is one
// BotState (bot/state.ts) made fresh for each run.

import { Array, Function, Option, Record } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { Message } from '../../src/app/message'
import { initialModel } from '../../src/app/pureApp'
import { heroIdOf } from '../../src/shared/playerData'
import { asTutorialDone, asVeteran } from '../../src/test/veteran'
import { heldGun, maybeOtherGun } from '../../src/world/gear/weapons'
import { noRank } from '../../src/world/heroes/rank'
import { KEY_RULES } from '../../src/world/keys/keys'
import { boxCenter, levelOf } from '../../src/world/level/arena'
import { focusOf } from '../../src/world/party/party'
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
import { isKnobSet, traceLine } from './bot/knobs'
import {
  type BossLog,
  PRESSURE_CROWD,
  PRESSURE_PX,
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
import type { BossBlame, RunResult } from './bot/results'
import { routeTo } from './bot/route'
import {
  busiestDoor,
  crateTarget,
  fridgeKeys,
  fridgeStand,
  gnomeSpot,
  holdingAtBoards,
  isAtMend,
  isBreakOverdue,
  isFridgeInReach,
  isKitchenOpen,
  isOfferedToBot,
  mendTarget,
  offeredWeapon,
  prepPlan,
  roomTarget,
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
  const tags = new Set(Array.map(after.frameEvents, event => event._tag))
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
  const burst = Array.some(
    after.frameEvents,
    event =>
      event._tag === 'Exploded' &&
      Math.hypot(
        event.x - focusOf(after).player.x,
        event.y - focusOf(after).player.y,
      ) < 34,
  )
  if (burst) {
    return 'Exploder'
  }
  if (Array.some(after.frameEvents, event => event._tag === 'ZombieLanded')) {
    return 'Thrower'
  }
  if (bossBlameOf(after) !== undefined) {
    return 'Boss'
  }
  return walking(before).sort(
    (a, b) =>
      distance(focusOf(before).player, a) - distance(focusOf(before).player, b),
  )[0]?.kind
}

// Charges the hearts lost this frame to a kind and returns that kind.
const blame = (
  before: Model,
  after: Model,
  hurtBy: Record<Kind, number>,
): Kind | undefined => {
  const lost = focusOf(before).player.hp - focusOf(after).player.hp
  if (lost <= 0) {
    return undefined
  }
  const kind = blamedKind(before, after)
  if (kind !== undefined) {
    hurtBy[kind] += lost
  }
  return kind
}

// NOTE: points enough for any calling's rank, and the calling it plays
// bought, so the bot starts it.
const BOT_RANK_POINTS = 100_000

// The model of a fresh run on the title, already started: Enter opens the
// lobby, E picks endless there, and Enter starts.
export const startedRun: {
  (options: BotOptions): (seed: number) => Model
  (seed: number, options: BotOptions): Model
} = Function.dual(2, (seed: number, options: BotOptions): Model => {
  const ready = send(
    modifyFields(asTutorialDone(asVeteran(initialModel)), {
      rngState: () => seed,
      difficulty: () => ({ chosen: options.difficulty, nightmare: 'Unlocked' }),
      calling: () => options.calling,
      modifiers: () => options.modifiers,
      rank: () => ({ ...noRank, earnedPoints: BOT_RANK_POINTS }),
      boughtCosmetics: () =>
        options.calling === 'You' ? [] : [heroIdOf(options.calling)],
    }),
    Message.MeasuredGameSurface(SURFACE),
  )
  const inLobby = tapKey(ready, 'Enter')
  return tapKey(
    options.mode === 'Endless' ? tapKey(inLobby, 'KeyE') : inLobby,
    'Enter',
  )
})

// How far play goes: to the end of the run, to the end of the wave it
// starts in, or to the start of a wave's Preparation.
type Stop =
  | { _tag: 'RunEnd' }
  | { _tag: 'WaveEnd' }
  | { _tag: 'WaveStart'; wave: number }

// Called with the model on the first frame of each wave's Preparation,
// before the bot shops, which is where a wave snapshot is taken.
type OnPreparation = (wave: number, model: Model) => void

export const play: {
  (
    seed: number,
    options: BotOptions,
    stop: Stop,
    onPreparation: OnPreparation,
  ): (start: Model) => RunResult
  (
    start: Model,
    seed: number,
    options: BotOptions,
    stop: Stop,
    onPreparation: OnPreparation,
  ): RunResult
} = Function.dual(
  5,
  (
    start: Model,
    seed: number,
    options: BotOptions,
    stop: Stop,
    onPreparation: OnPreparation,
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
    let stuckFrames = 0
    let lastPosition: Vector = focusOf(model).player
    let strafe = 1
    let frame = 0
    let maxAlive = 0
    let minHp = focusOf(model).player.hp
    const waves: Array<WaveLog> = []
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
        state.breakFrames = 0
        onPreparation(wave, model)
        if (stop._tag === 'WaveStart' && wave >= stop.wave) {
          break
        }
      }
      state.breakFrames += model.phase._tag === 'Preparation' ? 1 : 0
      if (model.phase._tag === 'Preparation') {
        model = holdFire(model)
        const plan = prepPlan(state, model)
        if (plan === 'Go') {
          state.gnomeTries = 0
          model = pressKeys(model, new Set())
          const other = Option.getOrUndefined(
            maybeOtherGun(focusOf(model).player.arsenal),
          )
          if (
            state.options.swapsBack &&
            heldGun(focusOf(model).player.arsenal).kind === 'Pistol' &&
            other !== undefined
          ) {
            model = tapKey(model, 'KeyQ')
          }
          model = tapKey(topOff(model), 'Enter')
          if (model.phase._tag === 'Preparation' && isBreakOverdue(state)) {
            model = send(model, Message.ClickedStartWaveButton())
          }
          if (model.phase._tag !== 'Preparation') {
            continue
          }
          model = send(model, Message.TickedFrame({ deltaTime: FRAME_MS }))
          continue
        }
        const target =
          plan === 'Room'
            ? (roomTarget(model) ?? ROOM_CENTER)
            : plan === 'Crate'
              ? (crateTarget(model) ?? ROOM_CENTER)
              : plan === 'Mend'
                ? (mendTarget(model) ?? ROOM_CENTER)
                : plan === 'Gnome'
                  ? gnomeSpot(model)
                  : plan === 'Fridge'
                    ? (fridgeStand(model) ?? ROOM_CENTER)
                    : plan === 'Return'
                      ? ROOM_CENTER
                      : boxCenter(
                          levelOf(model).thresholds[
                            busiestDoor(model) ?? 'North'
                          ].box,
                        )
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
        } else if (plan === 'Mend' && isAtMend(model)) {
          model = pressKeys(model, new Set())
        } else if (
          plan === 'Gnome' &&
          distance(focusOf(model).player, target) < 6
        ) {
          state.gnomeTries += 1
          const selected =
            focusOf(model).selectedTrap === 'Turret'
              ? model
              : tapKey(model, 'KeyG')
          const placed = tapKey(selected, 'KeyT')
          state.gnomesPlaced +=
            focusOf(placed).trapStock.Turret < focusOf(model).trapStock.Turret
              ? 1
              : 0
          model = pressKeys(placed, new Set())
        } else if (
          plan === 'Barricade' &&
          distance(focusOf(model).player, target) < 8
        ) {
          const placed = tapKey(model, 'KeyT')
          model =
            focusOf(placed).trapStock.Barricade <
            focusOf(model).trapStock.Barricade
              ? placed
              : pressKeys(
                  placed,
                  desiredKeys(steerToward(focusOf(placed).player, target)),
                )
        } else {
          const direction = steerToward(
            focusOf(model).player,
            routeTo(levelOf(model), focusOf(model).player, target),
          )
          const moved = distance(focusOf(model).player, lastPosition)
          stuckFrames = moved < 0.3 ? stuckFrames + 1 : 0
          if (stuckFrames > 20) {
            strafe = -strafe
            stuckFrames = 0
          }
          const sidestep =
            stuckFrames > 5
              ? { x: -direction.y * strafe, y: direction.x * strafe }
              : direction
          model = pressKeys(
            model,
            holdingAtBoards(model, desiredKeys(sidestep)),
          )
        }
      } else {
        if (frame % MOVE_EVERY_FRAMES === 0) {
          model = handleKnife(
            state,
            pressKeys(
              model,
              holdingAtBoards(model, desiredKeys(kite(state, model))),
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
          model = aimAndFire(state, sheathPan(model), frame, undefined)
        } else {
          model = fightWithFridge(state, sheathPan(model), frame, fridgeSpare)
        }
      }
      lastPosition = focusOf(model).player
      frame += 1
      const before = model
      model = send(model, Message.TickedFrame({ deltaTime: FRAME_MS }))
      if (!isKitchenOpen(before) && isKitchenOpen(model)) {
        state.kitchenWave = wave
      }
      const blamed = blame(before, model, hurtBy)
      if (focusOf(model).player.hp <= 0 && focusOf(before).player.hp > 0) {
        killedBy = blamed
      }
      Array.forEach(model.frameEvents, event => {
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
          newKinds.wipeBonus += KEY_RULES.perPackWiped
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
        if (event._tag === 'FreezeSprayed') {
          state.fridgeLog.sprays += 1
        }
        if (event._tag === 'ZombieShattered') {
          state.fridgeLog.shatters += 1
        }
      })
      if (
        focusOf(model).player.hp < focusOf(before).player.hp &&
        Array.some(model.frameEvents, event => event._tag === 'ZombieLanded')
      ) {
        newKinds.throwHits += 1
      }
      if (
        focusOf(model).player.hp < focusOf(before).player.hp &&
        Array.some(before.zombies, zombie => zombie.action._tag === 'Clinging')
      ) {
        newKinds.heartsWhileClung +=
          focusOf(before).player.hp - focusOf(model).player.hp
      }
      Array.forEach(model.frameEvents, event => {
        if (event._tag === 'PickupDropped') {
          dropped[event.kind] = (dropped[event.kind] ?? 0) + 1
        }
        if (event._tag === 'PickupGrabbed') {
          grabbed[event.kind] = (grabbed[event.kind] ?? 0) + 1
        }
      })
      if (before.phase._tag === 'Wave') {
        waveMs += FRAME_MS
        if (
          Array.some(
            Record.values(focusOf(model).boosts),
            timer => timer._tag === 'On',
          )
        ) {
          boostedMs += FRAME_MS
        }
      }
      if (before.phase._tag === 'Wave') {
        const hasBoss = before.boss._tag !== 'Absent'
        const known = Option.getOrUndefined(
          Array.findFirst(bossLog, fight => fight.wave === wave),
        )
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
          Array.forEach(model.frameEvents, event => {
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
          const lost = focusOf(before).player.hp - focusOf(model).player.hp
          if (lost > 0 && model.boss._tag === 'Fighting') {
            fight.heartsLost += lost
            const cause = bossBlameOf(model)
            const nearest = walking(before).sort(
              (a, b) =>
                distance(focusOf(before).player, a) -
                distance(focusOf(before).player, b),
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
            Array.some(
              model.frameEvents,
              event => event._tag === 'BossStomped',
            ) &&
            focusOf(model).player.hp < focusOf(before).player.hp
          ) {
            fight.stompHits += 1
          }
          if (focusOf(model).player.hp <= 0 && model.boss._tag === 'Fighting') {
            fight.diedToIt = true
          }
        }
      }
      maxAlive = Math.max(maxAlive, model.zombies.length)
      minHp = Math.min(minHp, focusOf(model).player.hp)
      if (
        before.phase._tag === 'Wave' ||
        (before.phase._tag === 'Preparation' && model.phase._tag === 'Wave')
      ) {
        recordTimeline((timelines[wave - 1] ??= emptyTimeline()), before, model)
      }
      if (before.phase._tag === 'Wave') {
        const log = (waves[wave - 1] ??= emptyWaveLog())
        const alive = Array.filter(
          model.zombies,
          zombie => zombie.state._tag !== 'Dying',
        )
        const crowd = Array.filter(
          alive,
          zombie => distance(focusOf(model).player, zombie) <= PRESSURE_PX,
        ).length
        log.heartsLost += Math.max(
          0,
          focusOf(before).player.hp - focusOf(model).player.hp,
        )
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
        isKnobSet('BOSS_TRACE') &&
        frame % 150 === 0 &&
        model.boss._tag === 'Fighting'
      ) {
        const boss = bossOf(model)
        traceLine(
          'boss',
          boss?.x.toFixed(0),
          boss?.y.toFixed(0),
          model.boss.move._tag,
          'player',
          focusOf(model).player.x.toFixed(0),
          focusOf(model).player.y.toFixed(0),
          'alive',
          walking(model).length,
        )
      }
      if (isKnobSet('DEBUG') && frame % 150 === 0) {
        const near = Array.map(walking(model), z =>
          distance(focusOf(model).player, z),
        )
        traceLine(
          model.phase._tag,
          wave,
          'zombies',
          near.length,
          'closest',
          Math.min(...near).toFixed(0),
          'player',
          focusOf(model).player.x.toFixed(0),
          focusOf(model).player.y.toFixed(0),
          'hp',
          focusOf(model).player.hp,
          'shots',
          model.stats.shotsFired,
          model.stats.shotsHit,
          focusOf(model).player.arsenal._tag,
        )
      }
      if (
        Array.some(model.frameEvents, event => event._tag === 'WaveCleared')
      ) {
        // NOTE: the keys found so far, where the money earned was before
        // the keys (docs/ESCAPE_PLAN.md, layer 7).
        moneyAfterWave.push(model.keys.found)
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
      minHp,
      waves,
      shopVisits: state.shopVisits,
      gnomesPlaced: state.gnomesPlaced,
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
  },
)

export const runOnce: {
  (options: BotOptions): (seed: number) => RunResult
  (seed: number, options: BotOptions): RunResult
} = Function.dual(2, (seed: number, options: BotOptions): RunResult =>
  play(
    startedRun(seed, options),
    seed,
    options,
    { _tag: 'RunEnd' },
    Function.constVoid,
  ),
)

// SEEDS

export const seedAt: {
  (index: number): (firstSeed: number) => number
  (firstSeed: number, index: number): number
} = Function.dual(
  2,
  (firstSeed: number, index: number): number => firstSeed + index * 7919,
)

// NOTE: a wave run's roll and the bot's hand both come from this seed, kept
// apart from the campaign seeds so a replayed wave never repeats the roll
// its snapshot was taken with.
export const waveSeedAt: {
  (index: number): (firstSeed: number) => number
  (firstSeed: number, index: number): number
} = Function.dual(
  2,
  (firstSeed: number, index: number): number =>
    1_000_003 + firstSeed + index * 7919,
)
