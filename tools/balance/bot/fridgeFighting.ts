import { isOutOfGuns } from '../../../src/ammoWarning'
import { hasLineOfSight, levelOf } from '../../../src/arena'
import { PLAYER_RADIUS } from '../../../src/constants'
import {
  COOKER_RULES,
  FREEZE_RULES,
  cookerFullMs,
  isFridgeWeapon,
  isSmallKind,
} from '../../../src/fridgeWeapons'
import { heldGun, isWieldingMelee } from '../../../src/weapons'
import { bodyRadiusOf } from '../../../src/zombies'
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

// FIGHTING WITH A FRIDGE WEAPON

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
  // NOTE: a Line Cook's first gun is the Cooker alone, so with no other gun
  // to shoot it lobs at the nearest zombie, as a player with only a pot
  // would, until the first purchase gives it a firearm.
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

export const panPlan = (model: Model): FridgePlan => {
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
export const swingPan = (
  state: BotState,
  model: Model,
  frame: number,
): Model => {
  const drawn = isWieldingMelee(model.player)
    ? model
    : tapKey(model, KEYS.knife)
  const { target } = state.panPlanNow
  if (frame % AIM_EVERY_FRAMES !== 0 || target === undefined) {
    return holdAssistedAim(state, drawn)
  }
  return aimAndShoot(state, drawn, target, frame)
}

// The Pan out with no target to swing at goes back to the last gun at
// once, unless no gun can shoot.
export const sheathPan = (model: Model): Model =>
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
const workCooker = (
  state: BotState,
  model: Model,
  spare: FridgeSpare,
): Model => {
  const { charge } = model.player
  if (charge._tag === 'Building') {
    const limit = Math.min(state.fridgePlan.lobMs, cookerFullMs(spare.tier))
    return charge.heldMs >= limit ? holdFire(model) : model
  }
  return charge._tag === 'Spent' ? holdFire(model) : model
}

// Every few frames the bot picks its plan and swaps to the weapon it wants
// (the swap is free); in between it only times the Cooker's release.
export const fightWithFridge = (
  state: BotState,
  model: Model,
  frame: number,
  spare: FridgeSpare,
): Model => {
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
  const aimed = aimAt(state, swapped, target)
  const { charge, fireCooldownMs } = aimed.model.player
  return charge._tag === 'Idle' && fireCooldownMs <= 0
    ? pressFire(aimed.model, aimed.point)
    : workCooker(state, aimed.model, spare)
}
