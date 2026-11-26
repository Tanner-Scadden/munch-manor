import { Array, Function } from 'effect'

import { PLAYER_RADIUS } from '../../../src/shared/constants'
import {
  COOKER_RULES,
  FREEZE_RULES,
  cookerFullMs,
  isFridgeWeapon,
  isSmallKind,
} from '../../../src/world/fridge/fridgeWeapons'
import { heldGun, isWieldingMelee } from '../../../src/world/gear/weapons'
import { levelOf } from '../../../src/world/level/arena'
import { hasLineOfSight } from '../../../src/world/level/tileQueries'
import { focusOf } from '../../../src/world/party/party'
import { bodyRadiusOf } from '../../../src/world/zombies/zombies'
import {
  KEYS,
  type Model,
  type Vector,
  distance,
  tapKey,
  walking,
} from './basics'
import { BOSS_BERTH_PX } from './dodging'
import {
  AIM_EVERY_FRAMES,
  aimAndFire,
  aimAndShoot,
  aimAt,
  holdAssistedAim,
  holdFire,
  isGunIdle,
  isPannable,
  pressFire,
} from './fighting'
import { type FridgeSpare, gunsOfBot, panOf } from './guns'
import { type BotState, type FridgePlan, GUN_PLAN, type Zombie } from './state'

const visibleZombies = (model: Model) =>
  Array.filter(walking(model), zombie =>
    hasLineOfSight(levelOf(model), focusOf(model).player, zombie),
  )

const nearestOf = (from: Vector, zombies: ReadonlyArray<Zombie>) =>
  [...zombies].sort((a, b) => distance(from, a) - distance(from, b))[0]

const edgeGap = (model: Model, zombie: Zombie) =>
  distance(focusOf(model).player, zombie) - bodyRadiusOf(zombie) - PLAYER_RADIUS

const gunPlan = (target?: Zombie): FridgePlan => ({ ...GUN_PLAN, target })

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
  const { player } = focusOf(model)
  const seen = visibleZombies(model)
  const nearest = nearestOf(player, seen)
  if (gunsOfBot(model).length === 1) {
    return nearest === undefined
      ? gunPlan()
      : {
          useSpare: true,
          target: nearest,
          lobMs: lobHoldMs(distance(player, nearest), spare.tier),
          panTarget: undefined,
        }
  }
  if (nearest !== undefined && distance(player, nearest) < LOB_SAFE_PX) {
    return gunPlan()
  }
  const farthest = COOKER_RULES.maxThrowPx + LID_START_PX
  const weight = (zombie: Zombie) =>
    zombie.kind === 'Boss' || zombie.kind === 'Tank' ? 2 : 1
  const score = (zombie: Zombie) =>
    Array.reduce(
      Array.filter(seen, other => distance(other, zombie) <= LOB_GROUP_PX),
      0,
      (total, other) => total + weight(other),
    )
  const best = Array.map(
    Array.filter(seen, zombie => {
      const gap = distance(player, zombie)
      return gap >= LOB_MIN_PX && gap <= farthest
    }),
    zombie => ({ zombie, score: score(zombie) }),
  ).sort(
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

const PAN_ENGAGE_PX = 40
const PAN_THREAT_PX = 50

export const panPlan = (model: Model): FridgePlan => {
  const { player } = focusOf(model)
  const seen = visibleZombies(model)
  const isThreat = Array.some(
    seen,
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
    Array.filter(
      seen,
      zombie => isPannable(zombie) && distance(player, zombie) < PAN_ENGAGE_PX,
    ),
  )
  return target === undefined
    ? gunPlan()
    : { useSpare: true, target, lobMs: 0, panTarget: target }
}

const FREEZE_CLOSE_PX = 30
const FREEZE_GROUP_PX = 20

const freezePlan = (model: Model): FridgePlan => {
  const { player } = focusOf(model)
  const seen = visibleZombies(model)
  const isFrozen = (zombie: Zombie) => zombie.action._tag === 'Frozen'
  const frozen = nearestOf(player, Array.filter(seen, isFrozen))
  const freezable = Array.filter(
    seen,
    zombie =>
      isSmallKind(zombie.kind) &&
      !isFrozen(zombie) &&
      edgeGap(model, zombie) <= FREEZE_RULES.reachPx - 4,
  )
  const close = nearestOf(
    player,
    Array.filter(
      freezable,
      zombie => distance(player, zombie) < FREEZE_CLOSE_PX,
    ),
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
  const group = Array.map(freezable, zombie => ({
    zombie,
    count: Array.filter(
      freezable,
      other => distance(other, zombie) <= FREEZE_GROUP_PX,
    ).length,
  })).sort((a, b) => b.count - a.count)[0]
  return group !== undefined && group.count >= 2
    ? spray(group.zombie)
    : gunPlan()
}

const planFor = (model: Model, spare: FridgeSpare): FridgePlan =>
  spare.kind === 'Cooker' ? cookerPlan(model, spare) : freezePlan(model)

export const swingPan: {
  (model: Model, frame: number): (state: BotState) => Model
  (state: BotState, model: Model, frame: number): Model
} = Function.dual(3, (state: BotState, model: Model, frame: number): Model => {
  const drawn = isWieldingMelee(focusOf(model).player)
    ? model
    : tapKey(model, KEYS.knife)
  const { target } = state.panPlanNow
  if (frame % AIM_EVERY_FRAMES !== 0 || target === undefined) {
    return holdAssistedAim(state, drawn)
  }
  return aimAndShoot(state, drawn, target, frame)
})

export const sheathPan = (model: Model): Model =>
  isWieldingMelee(focusOf(model).player) &&
  panOf(model) !== undefined &&
  !isGunIdle(model)
    ? tapKey(model, 'KeyQ')
    : model

const isHoldingSpare = (model: Model) =>
  isFridgeWeapon(heldGun(focusOf(model).player.arsenal).kind)

const workCooker = (
  state: BotState,
  model: Model,
  spare: FridgeSpare,
): Model => {
  const { charge } = focusOf(model).player
  if (charge._tag === 'Building') {
    const limit = Math.min(state.fridgePlan.lobMs, cookerFullMs(spare.tier))
    return charge.heldMs >= limit ? holdFire(model) : model
  }
  return charge._tag === 'Spent' ? holdFire(model) : model
}

export const fightWithFridge: {
  (model: Model, frame: number, spare: FridgeSpare): (state: BotState) => Model
  (state: BotState, model: Model, frame: number, spare: FridgeSpare): Model
} = Function.dual(
  4,
  (state: BotState, model: Model, frame: number, spare: FridgeSpare): Model => {
    if (frame % AIM_EVERY_FRAMES !== 0) {
      return isHoldingSpare(model) && spare.kind === 'Cooker'
        ? workCooker(state, model, spare)
        : holdAssistedAim(state, model)
    }
    state.fridgePlan = planFor(model, spare)
    const swapped =
      state.fridgePlan.useSpare !== isHoldingSpare(model)
        ? tapKey(model, 'KeyQ')
        : model
    if (!state.fridgePlan.useSpare || !isHoldingSpare(swapped)) {
      return aimAndFire(state, swapped, frame, state.fridgePlan.target)
    }
    const { target } = state.fridgePlan
    if (target === undefined) {
      return holdFire(swapped)
    }
    if (spare.kind !== 'Cooker') {
      return aimAndShoot(state, swapped, target, frame)
    }
    const aimed = aimAt(state, swapped, target, undefined)
    const { charge, fireCooldownMs } = focusOf(aimed.model).player
    return charge._tag === 'Idle' && fireCooldownMs <= 0
      ? pressFire(aimed.model, aimed.point)
      : workCooker(state, aimed.model, spare)
  },
)
