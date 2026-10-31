// How the balance bot fights: the Pan's stance, the knife, where it walks
// in a wave, and how it aims and fires like a fair player.

import { Option } from 'effect'

import { assistAim } from '../../../src/aimAssist'
import { isOutOfGuns } from '../../../src/ammoWarning'
import { hasLineOfSight, levelOf } from '../../../src/arena'
import { screenCameraOf, viewToWorld, worldToView } from '../../../src/camera'
import { maybeShieldFor } from '../../../src/chucker'
import { PLAYER_RADIUS } from '../../../src/constants'
import { isSmallKind } from '../../../src/fridgeWeapons'
import { KNIFE_RULES } from '../../../src/knife'
import { Message } from '../../../src/message'
import {
  canReload,
  heldGun,
  heldLoaded,
  heldStats,
  isReloading,
  isWieldingMelee,
} from '../../../src/weapons'
import { bodyRadiusOf } from '../../../src/zombies'
import {
  KEYS,
  type Model,
  ROOM_CENTER,
  type Vector,
  distance,
  maybeWindowScreen,
  send,
  steerToward,
  tapKey,
  walking,
  windowCamera,
} from './basics'
import {
  BOSS_BERTH_PX,
  ENGAGES,
  FLEE_PX,
  KITES,
  bossOf,
  engage,
  frenzyBerthPx,
  kiteAway,
  safePickup,
  telegraphDodge,
} from './dodging'
import { isSpent } from './guns'
import { isInKitchen, routeTo } from './route'
import { type BotState, type Zombie } from './state'

// The Pan dazes and knocks back the small kinds; it keeps its distance
// from an Exploder, which would burst in its face, and from the big ones.
export const isPannable = (zombie: Zombie) =>
  isSmallKind(zombie.kind) && zombie.kind !== 'Exploder'

const PAN_NEAR_PX = 12
const PAN_FAR_PX = 16

const panStance = (state: BotState, model: Model): Vector | undefined => {
  const { panTarget } = state.panPlanNow
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

export const isGunIdle = (model: Model): boolean => {
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
export const handleKnife = (state: BotState, model: Model): Model => {
  if (!isWieldingMelee(model.player)) {
    return isWithinKnife(model) && isGunIdle(model)
      ? tapKey(model, KEYS.knife)
      : model
  }
  return !state.panPlanNow.useSpare &&
    !isOutOfGuns(model.player) &&
    !isGunIdle(model)
    ? tapKey(model, 'KeyQ')
    : model
}

export const kite = (state: BotState, model: Model): Vector => {
  const { player } = model
  const dodge = telegraphDodge(model)
  if (dodge !== undefined) {
    return dodge
  }
  const stance = panStance(state, model)
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

// The bot is a fair player, not an aimbot: it re-aims only every few
// frames, aims where the target was a moment ago, and its hand shakes.
export const AIM_EVERY_FRAMES = Number(process.env['AIM_EVERY'] ?? 5)
const AIM_NOISE_RADIANS = Number(process.env['AIM_NOISE'] ?? 0.22)
export const MOVE_EVERY_FRAMES = Number(process.env['MOVE_EVERY'] ?? 4)

const nextBotRandom = (state: BotState) => {
  state.botRandom = (state.botRandom * 1103515245 + 12345) >>> 0
  return state.botRandom / 0xffffffff
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

export const nearestVisible = (model: Model) => {
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
export const topOff = (model: Model): Model => {
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

export const holdAssistedAim = (state: BotState, model: Model): Model => {
  if (
    maybeAssistScreen === undefined ||
    state.maybeRawAim === undefined ||
    model.input.mouseButton._tag !== 'Held'
  ) {
    return model
  }
  const point = assistedPoint(model, state.maybeRawAim)
  return send(model, Message.MovedMouse({ clientX: point.x, clientY: point.y }))
}

// Points the mouse at target, with the hand's shake, and returns the
// screen point it aimed at.
export const aimAt = (
  state: BotState,
  model: Model,
  target: Vector,
): { model: Model; point: Vector } => {
  const angle =
    Math.atan2(target.y - model.player.y, target.x - model.player.x) +
    (nextBotRandom(state) + nextBotRandom(state) - 1) * AIM_NOISE_RADIANS
  // The mouse lives in screen pixels, so the aim point goes through the
  // camera, which scrolls once the kitchen is open.
  const rawPoint = worldToView(screenCameraOf(model), {
    x: model.player.x + Math.cos(angle) * AIM_REACH_PX,
    y: model.player.y + Math.sin(angle) * AIM_REACH_PX,
  })
  state.maybeRawAim = rawPoint
  const point = assistedPoint(model, rawPoint)
  return {
    model: send(
      model,
      Message.MovedMouse({ clientX: point.x, clientY: point.y }),
    ),
    point,
  }
}

export const pressFire = (model: Model, point: Vector): Model =>
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

export const holdFire = (model: Model): Model =>
  model.input.mouseButton._tag === 'Held'
    ? send(model, Message.ReleasedPointer({ pointerId: 1 }))
    : model

export const aimAndFire = (
  state: BotState,
  model: Model,
  frame: number,
  maybeTarget?: Zombie,
): Model => {
  if (frame % AIM_EVERY_FRAMES !== 0) {
    return holdAssistedAim(state, model)
  }
  const target = maybeTarget ?? nearestVisible(model)
  if (target === undefined) {
    return topOff(holdFire(model))
  }
  const aimed = aimAt(state, model, target)
  return pressFire(aimed.model, aimed.point)
}
