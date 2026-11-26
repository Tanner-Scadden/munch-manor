import { Array, Function, Option, Order, pipe } from 'effect'

import {
  DIRECT_CHASE_FULL_PX,
  DIRECT_CHASE_RANGE_PX,
  DOOR_HALF_WIDTH_PX,
  TILE_SIZE,
  ZOMBIE_SPAWN_MARGIN,
} from '../../shared/constants'
import * as DetMath from '../../shared/detMath'
import { countWork } from '../../shared/workCount'
import type { DoorId, Vector } from '../schema/entitySchema'
import type { Toll } from '../schema/worldSchema'
import { resolveCircle } from '../step/collision'
import {
  ZERO_VECTOR,
  addVectors,
  clamp,
  directionBetween,
  normalize,
  scaleVector,
} from '../step/geometry'
import {
  type Level,
  TILE_OPEN_BLOCK,
  TILE_OUTSIDE,
  TILE_SOLID,
  hasTileFlag,
} from './arena'
import { byDoor, tileCenter, tileIndex, tileOfIndex } from './tileGrid'
import {
  doorSpawnPoint,
  hasClearPath,
  isInYardAt,
  isInsideRoomAt,
  isOpenBlock,
  isWalkableTile,
  nearestDoor,
  tileIndexAt,
} from './tileQueries'

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

export type Clearance = 'Narrow' | 'Wide'

export const UNREACHED_DISTANCE = Number.MAX_SAFE_INTEGER

const UNREACHED_TILE = 0x7fffffff

export type FlowField = Readonly<{
  originIndex: number
  moreOrigins: ReadonlyArray<number>
  distances: Int32Array
}>

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

type WalkGraph = Readonly<{ start: Int32Array; adjacent: Int32Array }>

const isStepIntoTheHouse = (level: Level, from: number, to: number): boolean =>
  hasTileFlag(level, from, TILE_OUTSIDE) ||
  !hasTileFlag(level, to, TILE_OUTSIDE)

const YARD_FIELD_TILES = Math.ceil(ZOMBIE_SPAWN_MARGIN / TILE_SIZE) + 2

export const isFieldTile: {
  (column: number, row: number): (level: Level) => boolean
  (level: Level, column: number, row: number): boolean
} = Function.dual(3, (level: Level, column: number, row: number): boolean => {
  if (!hasTileFlag(level, tileIndex(level, column, row), TILE_OUTSIDE)) {
    return true
  }
  const reach = YARD_FIELD_TILES * TILE_SIZE
  const x = column * TILE_SIZE
  const y = row * TILE_SIZE
  return (
    x + TILE_SIZE > level.bounds.left - reach &&
    x < level.bounds.right + reach &&
    y + TILE_SIZE > level.bounds.top - reach &&
    y < level.bounds.bottom + reach
  )
})

const walkGraphFor = (level: Level, clearance: Clearance): WalkGraph => {
  const { columns, rows, tileCount, tileFlags } = level
  const flagsAt = (column: number, row: number): number =>
    column < 0 || row < 0 || column >= columns || row >= rows
      ? 0
      : (tileFlags[row * columns + column] ?? 0)
  const isWalkableAt = (column: number, row: number): boolean =>
    column >= 0 &&
    row >= 0 &&
    column < columns &&
    row < rows &&
    ((tileFlags[row * columns + column] ?? TILE_SOLID) & TILE_SOLID) === 0
  const isOpenBlockAt = (column: number, row: number): boolean =>
    (flagsAt(column, row) & TILE_OPEN_BLOCK) !== 0
  const isInField = new Uint8Array(tileCount)
  for (let index = 0; index < tileCount; index++) {
    const { column, row } = tileOfIndex(level, index)
    isInField[index] = isFieldTile(level, column, row) ? 1 : 0
  }
  const isStepOpen = (
    column: number,
    row: number,
    stepColumn: number,
    stepRow: number,
  ): boolean => {
    if (clearance === 'Narrow') {
      return isWalkableAt(column + stepColumn, row + stepRow)
    }
    const left = Math.min(column, column + stepColumn)
    const top = Math.min(row, row + stepRow)
    return stepRow === 0
      ? isOpenBlockAt(left, row - 1) || isOpenBlockAt(left, row)
      : isOpenBlockAt(column - 1, top) || isOpenBlockAt(column, top)
  }
  const start = new Int32Array(tileCount + 1)
  const adjacent: Array<number> = []
  for (let index = 0; index < tileCount; index++) {
    const column = index % columns
    const row = Math.floor(index / columns)
    const isOutside = ((tileFlags[index] ?? 0) & TILE_OUTSIDE) !== 0
    for (
      let step = 0;
      isInField[index] === 1 && step < STRAIGHT_STEP_COUNT;
      step++
    ) {
      const stepColumn = STEP_COLUMNS[step] ?? 0
      const stepRow = STEP_ROWS[step] ?? 0
      if (!isStepOpen(column, row, stepColumn, stepRow)) {
        continue
      }
      const neighbor = (row + stepRow) * columns + column + stepColumn
      if (
        isInField[neighbor] === 1 &&
        (((tileFlags[neighbor] ?? 0) & TILE_OUTSIDE) !== 0 || !isOutside)
      ) {
        adjacent.push(neighbor)
      }
    }
    start[index + 1] = adjacent.length
  }
  return { start, adjacent: Int32Array.from(adjacent) }
}

type WalkGraphs = Readonly<{ narrow: WalkGraph; wide: WalkGraph }>

const walkGraphsOf = perLevel((level): WalkGraphs => ({
  narrow: walkGraphFor(level, 'Narrow'),
  wide: walkGraphFor(level, 'Wide'),
}))

export const distanceAt: {
  (index: number): (distances: Int32Array) => number
  (distances: Int32Array, index: number): number
} = Function.dual(2, (distances: Int32Array, index: number): number => {
  const distance = distances[index]
  return distance === undefined || distance === UNREACHED_TILE
    ? UNREACHED_DISTANCE
    : distance
})

const spread = (
  level: Level,
  origins: ReadonlyArray<number>,
  clearance: Clearance,
  tolls: ReadonlyArray<Toll>,
): Int32Array => {
  countWork('FlowField')
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

const FIELDS_KEPT = 24

const keptFieldsOf = perLevel((): Map<string, FlowField> => new Map())

const fieldKey = (
  origins: ReadonlyArray<number>,
  clearance: Clearance,
  tolls: ReadonlyArray<Toll>,
): string =>
  `${clearance}|${Array.join(
    Array.map(origins, origin => `${origin}`),
    ',',
  )}|${Array.join(
    Array.map(tolls, ({ index, cost }) => `${index}:${cost}`),
    ',',
  )}`

const fieldFrom = (
  level: Level,
  origins: Array.NonEmptyReadonlyArray<number>,
  clearance: Clearance,
  tolls: ReadonlyArray<Toll>,
): FlowField => {
  const kept = keptFieldsOf(level)
  const key = fieldKey(origins, clearance, tolls)
  const cached = kept.get(key)
  if (cached !== undefined) {
    kept.delete(key)
    kept.set(key, cached)
    return cached
  }
  const field: FlowField = {
    originIndex: Array.headNonEmpty(origins),
    moreOrigins: Array.tailNonEmpty(origins),
    distances: spread(level, origins, clearance, tolls),
  }
  kept.set(key, field)
  if (kept.size > FIELDS_KEPT) {
    for (const oldest of kept.keys()) {
      kept.delete(oldest)
      break
    }
  }
  return field
}

export const flowFieldToward: {
  (
    target: Vector,
    clearance: Clearance,
    tolls: ReadonlyArray<Toll>,
  ): (level: Level) => FlowField
  (
    level: Level,
    target: Vector,
    clearance: Clearance,
    tolls: ReadonlyArray<Toll>,
  ): FlowField
} = Function.dual(
  4,
  (
    level: Level,
    target: Vector,
    clearance: Clearance,
    tolls: ReadonlyArray<Toll>,
  ): FlowField =>
    fieldFrom(level, [tileIndexAt(level, target)], clearance, tolls),
)

export const flowFieldTowardAll: {
  (
    targets: Array.NonEmptyReadonlyArray<Vector>,
    clearance: Clearance,
    tolls: ReadonlyArray<Toll>,
  ): (level: Level) => FlowField
  (
    level: Level,
    targets: Array.NonEmptyReadonlyArray<Vector>,
    clearance: Clearance,
    tolls: ReadonlyArray<Toll>,
  ): FlowField
} = Function.dual(
  4,
  (
    level: Level,
    targets: Array.NonEmptyReadonlyArray<Vector>,
    clearance: Clearance,
    tolls: ReadonlyArray<Toll>,
  ): FlowField =>
    fieldFrom(
      level,
      Array.dedupe(Array.map(targets, target => tileIndexAt(level, target))),
      clearance,
      tolls,
    ),
)

export const flowFieldsToward: {
  (
    targets: Array.NonEmptyReadonlyArray<Vector>,
    tolls: ReadonlyArray<Toll>,
  ): (level: Level) => Readonly<Record<Clearance, FlowField>>
  (
    level: Level,
    targets: Array.NonEmptyReadonlyArray<Vector>,
    tolls: ReadonlyArray<Toll>,
  ): Readonly<Record<Clearance, FlowField>>
} = Function.dual(
  3,
  (
    level: Level,
    targets: Array.NonEmptyReadonlyArray<Vector>,
    tolls: ReadonlyArray<Toll>,
  ): Readonly<Record<Clearance, FlowField>> => ({
    Narrow: flowFieldTowardAll(level, targets, 'Narrow', tolls),
    Wide: flowFieldTowardAll(level, targets, 'Wide', tolls),
  }),
)

const isOriginOf = (flowField: FlowField, index: number): boolean =>
  index === flowField.originIndex ||
  (Array.isReadonlyArrayNonEmpty(flowField.moreOrigins) &&
    Array.contains(flowField.moreOrigins, index))

const downhillSteps = new WeakMap<FlowField, Map<Clearance, Int32Array>>()

const downhillStepsOf = (
  level: Level,
  flowField: FlowField,
  clearance: Clearance,
): Int32Array => {
  const kept = downhillSteps.get(flowField)
  const byClearance = kept ?? new Map<Clearance, Int32Array>()
  if (kept === undefined) {
    downhillSteps.set(flowField, byClearance)
  }
  const known = byClearance.get(clearance)
  if (known !== undefined) {
    return known
  }
  const made = new Int32Array(level.tileCount)
  byClearance.set(clearance, made)
  return made
}

const downhillFrom = (
  level: Level,
  flowField: FlowField,
  index: number,
  clearance: Clearance,
): number => {
  const column = (index % level.columns) + level.leftColumn
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
      isStepIntoTheHouse(level, index, neighbor) &&
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

const downhillTile = (
  level: Level,
  flowField: FlowField,
  position: Vector,
  clearance: Clearance,
): number => {
  const index = tileIndexAt(level, position)
  if (index < 0 || index >= level.tileCount) {
    return downhillFrom(level, flowField, index, clearance)
  }
  const steps = downhillStepsOf(level, flowField, clearance)
  const known = steps[index] ?? 0
  if (known !== 0) {
    return known - 2
  }
  const best = downhillFrom(level, flowField, index, clearance)
  steps[index] = best + 2
  return best
}

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
): Option.Option<Vector> => {
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
  const distance = DetMath.hypot(target.x - position.x, target.y - position.y)
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

export const playerDistancePx: {
  (flowField: FlowField, position: Vector): (level: Level) => number
  (level: Level, flowField: FlowField, position: Vector): number
} = Function.dual(
  3,
  (level: Level, flowField: FlowField, position: Vector): number =>
    distanceAt(flowField.distances, tileIndexAt(level, position)) * TILE_SIZE,
)

export const maybeNearestBait: {
  (
    position: Vector,
    doors: ReadonlyArray<DoorId>,
    clearance: Clearance,
    pullPx: number,
  ): (level: Level) => Option.Option<Bait>
  (
    level: Level,
    position: Vector,
    doors: ReadonlyArray<DoorId>,
    clearance: Clearance,
    pullPx: number,
  ): Option.Option<Bait>
} = Function.dual(
  5,
  (
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
    ),
)

export const steerToBait: {
  (
    door: DoorId,
    position: Vector,
    halfWidth: number,
    clearance: Clearance,
  ): (level: Level) => Vector
  (
    level: Level,
    door: DoorId,
    position: Vector,
    halfWidth: number,
    clearance: Clearance,
  ): Vector
} = Function.dual(
  5,
  (
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
    ),
)

const CORNER_REACHED_PX = 1

type LoopMark = Readonly<{ at: number; point: Vector }>

type LoopSide = Readonly<{ gap: number; at: number }>

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

type DoorOffset = Readonly<{ outwardness: number; sideways: number }>

const doorOffset = (
  outward: Vector,
  from: Vector,
  position: Vector,
): DoorOffset => {
  const offsetX = position.x - from.x
  const offsetY = position.y - from.y
  return {
    outwardness: offsetX * outward.x + offsetY * outward.y,
    sideways: Math.abs(offsetX * outward.y - offsetY * outward.x),
  }
}

const isAtDoor = (level: Level, position: Vector, id: DoorId): boolean => {
  const { center, outward } = level.doors[id]
  const { outwardness, sideways } = doorOffset(outward, center, position)
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

const yardDoorsOf = perLevel((level): ReadonlyArray<DoorId> =>
  Array.filter(level.doorIds, id =>
    isInYardAt(level, doorSpawnPoint(level, id, 0)),
  ),
)

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

const YARD_DOOR_REACH_PX = TILE_SIZE * 2

const isByOpenYardDoor = (
  level: Level,
  position: Vector,
  barricaded: ReadonlyArray<DoorId>,
): boolean =>
  Array.some(
    yardDoorsOf(level),
    id =>
      !Array.contains(barricaded, id) &&
      DetMath.hypot(
        position.x - level.doors[id].edge.x,
        position.y - level.doors[id].edge.y,
      ) <= YARD_DOOR_REACH_PX,
  )

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
    isByOpenYardDoor(level, position, barricaded) ||
    Array.contains(yardDoorsOf(level), bestEntry(level, flowField, position)))

const DOORWAY_LANE_OUT_PX = ZOMBIE_SPAWN_MARGIN + TILE_SIZE
const DOORWAY_LANE_HALF_WIDTH_PX = DOOR_HALF_WIDTH_PX + TILE_SIZE / 2

const isInDoorwayLane = (
  level: Level,
  position: Vector,
  id: DoorId,
): boolean => {
  const { edge, outward } = level.doors[id]
  const { outwardness, sideways } = doorOffset(outward, edge, position)
  return (
    outwardness > 0 &&
    outwardness <= DOORWAY_LANE_OUT_PX &&
    sideways <= DOORWAY_LANE_HALF_WIDTH_PX
  )
}

const maybeDoorwayLane = (
  level: Level,
  position: Vector,
  barricaded: ReadonlyArray<DoorId>,
): Option.Option<DoorId> =>
  isInYardAt(level, position)
    ? Array.findFirst(
        level.doorIds,
        id =>
          !Array.contains(barricaded, id) &&
          isInDoorwayLane(level, position, id),
      )
    : Option.none()

export const steerToward: {
  (
    flowField: FlowField,
    position: Vector,
    target: Vector,
    halfWidth: number,
    clearance: Clearance,
    barricaded: ReadonlyArray<DoorId>,
  ): (level: Level) => Vector
  (
    level: Level,
    flowField: FlowField,
    position: Vector,
    target: Vector,
    halfWidth: number,
    clearance: Clearance,
    barricaded: ReadonlyArray<DoorId>,
  ): Vector
} = Function.dual(
  7,
  (
    level: Level,
    flowField: FlowField,
    position: Vector,
    target: Vector,
    halfWidth: number,
    clearance: Clearance,
    barricaded: ReadonlyArray<DoorId>,
  ): Vector => {
    if (isInsideRoomAt(level, position)) {
      return insideSteering(
        level,
        flowField,
        position,
        target,
        halfWidth,
        clearance,
      )
    }
    return Option.match(maybeDoorwayLane(level, position, barricaded), {
      onSome: door => towardDoor(level, position, door),
      onNone: () =>
        takesTheYard(level, flowField, position, barricaded)
          ? insideSteering(
              level,
              flowField,
              position,
              target,
              halfWidth,
              clearance,
            )
          : outsideSteering(level, flowField, position, barricaded),
    })
  },
)
