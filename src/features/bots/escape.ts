import { Array, Function, Option } from 'effect'

import { PLAYER_RADIUS } from '../../shared/constants'
import {
  type Level,
  TILE_PLAYER_SOLID,
  hasTileFlag,
} from '../../world/level/arena'
import { isInsideRoom, tileIndex } from '../../world/level/tileGrid'
import { tileCoordinate } from '../../world/level/tileQueries'
import type { World } from '../../world/schema/world'
import {
  BossMove,
  type Vector,
  type Zombie,
} from '../../world/schema/worldSchema'
import {
  ZERO_VECTOR,
  closestPointOnSegment,
  directionBetween,
  distanceBetween,
} from '../../world/step/geometry'
import { BOSS_RULES } from '../../world/zombies/bossRules'

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

// UNCLE CHUNK

// How a bot reads Uncle Chunk's tells the way a player who has learned
// them does: out of a stomp's or slam's ring once he winds up, still just
// outside it, sideways off a charge's lane, off a glob's mark and out of a
// puddle. Shared by the teammate bots and the balance bot
// (tools/balance/bot/dodging.ts).

// NOTE: how far a teammate bot keeps from him: inside his far range
// (farPx), past which he spits volleys and charges, and as far out as
// that allows, so his slam's wind-up is a step from clear. Keeping 80 px
// off cost the balance bot escapes (Normal 12 of 100 to 8, 2026-11-11: his
// bites fell from 35 hearts to 3, his globs rose from 8 to 28 and his
// charges from 2 to 11), and 62 px still did (9 of 100), so the balance
// bot keeps its own 52 px.
export const CHUNK_KEEP_PX = BOSS_RULES.farPx - 8
const DODGE_MARGIN_PX = 10
const CHUNK_BODY_PX = 12

// NOTE: Uncle Chunk on his feet, while his fight is on.
const maybeChunk = (world: World): Option.Option<Zombie> => {
  const { boss } = world
  return boss._tag === 'Fighting'
    ? Array.findFirst(
        world.zombies,
        zombie => zombie.id === boss.id && zombie.state._tag === 'Walking',
      )
    : Option.none()
}

const awayFrom = (from: Vector, at: Vector): Vector =>
  Option.getOrElse(directionBetween(from, at), () => unitAt(0, 1))

// NOTE: square to a line from `from` along `direction`, on `at`'s side.
const offLine = (from: Vector, direction: Vector, at: Vector): Vector => {
  const side =
    direction.x * (at.y - from.y) - direction.y * (at.x - from.x) >= 0 ? 1 : -1
  return { x: -direction.y * side, y: direction.x * side }
}

const laneDodge = (
  at: Vector,
  from: Vector,
  direction: Vector,
  length: number,
): Vector | undefined => {
  const end = {
    x: from.x + direction.x * length,
    y: from.y + direction.y * length,
  }
  return distanceBetween(at, closestPointOnSegment(at, from, end)) <
    CHUNK_BODY_PX + PLAYER_RADIUS + DODGE_MARGIN_PX
    ? offLine(from, direction, at)
    : undefined
}

const globMarkAt = (world: World, at: Vector): Vector | undefined => {
  if (world.boss._tag !== 'Fighting') {
    return undefined
  }
  const mark = Array.findFirst(world.boss.globs, glob =>
    glob._tag === 'Flying'
      ? distanceBetween(at, glob.to) <
        BOSS_RULES.spitRadius + PLAYER_RADIUS + DODGE_MARGIN_PX
      : distanceBetween(at, glob.at) < BOSS_RULES.puddleRadius + 2,
  )
  return Option.getOrUndefined(
    Option.map(mark, glob => (glob._tag === 'Flying' ? glob.to : glob.at)),
  )
}

// NOTE: the step a bot at `at` takes off one of his tells, or none with
// no tell on it. Standing still is a step: outside a winding ring it waits
// there rather than walk in.
export const chunkDodge: {
  (at: Vector): (world: World) => Vector | undefined
  (world: World, at: Vector): Vector | undefined
} = Function.dual(2, (world: World, at: Vector): Vector | undefined => {
  if (world.boss._tag !== 'Fighting') {
    return undefined
  }
  const maybeBody = maybeChunk(world)
  const mark = globMarkAt(world, at)
  if (mark !== undefined) {
    return distanceBetween(at, mark) < 3
      ? Option.match(maybeBody, {
          onNone: () => unitAt(0, 1),
          onSome: chunk => offLine(chunk, awayFrom(chunk, at), at),
        })
      : awayFrom(mark, at)
  }
  if (Option.isNone(maybeBody)) {
    return undefined
  }
  const chunk = maybeBody.value
  return BossMove.matchOrElse<Vector | undefined>(
    world.boss.move,
    {
      // NOTE: only a stomp or a slam is a ring on the floor. Through a
      // belch's or a spit's wind-up the bot keeps fighting.
      WindingUp: move =>
        move.attack === 'Stomp' || move.attack === 'Slam'
          ? distanceBetween(at, chunk) <
            (move.attack === 'Slam'
              ? BOSS_RULES.slamRadius
              : BOSS_RULES.stompRadius) +
              DODGE_MARGIN_PX
            ? awayFrom(chunk, at)
            : ZERO_VECTOR
          : undefined,
      Bracing: move =>
        laneDodge(
          at,
          chunk,
          awayFrom(chunk, move.target),
          distanceBetween(chunk, move.target) + BOSS_RULES.chargeOvershootPx,
        ),
      Rushing: move => laneDodge(at, chunk, move.direction, move.remainingPx),
    },
    () => undefined,
  )
})
