// Where the balance bot walks in a fight: over a safe pickup, out of the
// boss's and the floor's tells, around the boss when it kites or engages.

import { Array, Function, Option } from 'effect'

import { BOSS_RULES } from '../../../src/boss'
import { CHUCKER_RULES } from '../../../src/chucker'
import { CRAWLER_RULES } from '../../../src/crawler'
import { FRENZY_RULES } from '../../../src/frenzy'
import { focusOf } from '../../../src/party'
import { BossMove } from '../../../src/worldSchema'
import {
  type Model,
  type Vector,
  distance,
  steerToward,
  walking,
} from './basics'
import { isKnobSet, knobNumber } from './knobs'

// Keeps its distance from the nearest zombie only once it is inside the
// comfort radius, the way a player plants their feet to shoot until
// something gets close, and drifts back toward the middle otherwise.
export const FLEE_PX = knobNumber('FLEE_PX', 36)

// It walks over a pickup when nothing is inside its comfort radius, the
// pickup is close, and no zombie stands near the pickup. NO_PICKUPS=1 keeps
// it from ever going for one.
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

// It dodges the boss the way a player who has seen his tells does: out of a
// stomp ring once it winds up, sideways off a charge lane, and out of a glob
// marker or a puddle. It keeps a wider berth from the boss than from the
// horde, since the boss is wider. KITE=1 is the player who never learns the
// tells: it only runs to the far side of the room from the boss and shoots.
const DODGE_MARGIN_PX = knobNumber('DODGE_MARGIN', 10)
const NO_DODGE = isKnobSet('NO_DODGE')
export const KITES = isKnobSet('KITE')
const BOSS_BODY_PX = 12
const PLAYER_BODY_PX = 4

export const bossOf = (model: Model) => {
  const { boss } = model
  return boss._tag === 'Fighting'
    ? Option.getOrUndefined(
        Array.findFirst(walking(model), zombie => zombie.id === boss.id),
      )
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
  distanceToLane(focusOf(model).player, from, direction, length) <
  BOSS_BODY_PX + PLAYER_BODY_PX + DODGE_MARGIN_PX
    ? awayFromLine(from, direction, focusOf(model).player)
    : undefined

// Standing on a glob's mark, it steps across the boss's line of fire, to the
// side with more room from the nearest other zombie.
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

// It steps off a thrown Groaner's landing mark the way it steps off a glob's,
// and keeps clear of the cracks where an Ankle Biter is about to come up.
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
  if (NO_DODGE || KITES || model.boss._tag !== 'Fighting') {
    return undefined
  }
  const boss = bossOf(model)
  const marker = Option.getOrUndefined(
    Array.findFirst(
      model.boss.globs,
      glob =>
        (glob._tag === 'Flying' &&
          distance(focusOf(model).player, glob.to) <
            BOSS_RULES.spitRadius + PLAYER_BODY_PX + DODGE_MARGIN_PX) ||
        (glob._tag === 'Pooled' &&
          distance(focusOf(model).player, glob.at) <
            BOSS_RULES.puddleRadius + 2),
    ),
  )
  if (marker !== undefined) {
    const center = marker._tag === 'Flying' ? marker.to : marker.at
    return distance(focusOf(model).player, center) < 3
      ? clearSide(model, boss ?? { x: center.x, y: center.y - 1 })
      : steerToward(center, focusOf(model).player)
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
          : distance(focusOf(model).player, boss) <
              BOSS_RULES.stompRadius + DODGE_MARGIN_PX
            ? steerToward(boss, focusOf(model).player)
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

export const BOSS_BERTH_PX = knobNumber('BOSS_BERTH', 16)

// A frenzied zombie closes the gap faster, so the bot backs off from it
// sooner, in proportion to the frenzy's extra speed.
export const frenzyBerthPx = () =>
  Math.round(FLEE_PX * (FRENZY_RULES.paceScale - 1))

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

// ENGAGE=1 holds the middle distance from the boss: outside his stomp
// trigger, inside his charge range. It walks into the horde to get there,
// so it does worse than the default, which holds the middle of the room.
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
