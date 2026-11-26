import { Array, Function, Option } from 'effect'

import { chunkDodge } from '../../../src/features/bots/escape'
import { focusOf } from '../../../src/world/party/party'
import { CHUCKER_RULES } from '../../../src/world/zombies/chucker'
import { CRAWLER_RULES } from '../../../src/world/zombies/crawler'
import { FRENZY_RULES } from '../../../src/world/zombies/frenzy'
import {
  type Model,
  type Vector,
  distance,
  steerToward,
  walking,
} from './basics'
import { isKnobSet, knobNumber } from './knobs'

export const FLEE_PX = knobNumber('FLEE_PX', 36)

const IGNORES_PICKUPS = isKnobSet('NO_PICKUPS')
const PICKUP_SEEK_PX = knobNumber('PICKUP_SEEK_PX', 90)
const PICKUP_SAFE_PX = 28

export const safePickup = (model: Model): Vector | undefined => {
  if (IGNORES_PICKUPS) {
    return undefined
  }
  const zombies = walking(model)
  return Array.filter(
    model.pickups,
    pickup =>
      distance(focusOf(model).player, pickup) < PICKUP_SEEK_PX &&
      Array.every(zombies, zombie => distance(zombie, pickup) > PICKUP_SAFE_PX),
  ).sort(
    (a, b) =>
      distance(focusOf(model).player, a) - distance(focusOf(model).player, b),
  )[0]
}

const NO_DODGE = isKnobSet('NO_DODGE')
export const KITES = isKnobSet('KITE')
const PLAYER_BODY_PX = 4

export const bossOf = (model: Model) => {
  const { boss } = model
  return boss._tag === 'Fighting'
    ? Option.getOrUndefined(
        Array.findFirst(walking(model), zombie => zombie.id === boss.id),
      )
    : undefined
}

const clearSide = (model: Model, boss: Vector): Vector => {
  const toward = steerToward(boss, focusOf(model).player)
  const across = { x: -toward.y, y: toward.x }
  const crowd = Array.filter(
    walking(model),
    zombie => zombie.kind !== 'Boss',
  ).sort(
    (a, b) =>
      distance(focusOf(model).player, a) - distance(focusOf(model).player, b),
  )[0]
  if (crowd === undefined) {
    return across
  }
  const left = {
    x: focusOf(model).player.x + across.x * 10,
    y: focusOf(model).player.y + across.y * 10,
  }
  const right = {
    x: focusOf(model).player.x - across.x * 10,
    y: focusOf(model).player.y - across.y * 10,
  }
  return distance(left, crowd) >= distance(right, crowd)
    ? across
    : { x: -across.x, y: -across.y }
}

const LANDING_MARGIN_PX = knobNumber('LANDING_MARGIN', 6)
const CRACK_BERTH_PX = knobNumber('CRACK_BERTH', 8)

const landingDodge = (model: Model): Vector | undefined => {
  const mark = Option.getOrUndefined(
    Array.findFirst(
      model.zombies,
      zombie =>
        zombie.action._tag === 'Flying' &&
        distance(focusOf(model).player, zombie.action.to) <
          CHUCKER_RULES.landRadius + PLAYER_BODY_PX + LANDING_MARGIN_PX,
    ),
  )
  if (mark?.action._tag !== 'Flying') {
    return undefined
  }
  const center = mark.action.to
  return distance(focusOf(model).player, center) < 3
    ? clearSide(model, mark.action.from)
    : steerToward(center, focusOf(model).player)
}

const crackDodge = (model: Model): Vector | undefined => {
  const crack = Option.getOrUndefined(
    Array.findFirst(
      model.zombies,
      zombie =>
        zombie.action._tag === 'Burrowed' &&
        distance(focusOf(model).player, zombie) <
          CRAWLER_RULES.holdPx + CRACK_BERTH_PX,
    ),
  )
  return crack === undefined
    ? undefined
    : steerToward(crack, focusOf(model).player)
}

const floorDodge = (model: Model): Vector | undefined =>
  NO_DODGE ? undefined : (landingDodge(model) ?? crackDodge(model))

export const telegraphDodge = (model: Model): Vector | undefined => {
  const floor = floorDodge(model)
  if (floor !== undefined) {
    return floor
  }
  return NO_DODGE || KITES
    ? undefined
    : chunkDodge(model, focusOf(model).player)
}

export const BOSS_BERTH_PX = knobNumber('BOSS_BERTH', 16)

export const frenzyBerthPx = () =>
  Math.round(FLEE_PX * (FRENZY_RULES.paceScale - 1))

const KITE_SPOTS: Array<Vector> = [
  { x: 40, y: 40 },
  { x: 180, y: 40 },
  { x: 320, y: 40 },
  { x: 36, y: 130 },
  { x: 324, y: 130 },
  { x: 40, y: 180 },
  { x: 180, y: 185 },
  { x: 320, y: 180 },
]

export const kiteAway: {
  (boss: Vector): (model: Model) => Vector
  (model: Model, boss: Vector): Vector
} = Function.dual(2, (model: Model, boss: Vector): Vector => {
  const spot =
    [...KITE_SPOTS].sort((a, b) => distance(b, boss) - distance(a, boss))[0] ??
    focusOf(model).player
  return distance(focusOf(model).player, spot) > 6
    ? steerToward(focusOf(model).player, spot)
    : { x: 0, y: 0 }
})

export const ENGAGES = isKnobSet('ENGAGE')
const ENGAGE_PX = knobNumber('ENGAGE_PX', 58)

export const engage: {
  (boss: Vector): (model: Model) => Vector
  (model: Model, boss: Vector): Vector
} = Function.dual(2, (model: Model, boss: Vector): Vector => {
  const away = steerToward(boss, focusOf(model).player)
  const spot = {
    x: boss.x + (away.x === 0 && away.y === 0 ? 1 : away.x) * ENGAGE_PX,
    y: boss.y + away.y * ENGAGE_PX,
  }
  return distance(focusOf(model).player, spot) > 6
    ? steerToward(focusOf(model).player, spot)
    : { x: 0, y: 0 }
})
