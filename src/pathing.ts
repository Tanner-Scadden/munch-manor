import { Array, Option, Order, Result, pipe } from 'effect'

import {
  type Level,
  type Tile,
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
import type { FlowField, Toll } from './worldSchema'

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

const ORTHOGONAL_STEPS: ReadonlyArray<Tile> = [
  { column: 1, row: 0 },
  { column: -1, row: 0 },
  { column: 0, row: 1 },
  { column: 0, row: -1 },
]

const DIAGONAL_STEPS: ReadonlyArray<Tile> = [
  { column: 1, row: 1 },
  { column: 1, row: -1 },
  { column: -1, row: 1 },
  { column: -1, row: -1 },
]

type StepRule = (
  level: Level,
  column: number,
  row: number,
  step: Tile,
) => boolean

const isNarrowStepOpen: StepRule = (level, column, row, step) =>
  isWalkableTile(level, column + step.column, row + step.row) &&
  (step.column === 0 ||
    step.row === 0 ||
    (isWalkableTile(level, column + step.column, row) &&
      isWalkableTile(level, column, row + step.row)))

const isWideStepOpen: StepRule = (level, column, row, step) => {
  const left = Math.min(column, column + step.column)
  const top = Math.min(row, row + step.row)
  if (step.row === 0) {
    return isOpenBlock(level, left, row - 1) || isOpenBlock(level, left, row)
  } else if (step.column === 0) {
    return (
      isOpenBlock(level, column - 1, top) || isOpenBlock(level, column, top)
    )
  } else {
    return isOpenBlock(level, left, top)
  }
}

const STEP_RULES: Readonly<Record<Clearance, StepRule>> = {
  Narrow: isNarrowStepOpen,
  Wide: isWideStepOpen,
}

// NOTE: the flow field covers every walkable tile on the map, the yard too,
// so a zombie in the yard reads it on the way to the door the yard leads to.
// The yard meets the house only at its doors, so the house's own distances
// are the same as a field over the house alone. A zombie past the map's edge
// has no tile, and walks around the house instead (see OUTSIDE).
const openNeighbors = (
  level: Level,
  index: number,
  clearance: Clearance,
): ReadonlyArray<number> => {
  const { column, row } = tileOfIndex(level, index)
  return Array.filterMap(ORTHOGONAL_STEPS, step =>
    STEP_RULES[clearance](level, column, row, step)
      ? Result.succeed(tileIndex(level, column + step.column, row + step.row))
      : Result.failVoid,
  )
}

type Neighbors = Readonly<
  Record<Clearance, ReadonlyArray<ReadonlyArray<number>>>
>

const neighborsOf = perLevel((level): Neighbors => ({
  Narrow: Array.makeBy(level.tileCount, index =>
    openNeighbors(level, index, 'Narrow'),
  ),
  Wide: Array.makeBy(level.tileCount, index =>
    openNeighbors(level, index, 'Wide'),
  ),
}))

const openNeighborsOf = (
  neighbors: Neighbors,
  index: number,
  clearance: Clearance,
): ReadonlyArray<number> =>
  Option.getOrElse(Array.get(neighbors[clearance], index), () => [])

const distanceAt = (distances: ReadonlyArray<number>, index: number): number =>
  Option.getOrElse(Array.get(distances, index), () => UNREACHED_DISTANCE)

type TollMap = ReadonlyMap<number, number>

const tollAt = (tolls: TollMap, index: number): number =>
  Option.getOrElse(Option.fromNullishOr(tolls.get(index)), () => 0)

type Buckets = Map<number, Array<number>>

const nearestDepth = (buckets: Buckets): number =>
  Array.reduce(
    Array.fromIterable(buckets.keys()),
    UNREACHED_DISTANCE,
    (nearest, depth) => Math.min(nearest, depth),
  )

const addArrival = (buckets: Buckets, depth: number, index: number): void => {
  const bucket = buckets.get(depth)
  if (bucket === undefined) {
    buckets.set(depth, [index])
  } else {
    bucket.push(index)
  }
}

// NOTE: the field is a shortest path search with whole tile steps, so it
// settles tiles one distance at a time from a bucket per distance. The
// distances and the buckets are scratch arrays local to one search and
// mutated in place, which keeps a refresh linear in the tile count. Copying
// the whole grid once per ring made a refresh cost a frame on a slow phone
// every time the player crossed a tile.
const spread = (
  level: Level,
  origins: ReadonlyArray<number>,
  clearance: Clearance,
  tolls: TollMap,
): ReadonlyArray<number> => {
  const neighbors = neighborsOf(level)
  const distances = Array.makeBy(level.tileCount, () => UNREACHED_DISTANCE)
  const buckets: Buckets = new Map([[0, Array.copy(origins)]])
  const settleRing = (depth: number): void => {
    const ring = Option.getOrElse(
      Option.fromNullishOr(buckets.get(depth)),
      () => [],
    )
    buckets.delete(depth)
    const ringClearance: Clearance = depth === 0 ? 'Narrow' : clearance
    Array.forEach(ring, index => {
      if (distances[index] !== UNREACHED_DISTANCE) {
        return
      }
      distances[index] = depth
      Array.forEach(
        openNeighborsOf(neighbors, index, ringClearance),
        neighbor => {
          if (distances[neighbor] === UNREACHED_DISTANCE) {
            addArrival(buckets, depth + 1 + tollAt(tolls, neighbor), neighbor)
          }
        },
      )
    })
    if (buckets.size > 0) {
      settleRing(nearestDepth(buckets))
    }
  }
  settleRing(0)
  return distances
}

const computeFlowField = (
  level: Level,
  originIndex: number,
  clearance: Clearance,
  tolls: ReadonlyArray<Toll>,
  moreOrigins: ReadonlyArray<number> = [],
): FlowField => ({
  levelKey: level.key,
  originIndex,
  moreOrigins,
  tolls,
  distances: spread(
    level,
    [originIndex, ...moreOrigins],
    clearance,
    new Map(Array.map(tolls, ({ index, cost }) => [index, cost])),
  ),
})

const fieldFrom = (
  level: Level,
  origins: Array.NonEmptyReadonlyArray<number>,
  clearance: Clearance,
): FlowField => ({
  levelKey: level.key,
  originIndex: Array.headNonEmpty(origins),
  moreOrigins: Array.tailNonEmpty(origins),
  tolls: [],
  distances: spread(level, origins, clearance, new Map()),
})

export const flowFieldToward = (
  level: Level,
  target: Vector,
  clearance: Clearance,
  tolls: ReadonlyArray<Toll>,
): FlowField =>
  computeFlowField(level, tileIndexAt(level, target), clearance, tolls)

const isSameToll = (first: Toll, second: Toll): boolean =>
  first.index === second.index && first.cost === second.cost

const areSameTolls = (
  first: ReadonlyArray<Toll>,
  second: ReadonlyArray<Toll>,
): boolean =>
  first.length === second.length &&
  Array.every(Array.zip(first, second), ([left, right]) =>
    isSameToll(left, right),
  )

// NOTE: the field is kept while the player stays on one tile and the tolls
// hold. It is rebuilt when the level changes, such as an exit opening, since
// its distances are indexed by that level's tiles.
export const refreshFlowField = (
  level: Level,
  flowField: FlowField,
  target: Vector,
  clearance: Clearance,
  tolls: ReadonlyArray<Toll>,
): FlowField => {
  const originIndex = tileIndexAt(level, target)
  if (
    flowField.levelKey === level.key &&
    originIndex === flowField.originIndex &&
    Array.isReadonlyArrayEmpty(flowField.moreOrigins) &&
    areSameTolls(flowField.tolls, tolls)
  ) {
    return flowField
  } else {
    return computeFlowField(level, originIndex, clearance, tolls)
  }
}

const areSameOrigins = (
  first: ReadonlyArray<number>,
  second: ReadonlyArray<number>,
): boolean =>
  first.length === second.length &&
  Array.every(Array.zip(first, second), ([left, right]) => left === right)

// NOTE: in co-op the field flows to every living player at once, one
// breadth-first pass from all their tiles, so each zombie walks downhill to
// whoever is nearest. One target is refreshFlowField exactly.
export const refreshFlowFieldToward = (
  level: Level,
  flowField: FlowField,
  targets: Array.NonEmptyReadonlyArray<Vector>,
  clearance: Clearance,
  tolls: ReadonlyArray<Toll>,
): FlowField => {
  const [first, ...rest] = Array.dedupe(
    Array.map(targets, target => tileIndexAt(level, target)),
  )
  if (Array.isReadonlyArrayEmpty(rest)) {
    return refreshFlowField(
      level,
      flowField,
      Array.headNonEmpty(targets),
      clearance,
      tolls,
    )
  }
  if (
    flowField.levelKey === level.key &&
    first === flowField.originIndex &&
    areSameOrigins(rest, flowField.moreOrigins) &&
    areSameTolls(flowField.tolls, tolls)
  ) {
    return flowField
  }
  return computeFlowField(level, first, clearance, tolls, rest)
}

const isOriginOf = (flowField: FlowField, index: number): boolean =>
  index === flowField.originIndex ||
  (Array.isReadonlyArrayNonEmpty(flowField.moreOrigins) &&
    Array.contains(flowField.moreOrigins, index))

// STEERING

type Step = Readonly<{ index: number; distance: number }>

const isStepOpen = (
  level: Level,
  flowField: FlowField,
  column: number,
  row: number,
  step: Tile,
  clearance: Clearance,
): boolean =>
  STEP_RULES[clearance](level, column, row, step) ||
  (isOriginOf(
    flowField,
    tileIndex(level, column + step.column, row + step.row),
  ) &&
    isNarrowStepOpen(level, column, row, step))

const downhillStep = (
  level: Level,
  flowField: FlowField,
  position: Vector,
  clearance: Clearance,
): Option.Option<Step> => {
  const index = tileIndexAt(level, position)
  const { column, row } = tileOfIndex(level, index)
  const here = distanceAt(flowField.distances, index)
  return pipe(
    [...ORTHOGONAL_STEPS, ...DIAGONAL_STEPS],
    Array.filter(step =>
      isStepOpen(level, flowField, column, row, step, clearance),
    ),
    Array.map(step => {
      const neighborIndex = tileIndex(
        level,
        column + step.column,
        row + step.row,
      )
      return {
        index: neighborIndex,
        distance: distanceAt(flowField.distances, neighborIndex),
      }
    }),
    Array.reduce(Option.none<Step>(), (best, step) =>
      step.distance < here &&
      Option.match(best, {
        onNone: () => true,
        onSome: ({ distance }) => step.distance < distance,
      })
        ? Option.some(step)
        : best,
    ),
  )
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
  Option.flatMap(
    downhillStep(level, flowField, position, clearance),
    ({ index }) =>
      directionBetween(
        position,
        waypointFor(level, index, halfWidth, clearance),
      ),
  )

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
      Narrow: computeFlowField(level, 0, 'Narrow', []),
      Wide: computeFlowField(level, 0, 'Wide', []),
    }),
    onNonEmpty: origins => ({
      Narrow: fieldFrom(level, origins, 'Narrow'),
      Wide: fieldFrom(level, origins, 'Wide'),
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
