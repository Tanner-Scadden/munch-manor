import { Array, Option, Order, pipe } from 'effect'

import {
  type Level,
  byDoor,
  doorSpawnPoint,
  hasClearPath,
  isInYardAt,
  isInsideRoomAt,
  isOpenBlock,
  isWalkableTile,
  nearestDoor,
  resolveCircle,
  tileCenter,
  tileIndex,
  tileIndexAt,
  tileOfIndex,
} from './arena'
import {
  DIRECT_CHASE_FULL_PX,
  DIRECT_CHASE_RANGE_PX,
  DOOR_HALF_WIDTH_PX,
  TILE_SIZE,
  ZOMBIE_SPAWN_MARGIN,
} from './constants'
import type { DoorId, Vector } from './entitySchema'
import {
  ZERO_VECTOR,
  addVectors,
  clamp,
  directionBetween,
  normalize,
  scaleVector,
} from './geometry'
import type { Toll } from './worldSchema'

// PER LEVEL

// NOTE: what pathing derives from a level is built the first time that
// level is asked for and kept beside it. A frame never rebuilds it, and a
// level with another exit open is another Level, so it gets its own.
const perLevel = <A>(build: (level: Level) => A): ((level: Level) => A) => {
  const built = new WeakMap<Level, A>()
  return level => {
    const cached = built.get(level)
    if (cached !== undefined) {
      return cached
    }
    const made = build(level)
    built.set(level, made)
    return made
  }
}

// FLOW FIELD

export type Clearance = 'Narrow' | 'Wide'

export const UNREACHED_DISTANCE = Number.MAX_SAFE_INTEGER

// NOTE: what a field stores for a tile it never reached. Readers get
// UNREACHED_DISTANCE through distanceAt, so every comparison and sum made on
// a distance is the one it always was.
const UNREACHED_TILE = 0x7fffffff

// NOTE: every tile's distance, in whole tile steps and tolls, to the nearest
// origin. originIndex is the tile the field flows to. In co-op the field
// flows to every living player at once: the other players' tiles are
// moreOrigins. A field is built where it is read, on the frame, from the
// players' tiles and the traps' tolls: nothing keeps one.
export type FlowField = Readonly<{
  originIndex: number
  moreOrigins: ReadonlyArray<number>
  distances: Int32Array
}>

// NOTE: the eight steps a zombie may take, the four straight ones first.
// The flow field spreads over the straight ones only.
const STEP_COUNT = 8
const STRAIGHT_STEP_COUNT = 4
const STEP_COLUMNS = Int8Array.of(1, -1, 0, 0, 1, 1, -1, -1)
const STEP_ROWS = Int8Array.of(0, 0, 1, -1, 1, -1, 1, -1)

const isNarrowStepOpen = (
  level: Level,
  column: number,
  row: number,
  stepColumn: number,
  stepRow: number,
): boolean =>
  isWalkableTile(level, column + stepColumn, row + stepRow) &&
  (stepColumn === 0 ||
    stepRow === 0 ||
    (isWalkableTile(level, column + stepColumn, row) &&
      isWalkableTile(level, column, row + stepRow)))

const isWideStepOpen = (
  level: Level,
  column: number,
  row: number,
  stepColumn: number,
  stepRow: number,
): boolean => {
  const left = Math.min(column, column + stepColumn)
  const top = Math.min(row, row + stepRow)
  if (stepRow === 0) {
    return isOpenBlock(level, left, row - 1) || isOpenBlock(level, left, row)
  } else if (stepColumn === 0) {
    return (
      isOpenBlock(level, column - 1, top) || isOpenBlock(level, column, top)
    )
  } else {
    return isOpenBlock(level, left, top)
  }
}

const isClearanceStepOpen = (
  level: Level,
  clearance: Clearance,
  column: number,
  row: number,
  stepColumn: number,
  stepRow: number,
): boolean =>
  clearance === 'Wide'
    ? isWideStepOpen(level, column, row, stepColumn, stepRow)
    : isNarrowStepOpen(level, column, row, stepColumn, stepRow)

// NOTE: the flow field covers every walkable tile on the map, the yard too,
// so a zombie in the yard reads it on the way to the door the yard leads to.
// The yard meets the house only at its doors, so the house's own distances
// are the same as a field over the house alone. A zombie past the map's edge
// has no tile, and walks around the house instead (see OUTSIDE).
//
// A level's walks are fixed, so each is laid out once with the level, in
// compressed rows: the tiles one step from a tile are
// adjacent[start[tile]] up to adjacent[start[tile + 1]].
type WalkGraph = Readonly<{ start: Int32Array; adjacent: Int32Array }>

const walkGraphFor = (level: Level, clearance: Clearance): WalkGraph => {
  const start = new Int32Array(level.tileCount + 1)
  const adjacent: Array<number> = []
  for (let index = 0; index < level.tileCount; index++) {
    const { column, row } = tileOfIndex(level, index)
    for (let step = 0; step < STRAIGHT_STEP_COUNT; step++) {
      const stepColumn = STEP_COLUMNS[step] ?? 0
      const stepRow = STEP_ROWS[step] ?? 0
      if (
        isClearanceStepOpen(level, clearance, column, row, stepColumn, stepRow)
      ) {
        adjacent.push(tileIndex(level, column + stepColumn, row + stepRow))
      }
    }
    start[index + 1] = adjacent.length
  }
  return { start, adjacent: Int32Array.from(adjacent) }
}

type WalkGraphs = Readonly<{ narrow: WalkGraph; wide: WalkGraph }>

const walkGraphsOf = perLevel(
  (level): WalkGraphs => ({
    narrow: walkGraphFor(level, 'Narrow'),
    wide: walkGraphFor(level, 'Wide'),
  }),
)

export const distanceAt = (distances: Int32Array, index: number): number => {
  const distance = distances[index]
  return distance === undefined || distance === UNREACHED_TILE
    ? UNREACHED_DISTANCE
    : distance
}

// NOTE: the field is a shortest path search with whole tile steps, so it
// settles tiles one distance at a time. A tile stepped onto at a shorter
// distance than it was reached by before waits in a bucket for that
// distance, a list in two queue arrays. A step adds at most the largest toll
// plus one, so a ring of one more buckets than that holds every distance in
// flight. The order within a bucket never changes a distance.
const spread = (
  level: Level,
  origins: ReadonlyArray<number>,
  clearance: Clearance,
  tolls: ReadonlyArray<Toll>,
): Int32Array => {
  const graphs = walkGraphsOf(level)
  const chosen = clearance === 'Wide' ? graphs.wide : graphs.narrow
  const distances = new Int32Array(level.tileCount).fill(UNREACHED_TILE)
  const reached = new Int32Array(level.tileCount).fill(UNREACHED_TILE)
  const tollByTile = new Int32Array(level.tileCount)
  let largestToll = 0
  for (const { index, cost } of tolls) {
    if (index >= 0 && index < level.tileCount) {
      tollByTile[index] = cost
      largestToll = Math.max(largestToll, cost)
    }
  }
  const ring = largestToll + 2
  const buckets = new Int32Array(ring).fill(-1)
  let queueTiles = new Int32Array(level.tileCount + origins.length)
  let queueNext = new Int32Array(queueTiles.length)
  let used = 0
  let pending = 0
  const wait = (depth: number, tile: number): void => {
    if (used === queueTiles.length) {
      const grownTiles = new Int32Array(used * 2)
      grownTiles.set(queueTiles)
      queueTiles = grownTiles
      const grownNext = new Int32Array(used * 2)
      grownNext.set(queueNext)
      queueNext = grownNext
    }
    const bucket = depth % ring
    queueTiles[used] = tile
    queueNext[used] = buckets[bucket] ?? -1
    buckets[bucket] = used
    used++
    pending++
  }
  for (const origin of origins) {
    wait(0, origin)
  }
  for (let depth = 0; pending > 0; depth++) {
    const bucket = depth % ring
    const graph = depth === 0 ? graphs.narrow : chosen
    let entry = buckets[bucket] ?? -1
    buckets[bucket] = -1
    while (entry !== -1) {
      const tile = queueTiles[entry] ?? 0
      const following = queueNext[entry] ?? -1
      pending--
      if (distances[tile] === UNREACHED_TILE) {
        distances[tile] = depth
        const last = graph.start[tile + 1] ?? 0
        for (let edge = graph.start[tile] ?? 0; edge < last; edge++) {
          const neighbor = graph.adjacent[edge] ?? 0
          const arrival = depth + 1 + (tollByTile[neighbor] ?? 0)
          if (
            distances[neighbor] === UNREACHED_TILE &&
            arrival < (reached[neighbor] ?? UNREACHED_TILE)
          ) {
            reached[neighbor] = arrival
            wait(arrival, neighbor)
          }
        }
      }
      entry = following
    }
  }
  return distances
}

const fieldFrom = (
  level: Level,
  origins: Array.NonEmptyReadonlyArray<number>,
  clearance: Clearance,
  tolls: ReadonlyArray<Toll>,
): FlowField => ({
  originIndex: Array.headNonEmpty(origins),
  moreOrigins: Array.tailNonEmpty(origins),
  distances: spread(level, origins, clearance, tolls),
})

export const flowFieldToward = (
  level: Level,
  target: Vector,
  clearance: Clearance,
  tolls: ReadonlyArray<Toll>,
): FlowField => fieldFrom(level, [tileIndexAt(level, target)], clearance, tolls)

// NOTE: in co-op the field flows to every living player at once, one pass
// from all their tiles, so each zombie walks downhill to whoever is nearest.
// One target is flowFieldToward exactly. Both clearances are laid out from
// the same tiles and tolls.
export const flowFieldsToward = (
  level: Level,
  targets: Array.NonEmptyReadonlyArray<Vector>,
  tolls: ReadonlyArray<Toll>,
): Readonly<Record<Clearance, FlowField>> => {
  const origins = Array.dedupe(
    Array.map(targets, target => tileIndexAt(level, target)),
  )
  return {
    Narrow: fieldFrom(level, origins, 'Narrow', tolls),
    Wide: fieldFrom(level, origins, 'Wide', tolls),
  }
}

const isOriginOf = (flowField: FlowField, index: number): boolean =>
  index === flowField.originIndex ||
  (Array.isReadonlyArrayNonEmpty(flowField.moreOrigins) &&
    Array.contains(flowField.moreOrigins, index))

// STEERING

// NOTE: the tile a zombie at this position steps to, the neighbor with the
// shortest distance when that is shorter than its own, or -1. The first of
// the eight steps wins a tie.
const downhillTile = (
  level: Level,
  flowField: FlowField,
  position: Vector,
  clearance: Clearance,
): number => {
  const index = tileIndexAt(level, position)
  const column = index % level.columns
  const row = Math.floor(index / level.columns) + level.topRow
  let best = -1
  let bestDistance = distanceAt(flowField.distances, index)
  for (let step = 0; step < STEP_COUNT; step++) {
    const stepColumn = STEP_COLUMNS[step] ?? 0
    const stepRow = STEP_ROWS[step] ?? 0
    const neighbor = tileIndex(level, column + stepColumn, row + stepRow)
    const distance = distanceAt(flowField.distances, neighbor)
    if (
      distance < bestDistance &&
      (isClearanceStepOpen(
        level,
        clearance,
        column,
        row,
        stepColumn,
        stepRow,
      ) ||
        (isOriginOf(flowField, neighbor) &&
          isNarrowStepOpen(level, column, row, stepColumn, stepRow)))
    ) {
      best = neighbor
      bestDistance = distance
    }
  }
  return best
}

// NOTE: a wide walker cannot reach the middle of a tile beside a wall, so it
// aims at the nearest spot its body fits. Aiming at the tile's middle pins it
// on the corner of a crate it is trying to round.
const waypointFor = (
  level: Level,
  index: number,
  halfWidth: number,
  clearance: Clearance,
): Vector => {
  const center = tileCenter(tileOfIndex(level, index))
  return clearance === 'Wide'
    ? resolveCircle(level, center, halfWidth + 1)
    : center
}

const flowDirection = (
  level: Level,
  flowField: FlowField,
  position: Vector,
  halfWidth: number,
  clearance: Clearance,
): Option.Option<Vector> =>
{
  const tile = downhillTile(level, flowField, position, clearance)
  return tile === -1
    ? Option.none()
    : directionBetween(position, waypointFor(level, tile, halfWidth, clearance))
}

const directWeight = (distance: number): number =>
  clamp(
    (DIRECT_CHASE_RANGE_PX - distance) /
      (DIRECT_CHASE_RANGE_PX - DIRECT_CHASE_FULL_PX),
    0,
    1,
  )

const insideSteering = (
  level: Level,
  flowField: FlowField,
  position: Vector,
  target: Vector,
  halfWidth: number,
  clearance: Clearance,
): Vector => {
  const direct = Option.getOrElse(
    directionBetween(position, target),
    () => ZERO_VECTOR,
  )
  const distance = Math.hypot(target.x - position.x, target.y - position.y)
  return Option.match(
    flowDirection(level, flowField, position, halfWidth, clearance),
    {
      onNone: () => direct,
      onSome: flow => {
        const weight =
          distance < DIRECT_CHASE_RANGE_PX &&
          hasClearPath(level, position, target, halfWidth)
            ? directWeight(distance)
            : 0
        return Option.getOrElse(
          normalize(
            addVectors(
              scaleVector(flow, 1 - weight),
              scaleVector(direct, weight),
            ),
          ),
          () => direct,
        )
      },
    },
  )
}

// BAIT

type BaitFields = Readonly<Record<Clearance, FlowField>>

const baitFieldsFor = (level: Level, door: DoorId): BaitFields =>
  Array.match(level.thresholds[door].indices, {
    onEmpty: () => ({
      Narrow: fieldFrom(level, [0], 'Narrow', []),
      Wide: fieldFrom(level, [0], 'Wide', []),
    }),
    onNonEmpty: origins => ({
      Narrow: fieldFrom(level, origins, 'Narrow', []),
      Wide: fieldFrom(level, origins, 'Wide', []),
    }),
  })

// NOTE: a barricade never moves, so each doorway's field toward its inner
// face is built once per level. A zombie drawn to a Plank Pile reads the
// field of that doorway, and nothing is recomputed when planks go up or
// break.
const baitFieldsOf = perLevel((level): Readonly<Record<DoorId, BaitFields>> =>
  byDoor(door => baitFieldsFor(level, door)),
)

type Bait = Readonly<{ door: DoorId; distancePx: number }>

const baitDistancePx = (
  level: Level,
  door: DoorId,
  position: Vector,
  clearance: Clearance,
): number =>
  distanceAt(
    baitFieldsOf(level)[door][clearance].distances,
    tileIndexAt(level, position),
  ) * TILE_SIZE

export const playerDistancePx = (
  level: Level,
  flowField: FlowField,
  position: Vector,
): number =>
  distanceAt(flowField.distances, tileIndexAt(level, position)) * TILE_SIZE

export const maybeNearestBait = (
  level: Level,
  position: Vector,
  doors: ReadonlyArray<DoorId>,
  clearance: Clearance,
  pullPx: number,
): Option.Option<Bait> =>
  pipe(
    doors,
    Array.map(door => ({
      door,
      distancePx: baitDistancePx(level, door, position, clearance),
    })),
    Array.filter(({ distancePx }) => distancePx <= pullPx),
    Array.sort(
      Order.mapInput(Order.Number, ({ distancePx }: Bait) => distancePx),
    ),
    Array.head,
  )

export const steerToBait = (
  level: Level,
  door: DoorId,
  position: Vector,
  halfWidth: number,
  clearance: Clearance,
): Vector =>
  Option.getOrElse(
    flowDirection(
      level,
      baitFieldsOf(level)[door][clearance],
      position,
      halfWidth,
      clearance,
    ),
    () =>
      Option.getOrElse(
        directionBetween(position, level.doors[door].center),
        () => ZERO_VECTOR,
      ),
  )

// OUTSIDE

const CORNER_REACHED_PX = 1

type LoopMark = Readonly<{ at: number; point: Vector }>

type LoopSide = Readonly<{ gap: number; at: number }>

// NOTE: the loop is the path just outside a level's walls that a zombie
// walks around to reach an open door. It is the open part of the level, its
// bounds, plus the spawn margin on every side, so it hugs the parlour while
// the kitchen is shut.
type LoopBounds = Readonly<{
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}>

type Loop = LoopBounds &
  Readonly<{
    length: number
    corners: ReadonlyArray<LoopMark>
    doorMarks: Readonly<Record<DoorId, LoopMark>>
  }>

const loopPositionOf = (loop: LoopBounds, { x, y }: Vector): number => {
  const alongX = clamp(x, loop.left, loop.right)
  const alongY = clamp(y, loop.top, loop.bottom)
  const sides: Array.NonEmptyReadonlyArray<LoopSide> = [
    { gap: Math.abs(y - loop.top), at: alongX - loop.left },
    { gap: Math.abs(x - loop.right), at: loop.width + alongY - loop.top },
    {
      gap: Math.abs(y - loop.bottom),
      at: loop.width + loop.height + loop.right - alongX,
    },
    {
      gap: Math.abs(x - loop.left),
      at: loop.width * 2 + loop.height + loop.bottom - alongY,
    },
  ]
  return Array.reduce(sides, Array.headNonEmpty(sides), (nearest, side) =>
    side.gap < nearest.gap ? side : nearest,
  ).at
}

const loopOf = perLevel((level): Loop => {
  const left = level.bounds.left - ZOMBIE_SPAWN_MARGIN
  const top = level.bounds.top - ZOMBIE_SPAWN_MARGIN
  const right = level.bounds.right + ZOMBIE_SPAWN_MARGIN
  const bottom = level.bounds.bottom + ZOMBIE_SPAWN_MARGIN
  const bounds: LoopBounds = {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  }
  const doorMark = (id: DoorId): LoopMark => {
    const point = doorSpawnPoint(level, id, 0)
    return { at: loopPositionOf(bounds, point), point }
  }
  return {
    ...bounds,
    length: (bounds.width + bounds.height) * 2,
    corners: [
      { at: 0, point: { x: left, y: top } },
      { at: bounds.width, point: { x: right, y: top } },
      { at: bounds.width + bounds.height, point: { x: right, y: bottom } },
      {
        at: bounds.width * 2 + bounds.height,
        point: { x: left, y: bottom },
      },
    ],
    doorMarks: byDoor(doorMark),
  }
})

const forwardGap = (loop: Loop, from: number, to: number): number =>
  (((to - from) % loop.length) + loop.length) % loop.length

type LoopLeg = Readonly<{ distance: number; isClockwise: boolean }>

const loopLeg = (loop: Loop, from: number, to: number): LoopLeg => {
  const clockwise = forwardGap(loop, from, to)
  const counterClockwise = forwardGap(loop, to, from)
  return clockwise <= counterClockwise
    ? { distance: clockwise, isClockwise: true }
    : { distance: counterClockwise, isClockwise: false }
}

const nextWaypoint = (
  loop: Loop,
  from: number,
  destination: LoopMark,
): Vector => {
  const leg = loopLeg(loop, from, destination.at)
  const gapAhead = (at: number): number =>
    leg.isClockwise ? forwardGap(loop, from, at) : forwardGap(loop, at, from)
  return pipe(
    loop.corners,
    Array.filter(corner => {
      const gap = gapAhead(corner.at)
      return gap > CORNER_REACHED_PX && gap < leg.distance
    }),
    Array.sort(
      Order.mapInput(Order.Number, (corner: LoopMark) => gapAhead(corner.at)),
    ),
    Array.head,
    Option.match({
      onNone: () => destination.point,
      onSome: corner => corner.point,
    }),
  )
}

const isAtDoor = (level: Level, position: Vector, id: DoorId): boolean => {
  const { center, outward } = level.doors[id]
  const offsetX = position.x - center.x
  const offsetY = position.y - center.y
  const outwardness = offsetX * outward.x + offsetY * outward.y
  const sideways = Math.abs(offsetX * outward.y - offsetY * outward.x)
  return outwardness > 0 && sideways <= DOOR_HALF_WIDTH_PX
}

const doorEntryDistance = (
  level: Level,
  flowField: FlowField,
  id: DoorId,
): number =>
  Array.reduce(
    level.doorTileIndices[id],
    UNREACHED_DISTANCE,
    (nearest, index) =>
      Math.min(nearest, distanceAt(flowField.distances, index)),
  )

type Entry = Readonly<{ door: DoorId; cost: number }>

const entryCost = (
  level: Level,
  flowField: FlowField,
  from: number,
  door: DoorId,
): number => {
  const loop = loopOf(level)
  return (
    loopLeg(loop, from, loop.doorMarks[door].at).distance / TILE_SIZE +
    doorEntryDistance(level, flowField, door)
  )
}

const bestEntry = (
  level: Level,
  flowField: FlowField,
  position: Vector,
): DoorId => {
  const here = loopPositionOf(loopOf(level), position)
  return pipe(
    level.doorIds,
    Array.reduce(Option.none<Entry>(), (best, door): Option.Option<Entry> => {
      const cost = entryCost(level, flowField, here, door)
      return Option.match(best, {
        onNone: () => Option.some({ door, cost }),
        onSome: current =>
          cost < current.cost ? Option.some({ door, cost }) : best,
      })
    }),
    Option.match({
      onNone: () => nearestDoor(level, position).id,
      onSome: ({ door }) => door,
    }),
  )
}

const towardDoor = (level: Level, position: Vector, id: DoorId): Vector =>
  Option.getOrElse(
    directionBetween(position, level.doors[id].center),
    () => ZERO_VECTOR,
  )

const isWithinBounds = (level: Level, { x, y }: Vector): boolean =>
  x > level.bounds.left &&
  x < level.bounds.right &&
  y > level.bounds.top &&
  y < level.bounds.bottom

// NOTE: a zombie in the yard is inside the manor's bounds, where the loop's
// corners lie across the kitchen roof. It walks back out the way its nearest
// door faces until it is past the bounds, then takes the loop.
const leaveYard = (level: Level, position: Vector): Vector =>
  nearestDoor(level, position).outward

const routeAround = (
  level: Level,
  flowField: FlowField,
  position: Vector,
  maybeHere: Option.Option<DoorId>,
): Vector => {
  const entry = bestEntry(level, flowField, position)
  if (Option.contains(maybeHere, entry)) {
    return towardDoor(level, position, entry)
  } else if (isWithinBounds(level, position)) {
    return leaveYard(level, position)
  }

  const loop = loopOf(level)
  return Option.getOrElse(
    directionBetween(
      position,
      nextWaypoint(loop, loopPositionOf(loop, position), loop.doorMarks[entry]),
    ),
    () => towardDoor(level, position, entry),
  )
}

// NOTE: outside the house, a zombie at a door that is not boarded walks in;
// anywhere else it walks the loop around the house to its best way in. It
// used to head straight for the nearest door when nothing was boarded,
// which, knocked past the map's edge (by the Clang Pan, say), walked it into
// the house's corner and stuck it there.
const outsideSteering = (
  level: Level,
  flowField: FlowField,
  position: Vector,
  barricaded: ReadonlyArray<DoorId>,
): Vector => {
  const maybeHere = Array.findFirst(level.doorIds, id =>
    isAtDoor(level, position, id),
  )
  return Option.match(maybeHere, {
    onNone: () => routeAround(level, flowField, position, maybeHere),
    onSome: here =>
      Array.contains(barricaded, here)
        ? routeAround(level, flowField, position, maybeHere)
        : towardDoor(level, position, here),
  })
}

// NOTE: the doors the yard leads to: those whose spawn point stands in the
// yard, like the parlour's north door in the manor.
const yardDoorsOf = perLevel((level): ReadonlyArray<DoorId> =>
  Array.filter(level.doorIds, id =>
    isInYardAt(level, doorSpawnPoint(level, id, 0)),
  ),
)

// NOTE: a zombie in the yard follows the flow field to the yard's door when
// that is its way in: always while no door is boarded, or when its best
// entry is a yard door. Otherwise it leaves the yard and walks around. The
// yard used to be steered by the outside rules alone, which walk straight
// lines and leave the yard's walls out: a zombie whose way in was the north
// door was sent out of the yard, then back toward the door, forever.
const takesTheYard = (
  level: Level,
  flowField: FlowField,
  position: Vector,
  barricaded: ReadonlyArray<DoorId>,
): boolean =>
  isInYardAt(level, position) &&
  distanceAt(flowField.distances, tileIndexAt(level, position)) <
    UNREACHED_DISTANCE &&
  (Array.isReadonlyArrayEmpty(barricaded) ||
    Array.contains(yardDoorsOf(level), bestEntry(level, flowField, position)))

export const steerToward = (
  level: Level,
  flowField: FlowField,
  position: Vector,
  target: Vector,
  halfWidth: number,
  clearance: Clearance,
  barricaded: ReadonlyArray<DoorId>,
): Vector => {
  if (
    isInsideRoomAt(level, position) ||
    takesTheYard(level, flowField, position, barricaded)
  ) {
    return insideSteering(
      level,
      flowField,
      position,
      target,
      halfWidth,
      clearance,
    )
  } else {
    return outsideSteering(level, flowField, position, barricaded)
  }
}
