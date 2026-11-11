// How the balance bot fights: the Pan's stance, the knife, where it walks
// in a wave, and how it aims and fires like a fair player.

import { Array, Function, Option } from 'effect'

import { Message } from '../../../src/app/message'
import { escapeHeading } from '../../../src/features/bots/escape'
import { assistAim } from '../../../src/input/aimAssist'
import {
  screenCameraOf,
  viewToWorld,
  worldToView,
} from '../../../src/render/camera'
import { PLAYER_RADIUS } from '../../../src/shared/constants'
import { isSmallKind } from '../../../src/world/fridge/fridgeWeapons'
import { KNIFE_RULES } from '../../../src/world/gear/knife'
import {
  canReload,
  heldLoaded,
  heldStats,
  isReloading,
  isWieldingMelee,
} from '../../../src/world/gear/weapons'
import { hasLineOfSight, levelOf } from '../../../src/world/level/arena'
import { focusOf } from '../../../src/world/party/party'
import { maybeShieldFor } from '../../../src/world/zombies/chucker'
import { bodyRadiusOf } from '../../../src/world/zombies/zombies'
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
import {
  IS_SHARP,
  humanSight,
  isNoticed,
  nextBotRandom,
  stickyTarget,
  withinSenses,
} from './hand'
import { isKnobSet, knobNumber } from './knobs'
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
  const { player } = focusOf(model)
  const threat = Array.filter(
    walking(model),
    zombie => !isPannable(zombie),
  ).sort((a, b) => distance(player, a) - distance(player, b))[0]
  if (
    threat !== undefined &&
    distance(player, threat) <
      FLEE_PX + (threat.kind === 'Boss' ? BOSS_BERTH_PX : 0)
  ) {
    return escapeHeading(levelOf(model), player, [
      { at: threat, radius: bodyRadiusOf(threat) },
    ])
  }
  const target = Option.getOrUndefined(
    Array.findFirst(walking(model), zombie => zombie.id === panTarget.id),
  )
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
// cannot shoot (mid-reload, or empty). A reload carries on while the knife
// is out, so it goes back to its last gun (Q) as soon as that gun can shoot
// again.
const STAB_SLACK_PX = 1

export const isGunIdle = (model: Model): boolean => {
  const { player } = focusOf(model)
  return isReloading(player) || (heldLoaded(player) <= 0 && !canReload(player))
}

const isWithinKnife = (model: Model): boolean =>
  Array.some(
    walking(model),
    zombie =>
      distance(focusOf(model).player, zombie) -
        bodyRadiusOf(zombie) -
        PLAYER_RADIUS <=
      KNIFE_RULES.reachPx - STAB_SLACK_PX,
  )

// With the Pan in the melee slot the same rules draw it, and while its
// plan swings it the bot keeps it out.
export const handleKnife: {
  (model: Model): (state: BotState) => Model
  (state: BotState, model: Model): Model
} = Function.dual(2, (state: BotState, model: Model): Model => {
  if (!isWieldingMelee(focusOf(model).player)) {
    return isWithinKnife(model) && isGunIdle(model)
      ? tapKey(model, KEYS.knife)
      : model
  }
  return !state.panPlanNow.useSpare && !isGunIdle(model)
    ? tapKey(model, 'KeyQ')
    : model
})

// NOTE: how many of the nearest zombies it has noticed the bot runs from at
// once: a person keeps an eye on the one closing in and the one behind it.
// In Uncle Chunk's fight it watches only the nearest: watching two there let
// him close in (his bites took 50 hearts in 100 Normal runs, against 35,
// and he fell in 6 fights of 53, 2026-11-11), while outside it two cut the
// deaths on the hunt from 48 to 44. WATCHED=1 is the bot that watches only
// the nearest everywhere.
const WATCHED = knobNumber('WATCHED', 2)

export const kite: {
  (model: Model): (state: BotState) => Vector
  (state: BotState, model: Model): Vector
} = Function.dual(2, (state: BotState, model: Model): Vector => {
  const { player } = focusOf(model)
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
  // A zombie frozen solid by Brain Freeze cannot bite, so it is not fled,
  // and the human bot flees only what it has noticed: in view, or heard.
  const fled = Array.filter(
    Array.filter(
      Array.filter(
        withinSenses(model),
        zombie => !KITES || zombie.kind !== 'Boss',
      ),
      zombie => zombie.action._tag !== 'Frozen',
    ),
    zombie => isNoticed(state, model, zombie),
  ).sort((a, b) => reach(a) - reach(b))
  // It runs the way a person does: away from the zombies it is watching,
  // along a wall and out of corners (src/features/bots/escape.ts), but blind to the rest
  // of the crowd. It watches the WATCHED nearest it has noticed: weaving
  // through every gap, as the teammate bots do, won Normal 40% and Hard 49%
  // on 2026-11-03, far past what people manage.
  const watched = Array.map(
    Array.filter(
      Array.take(fled, model.boss._tag === 'Fighting' ? 1 : WATCHED),
      zombie => reach(zombie) < FLEE_PX,
    ),
    zombie => ({
      at: zombie,
      radius: bodyRadiusOf(zombie) + distance(player, zombie) - reach(zombie),
    }),
  )
  if (watched.length > 0) {
    return escapeHeading(levelOf(model), player, watched)
  }
  if (isInKitchen(player)) {
    return steerToward(player, routeTo(levelOf(model), player, ROOM_CENTER))
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
    ? steerToward(player, routeTo(levelOf(model), player, ROOM_CENTER))
    : { x: 0, y: 0 }
})

// The bot is a fair player, not an aimbot: it re-aims only every few
// frames and its hand shakes. The human bot (bot/hand.ts) also reacts late,
// trails and overshoots its target, and steps a little less often; AIM=sharp
// is the old bot, whose only miss is AIM_NOISE.
export const AIM_EVERY_FRAMES = knobNumber('AIM_EVERY', 5)
const AIM_NOISE_RADIANS = knobNumber('AIM_NOISE', 0.22)
export const MOVE_EVERY_FRAMES = knobNumber('MOVE_EVERY', IS_SHARP ? 4 : 6)

// It shoots the nearest zombie it can see, but while the boss stands it
// shoots him unless something else is within FOCUS_PX, and it always shoots
// him while he is dazed.
// NO_FOCUS=1 always shoots the nearest.
const FOCUSES_BOSS = !isKnobSet('NO_FOCUS')
const FOCUS_PX = knobNumber('FOCUS_PX', 60)
// A Big Leaguer holding his shield toward the bot, and the zombie he holds,
// only soak up shots, so the bot shoots something else while there is
// anything else to shoot.
const isBehindShield = (model: Model, zombie: Model['zombies'][number]) => {
  if (zombie.action._tag === 'Shielded') {
    return true
  }
  const length = Math.max(1, distance(focusOf(model).player, zombie))
  const toward = {
    x: (zombie.x - focusOf(model).player.x) / length,
    y: (zombie.y - focusOf(model).player.y) / length,
  }
  return Option.isSome(maybeShieldFor(zombie, toward))
}

export const nearestVisible = (model: Model) => {
  const inSight = Array.filter(walking(model), zombie =>
    hasLineOfSight(levelOf(model), focusOf(model).player, zombie),
  ).sort(
    (a, b) =>
      distance(focusOf(model).player, a) - distance(focusOf(model).player, b),
  )
  const open = Array.filter(inSight, zombie => !isBehindShield(model, zombie))
  const visible = open.length > 0 ? open : inSight
  const nearest = visible[0]
  const boss = FOCUSES_BOSS
    ? Option.getOrUndefined(
        Array.findFirst(visible, zombie => zombie.kind === 'Boss'),
      )
    : undefined
  const isDazed =
    model.boss._tag === 'Fighting' && model.boss.move._tag === 'Dazed'
  return boss !== undefined &&
    nearest !== undefined &&
    (isDazed ||
      nearest.kind === 'Boss' ||
      distance(focusOf(model).player, nearest) > FOCUS_PX)
    ? boss
    : nearest
}

// Reloads when nothing is in sight and the magazine is under half, or when
// the room is empty, the way a player tops off between fights instead of
// every time a zombie ducks behind cover. An empty gun reloads on its own.
export const topOff = (model: Model): Model => {
  const isLow =
    heldLoaded(focusOf(model).player) <
    heldStats(focusOf(model).player).magazine / 2
  return canReload(focusOf(model).player) &&
    (isLow || walking(model).length === 0)
    ? tapKey(model, 'KeyR')
    : model
}

// VIEW=portrait and VIEW=touch also get the touch aim assist
// (src/input/aimAssist.ts) the way the game gives it to a phone: every tick the
// trigger is held, the aim from where the bot last pointed bends onto the
// zombie it is almost on, in view of the phone's window. NO_ASSIST=1 plays
// either without it.
const maybeAssistScreen = !isKnobSet('NO_ASSIST')
  ? maybeWindowScreen
  : undefined
const AIM_REACH_PX = 40

const assistedPoint = (model: Model, rawPoint: Vector): Vector => {
  if (maybeAssistScreen === undefined) {
    return rawPoint
  }
  const camera = screenCameraOf(model)
  const raw = viewToWorld(camera, rawPoint)
  const length = Math.max(1e-6, distance(focusOf(model).player, raw))
  const aim = assistAim(
    levelOf(model),
    windowCamera(model, maybeAssistScreen),
    focusOf(model).player,
    model.zombies,
    {
      x: (raw.x - focusOf(model).player.x) / length,
      y: (raw.y - focusOf(model).player.y) / length,
    },
  )
  return worldToView(camera, {
    x: focusOf(model).player.x + aim.x * AIM_REACH_PX,
    y: focusOf(model).player.y + aim.y * AIM_REACH_PX,
  })
}

export const holdAssistedAim: {
  (model: Model): (state: BotState) => Model
  (state: BotState, model: Model): Model
} = Function.dual(2, (state: BotState, model: Model): Model => {
  if (
    maybeAssistScreen === undefined ||
    state.maybeRawAim === undefined ||
    model.input.mouseButton._tag !== 'Held'
  ) {
    return model
  }
  const point = assistedPoint(model, state.maybeRawAim)
  return send(model, Message.MovedMouse({ clientX: point.x, clientY: point.y }))
})

// Points the mouse at target, with the sharp hand's shake or the human
// hand's error, and returns the screen point it aimed at.
// humanError is the human hand's miss; undefined shakes the sharp hand.
export const aimAt: {
  (
    model: Model,
    target: Vector,
    humanError: number | undefined,
  ): (state: BotState) => { model: Model; point: Vector }
  (
    state: BotState,
    model: Model,
    target: Vector,
    humanError: number | undefined,
  ): { model: Model; point: Vector }
} = Function.dual(
  4,
  (
    state: BotState,
    model: Model,
    target: Vector,
    humanError: number | undefined,
  ): { model: Model; point: Vector } => {
    const angle =
      Math.atan2(
        target.y - focusOf(model).player.y,
        target.x - focusOf(model).player.x,
      ) +
      (humanError ??
        (nextBotRandom(state) + nextBotRandom(state) - 1) * AIM_NOISE_RADIANS)
    state.maybeAimAngle = angle
    // The mouse lives in screen pixels, so the aim point goes through the
    // camera, which scrolls once the kitchen is open.
    const rawPoint = worldToView(screenCameraOf(model), {
      x: focusOf(model).player.x + Math.cos(angle) * AIM_REACH_PX,
      y: focusOf(model).player.y + Math.sin(angle) * AIM_REACH_PX,
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
  },
)

export const pressFire: {
  (point: Vector): (model: Model) => Model
  (model: Model, point: Vector): Model
} = Function.dual(2, (model: Model, point: Vector): Model =>
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
      ),
)

export const holdFire = (model: Model): Model =>
  model.input.mouseButton._tag === 'Held'
    ? send(model, Message.ReleasedPointer({ pointerId: 1 }))
    : model

// maybeTarget is the zombie to shoot; undefined picks the nearest in view.
export const aimAndFire: {
  (
    model: Model,
    frame: number,
    maybeTarget: Zombie | undefined,
  ): (state: BotState) => Model
  (
    state: BotState,
    model: Model,
    frame: number,
    maybeTarget: Zombie | undefined,
  ): Model
} = Function.dual(
  4,
  (
    state: BotState,
    model: Model,
    frame: number,
    maybeTarget: Zombie | undefined,
  ): Model => {
    if (frame % AIM_EVERY_FRAMES !== 0) {
      return holdAssistedAim(state, model)
    }
    const target =
      maybeTarget ?? stickyTarget(state, model, nearestVisible(model))
    if (target === undefined) {
      return topOff(holdFire(model))
    }
    return aimAndShoot(state, model, target, frame)
  },
)

// Aims at target and pulls the trigger, once the human hand has reacted to
// it; until then the trigger rests.
export const aimAndShoot: {
  (model: Model, target: Zombie, frame: number): (state: BotState) => Model
  (state: BotState, model: Model, target: Zombie, frame: number): Model
} = Function.dual(
  4,
  (state: BotState, model: Model, target: Zombie, frame: number): Model => {
    if (IS_SHARP) {
      const aimed = aimAt(state, model, target, undefined)
      return pressFire(aimed.model, aimed.point)
    }
    const sight = humanSight(state, target, frame)
    if (sight === undefined) {
      return holdFire(model)
    }
    const aimed = aimAt(state, model, sight.at, sight.error)
    return pressFire(aimed.model, aimed.point)
  },
)
