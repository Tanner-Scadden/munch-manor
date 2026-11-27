import { Array, Function, Option } from 'effect'

import { Message } from '../../../src/app/message'
import { chandelierShot } from '../../../src/features/bots/dareSearch'
import { escapeHeading } from '../../../src/features/bots/escape'
import { AIM_ASSIST, assistAim } from '../../../src/input/aimAssist'
import {
  screenCameraOf,
  viewToWorld,
  worldToView,
} from '../../../src/render/camera/camera'
import { PLAYER_RADIUS } from '../../../src/shared/constants'
import {
  isFridgeWeapon,
  isSmallKind,
} from '../../../src/world/fridge/fridgeWeapons'
import { KNIFE_RULES } from '../../../src/world/gear/knife'
import {
  canReload,
  heldGun,
  heldLoaded,
  heldStats,
  isReloading,
  isWieldingMelee,
} from '../../../src/world/gear/weapons'
import { levelOf } from '../../../src/world/level/arena'
import { hasLineOfSight } from '../../../src/world/level/tileQueries'
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

export const AIM_EVERY_FRAMES = knobNumber('AIM_EVERY', 5)
const AIM_NOISE_RADIANS = knobNumber('AIM_NOISE', 0.22)
export const MOVE_EVERY_FRAMES = knobNumber('MOVE_EVERY', IS_SHARP ? 4 : 6)

const FOCUSES_BOSS = !isKnobSet('NO_FOCUS')
const FOCUS_PX = knobNumber('FOCUS_PX', 60)
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

export const topOff = (model: Model): Model => {
  const isLow =
    heldLoaded(focusOf(model).player) <
    heldStats(focusOf(model).player).magazine / 2
  return canReload(focusOf(model).player) &&
    (isLow || walking(model).length === 0)
    ? tapKey(model, 'KeyR')
    : model
}

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
    AIM_ASSIST.Touch,
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

export const shootChandelier: {
  (model: Model): (state: BotState) => Model | undefined
  (state: BotState, model: Model): Model | undefined
} = Function.dual(2, (state: BotState, model: Model): Model | undefined => {
  const { player } = focusOf(model)
  if (
    isWieldingMelee(player) ||
    isGunIdle(model) ||
    isFridgeWeapon(heldGun(player.arsenal).kind)
  ) {
    return undefined
  }
  return Option.match(chandelierShot(model, player), {
    onNone: () => undefined,
    onSome: point => {
      const aimed = aimAt(state, model, point, undefined)
      return pressFire(aimed.model, aimed.point)
    },
  })
})

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
