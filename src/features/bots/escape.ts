import { Array, Function, Option } from 'effect'

import { PLAYER_RADIUS } from '../../shared/constants'
import {
  type Level,
  TILE_PLAYER_SOLID,
  hasTileFlag,
  isInsideRoom,
  tileCoordinate,
  tileIndex,
} from '../../world/level/arena'
import type { Vector } from '../../world/schema/worldSchema'
import {
  ZERO_VECTOR,
  closestPointOnSegment,
  directionBetween,
  distanceBetween,
} from '../../world/step/geometry'

// Where a bot runs when zombies come close: the way a smart player would,
// not straight back into a wall. It tries headings all round and scores
// each by how far it can really walk that way, how far the spot it lands on
// is from every zombie near it, whether the way brushes past one, and how
// open that spot is (a corner is not). So a bot with its back to a wall
// slides along it, and a bot in a corner slips out through the widest gap
// in the crowd instead of sitting there. Pure and without dice, shared by
// the teammate bots (src/features/bots/teammateBot.ts) and the balance bot.

// TUNING

const HEADINGS = 16
const LOOK_PX = 40
const PROBE_STEP_PX = 4
const OPEN_LOOK_PX = 20
const OPEN_HEADINGS = 8
const PASS_MARGIN_PX = 3

// NOTE: how much each part of a heading's score counts: the room it lands
// in, the way on from there, how far it gets, and a little for keeping on straight away from the
// danger, so the pick holds steady from frame to frame.
const OPEN_WEIGHT = 24
const ONWARD_WEIGHT = 30
const REACH_WEIGHT = 0.3
const AWAY_WEIGHT = 6
const BRUSH_PENALTY = 60

export type Threat = Readonly<{ at: Vector; radius: number }>

const unitAt = (index: number, count: number): Vector => {
  const angle = (index / count) * Math.PI * 2
  return { x: Math.cos(angle), y: Math.sin(angle) }
}

const HEADING_UNITS: ReadonlyArray<Vector> = Array.map(
  Array.range(0, HEADINGS - 1),
  index => unitAt(index, HEADINGS),
)

const OPEN_UNITS: ReadonlyArray<Vector> = Array.map(
  Array.range(0, OPEN_HEADINGS - 1),
  index => unitAt(index, OPEN_HEADINGS),
)

const isBlocked = (level: Level, x: number, y: number): boolean => {
  const column = tileCoordinate(x)
  const row = tileCoordinate(y)
  return (
    !isInsideRoom(level, column, row) ||
    hasTileFlag(level, tileIndex(level, column, row), TILE_PLAYER_SOLID)
  )
}

// NOTE: how far a player's body can walk from `from` along `unit`, up to
// `limit`: the center and both shoulders must stay off solid tiles.
const freeLength = (
  level: Level,
  from: Vector,
  unit: Vector,
  limit: number,
): number => {
  const sideX = -unit.y * PLAYER_RADIUS
  const sideY = unit.x * PLAYER_RADIUS
  let reached = 0
  for (let length = PROBE_STEP_PX; length <= limit; length += PROBE_STEP_PX) {
    const x = from.x + unit.x * length
    const y = from.y + unit.y * length
    if (
      isBlocked(
        level,
        x + unit.x * PLAYER_RADIUS,
        y + unit.y * PLAYER_RADIUS,
      ) ||
      isBlocked(level, x + sideX, y + sideY) ||
      isBlocked(level, x - sideX, y - sideY)
    ) {
      return reached
    }
    reached = length
  }
  return reached
}

// NOTE: what the spot a heading lands on leaves the bot. `open` is the
// share of directions it could walk a little way from there: 1 in the open,
// about a quarter in a corner. `onward` is how well it could keep running
// from there, away from the zombie nearest that spot: near 1 with a clear
// way on, below 0 in a dead end, where every way out leads back toward it.
const prospectAt = (
  level: Level,
  at: Vector,
  away: Vector,
): Readonly<{ open: number; onward: number }> => {
  let open = 0
  let onward = -1
  for (const unit of OPEN_UNITS) {
    if (freeLength(level, at, unit, OPEN_LOOK_PX) >= OPEN_LOOK_PX) {
      open += 1
      onward = Math.max(onward, unit.x * away.x + unit.y * away.y)
    }
  }
  return { open: open / OPEN_HEADINGS, onward }
}

const gapTo = (at: Vector, threat: Threat): number =>
  distanceBetween(at, threat.at) - threat.radius

// NOTE: the heading to run with zombies close: a unit vector, or zero with
// no threats.
export const escapeHeading: {
  (from: Vector, threats: ReadonlyArray<Threat>): (level: Level) => Vector
  (level: Level, from: Vector, threats: ReadonlyArray<Threat>): Vector
} = Function.dual(
  3,
  (level: Level, from: Vector, threats: ReadonlyArray<Threat>): Vector => {
    const maybeNearest = Array.reduce(
      threats,
      Option.none<Threat>(),
      (nearest, threat) =>
        Option.match(nearest, {
          onNone: () => Option.some(threat),
          onSome: held =>
            gapTo(from, threat) < gapTo(from, held)
              ? Option.some(threat)
              : nearest,
        }),
    )
    if (Option.isNone(maybeNearest)) {
      return ZERO_VECTOR
    }
    const away = Option.getOrElse(
      directionBetween(maybeNearest.value.at, from),
      () => unitAt(0, 1),
    )
    let best = away
    let bestScore = Number.NEGATIVE_INFINITY
    for (const unit of HEADING_UNITS) {
      const reach = freeLength(level, from, unit, LOOK_PX)
      if (reach < PROBE_STEP_PX) {
        continue
      }
      const landing = { x: from.x + unit.x * reach, y: from.y + unit.y * reach }
      let clearance = Number.POSITIVE_INFINITY
      let closest = maybeNearest.value
      let brushes = false
      for (const threat of threats) {
        const gap = gapTo(landing, threat)
        if (gap < clearance) {
          clearance = gap
          closest = threat
        }
        const passing = distanceBetween(
          closestPointOnSegment(threat.at, from, landing),
          threat.at,
        )
        // NOTE: a zombie the bot is already touching does not block the way
        // out; one it would walk into does.
        if (
          passing - threat.radius < PLAYER_RADIUS + PASS_MARGIN_PX &&
          gapTo(from, threat) > PLAYER_RADIUS + PASS_MARGIN_PX
        ) {
          brushes = true
        }
      }
      const { open, onward } = prospectAt(
        level,
        landing,
        Option.getOrElse(directionBetween(closest.at, landing), () => unit),
      )
      const score =
        clearance +
        open * OPEN_WEIGHT +
        onward * ONWARD_WEIGHT +
        reach * REACH_WEIGHT +
        (unit.x * away.x + unit.y * away.y) * AWAY_WEIGHT -
        (brushes ? BRUSH_PENALTY : 0)
      if (score > bestScore) {
        bestScore = score
        best = unit
      }
    }
    return best
  },
)
