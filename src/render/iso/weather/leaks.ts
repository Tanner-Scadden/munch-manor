import { Array, Option, Order, pipe } from 'effect'

import { beamReach } from '#render/bodies/cellarDark.ts'
import type * as Draw from '#render/draw.ts'
import { rect } from '#render/drawing.ts'
import type { TileQuad } from '#render/iso/house/house.ts'
import {
  FLAME_TUNING,
  type FlameKind,
  type FlameSpec,
  flameSpecsOf,
  isFlameLit,
} from '#render/iso/light/lightSpecs.ts'
import { mixColor, strikeOf } from '#render/iso/light/mood.ts'
import { TILE_SIZE } from '#shared/constants.ts'
import { isCellarLit } from '#world/cellar/bulb.ts'
import type { Level } from '#world/level/arena.ts'
import {
  type Leak,
  type PuddleRow,
  leakRoll,
  leaksOf,
} from '#world/level/leaks.ts'
import { CELLAR_ROOM_ID } from '#world/level/plan.ts'
import type { Vector } from '#world/schema/entitySchema.ts'
import type { World } from '#world/schema/worldSchema.ts'
import { clamp, distanceBetween, hundredths } from '#world/step/geometry.ts'

import type { Mote } from './air.ts'

export const leakTilesOf = ({
  level,
  lift,
}: Readonly<{ level: Level; lift: number }>): ReadonlyArray<TileQuad> => {
  const keys = new Set<number>()
  const tiles: Array<TileQuad> = []
  Array.forEach(leaksOf(level), ({ rows }) => {
    Array.forEach(rows, ({ y, left, right }) => {
      const row = Math.floor((y - level.top) / TILE_SIZE)
      for (
        let column = Math.floor((left - level.left) / TILE_SIZE);
        column <= Math.floor((right - level.left) / TILE_SIZE);
        column += 1
      ) {
        const key = row * level.columns + column
        if (!keys.has(key)) {
          keys.add(key)
          tiles.push({ row, column, y: lift })
        }
      }
    })
  })
  return tiles
}

const DROP_HEIGHT = 34
const FALL_MS = 420
const RING_STEP_MS = 90
const RING_STEPS = 3
const DROP_COLOR = 0xb4d0ff

const periodOf = (leak: Leak): number =>
  1700 + Math.floor(leakRoll(leak, 5) * 1900)

const offsetOf = (leak: Leak, periodMs: number): number =>
  Math.floor(leakRoll(leak, 6) * periodMs)

const sinceDrip = (leak: Leak, elapsedMs: number): number => {
  const periodMs = periodOf(leak)
  return (elapsedMs + offsetOf(leak, periodMs)) % periodMs
}

const landingsBy = (leak: Leak, elapsedMs: number): number => {
  const periodMs = periodOf(leak)
  return Math.floor((elapsedMs + offsetOf(leak, periodMs) - FALL_MS) / periodMs)
}

const ringStepOf = (leak: Leak, elapsedMs: number): number => {
  const since = sinceDrip(leak, elapsedMs) - FALL_MS
  return since >= 0 && since < RING_STEPS * RING_STEP_MS
    ? 1 + Math.floor(since / RING_STEP_MS)
    : 0
}

export const dripsOf = ({
  world,
  level,
}: Readonly<{ world: World; level: Level }>): ReadonlyArray<Mote> =>
  Array.flatMap(leaksOf(level), leak => {
    const since = sinceDrip(leak, world.elapsedMs)
    const { x, y } = leak.spot
    if (since < FALL_MS) {
      const hover = Math.round(DROP_HEIGHT * (1 - (since / FALL_MS) ** 2))
      return [
        { x, y, hover, color: DROP_COLOR, alpha: 0.9, isGlowing: false },
        {
          x,
          y,
          hover: hover + 1,
          color: DROP_COLOR,
          alpha: 0.6,
          isGlowing: false,
        },
      ]
    }
    const splash = since - FALL_MS
    if (splash < RING_STEP_MS * 2) {
      const lift = splash < RING_STEP_MS ? 2 : 1
      const spread = splash < RING_STEP_MS ? 1 : 2
      return [
        {
          x: x - spread,
          y,
          hover: lift,
          color: DROP_COLOR,
          alpha: 0.7,
          isGlowing: false,
        },
        {
          x: x + spread,
          y,
          hover: lift,
          color: DROP_COLOR,
          alpha: 0.7,
          isGlowing: false,
        },
      ]
    }
    return []
  })

const DRIP_REACH_PX = 130
const DRIP_PAN_PX = 110

export type DripPlacement = Readonly<{ volume: number; pan: number }>

export const maybeDripHeard = ({
  world,
  level,
  listener,
  previousMs,
}: Readonly<{
  world: World
  level: Level
  listener: Vector
  previousMs: number
}>): Option.Option<DripPlacement> => {
  let nearest = DRIP_REACH_PX
  let heard: Option.Option<DripPlacement> = Option.none()
  for (const leak of leaksOf(level)) {
    if (landingsBy(leak, world.elapsedMs) === landingsBy(leak, previousMs)) {
      continue
    }
    const distance = distanceBetween(listener, leak.spot)
    if (distance < nearest) {
      nearest = distance
      const nearness = 1 - distance / DRIP_REACH_PX
      heard = Option.some({
        volume: nearness * nearness,
        pan: clamp((leak.spot.x - listener.x) / DRIP_PAN_PX, -1, 1),
      })
    }
  }
  return heard
}

const WATER = 'rgba(112, 150, 196, 0.62)'
const WATER_EDGE = 'rgba(112, 150, 196, 0.4)'
const RIM = 'rgba(206, 228, 250, 0.8)'
const RING = 'rgba(206, 228, 250, 0.7)'
export const STRIKE_RGB = '232, 240, 255'

export const MIRROR_REACH = 120
const MIRROR_WEIGHT: Readonly<Record<FlameKind, number>> = {
  Candle: 1,
  Hearth: 1.1,
  Sconce: 0.75,
  Oven: 0.85,
  Chandelier: 1.2,
  Bulb: 1.2,
}
const MOST_MIRRORS = 2
export const STRIKE_STEPS = 4

export type Mirror = Readonly<{
  x: number
  y: number
  kind: FlameKind
  weight: number
  rgb: string
  coreRgb: string
}>

const rgbOf = (color: number): string =>
  `${(color >> 16) & 0xff}, ${(color >> 8) & 0xff}, ${color & 0xff}`

export const mirrorOf = (spec: FlameSpec): Mirror => {
  const { color } = FLAME_TUNING.shipped[spec.kind]
  return {
    x: Math.round(spec.reflection.x),
    y: Math.round(spec.reflection.y),
    kind: spec.kind,
    weight: MIRROR_WEIGHT[spec.kind],
    rgb: rgbOf(color),
    coreRgb: rgbOf(mixColor({ from: color, to: 0xffffff, share: 0.55 })),
  }
}

const boxOfRows = (rows: Array.NonEmptyReadonlyArray<PuddleRow>) => ({
  top: Array.headNonEmpty(rows).y,
  bottom: Array.lastNonEmpty(rows).y,
})

const gapTo = (leak: Leak, mirror: Mirror): number => {
  const { top, bottom } = boxOfRows(leak.rows)
  const dy = Math.max(0, top - mirror.y, mirror.y - bottom)
  return Math.hypot(mirror.x - leak.spot.x, dy)
}

const mirrorCache = new WeakMap<Level, ReadonlyArray<ReadonlyArray<Mirror>>>()

type PlacedMirror = Readonly<{ mirror: Mirror; order: number }>

type MirrorColumns = ReadonlyMap<number, ReadonlyArray<PlacedMirror>>

const columnOf = (x: number): number => Math.floor(x / MIRROR_REACH)

const mirrorColumnsOf = (mirrors: ReadonlyArray<Mirror>): MirrorColumns => {
  const columns = new Map<number, Array<PlacedMirror>>()
  Array.forEach(mirrors, (mirror, order) => {
    const column = columnOf(mirror.x)
    const placed = columns.get(column)
    if (placed === undefined) {
      columns.set(column, [{ mirror, order }])
    } else {
      placed.push({ mirror, order })
    }
  })
  return columns
}

const mirrorsAround = (
  columns: MirrorColumns,
  x: number,
): ReadonlyArray<PlacedMirror> => {
  const column = columnOf(x)
  return [
    ...(columns.get(column - 1) ?? []),
    ...(columns.get(column) ?? []),
    ...(columns.get(column + 1) ?? []),
  ]
}

const mirrorsOf = (level: Level): ReadonlyArray<ReadonlyArray<Mirror>> => {
  const cached = mirrorCache.get(level)
  if (cached !== undefined) {
    return cached
  }
  const columns = mirrorColumnsOf(
    Array.map(flameSpecsOf(level), spec => mirrorOf(spec)),
  )
  const near = Array.map(leaksOf(level), leak =>
    pipe(
      Array.filter(
        mirrorsAround(columns, leak.spot.x),
        ({ mirror }) => gapTo(leak, mirror) < MIRROR_REACH,
      ),
      Array.sort(
        Order.combine(
          Order.mapInput(Order.Number, ({ mirror }: PlacedMirror) =>
            gapTo(leak, mirror),
          ),
          Order.mapInput(Order.Number, ({ order }: PlacedMirror) => order),
        ),
      ),
      Array.map(({ mirror }) => mirror),
    ),
  )
  mirrorCache.set(level, near)
  return near
}

export const puddlesOf = (level: Level): ReadonlyArray<Draw.Shape> => {
  const shapes: Array<Draw.Shape> = []
  Array.forEach(leaksOf(level), ({ rows }) => {
    Array.forEach(rows, ({ y, left, right }, index) => {
      const above = rows[index - 1]
      if (above === undefined) {
        shapes.push(rect(left, y, right - left + 1, 1, RIM))
        return
      }
      const isFarHalf = index <= rows.length / 2
      const bodyLeft = isFarHalf ? Math.max(left, above.left) : left
      const bodyRight = isFarHalf ? Math.min(right, above.right) : right
      if (bodyLeft > left) {
        shapes.push(rect(left, y, 1, 1, RIM))
        if (bodyLeft - left > 1) {
          shapes.push(rect(left + 1, y, bodyLeft - left - 1, 1, WATER_EDGE))
        }
      }
      if (bodyRight < right) {
        shapes.push(rect(right, y, 1, 1, RIM))
        if (right - bodyRight > 1) {
          shapes.push(
            rect(bodyRight + 1, y, right - bodyRight - 1, 1, WATER_EDGE),
          )
        }
      }
      if (bodyRight - bodyLeft >= 2) {
        shapes.push(
          rect(bodyLeft, y, 1, 1, WATER_EDGE),
          rect(bodyLeft + 1, y, bodyRight - bodyLeft - 1, 1, WATER),
          rect(bodyRight, y, 1, 1, WATER_EDGE),
        )
      } else if (bodyRight >= bodyLeft) {
        shapes.push(rect(bodyLeft, y, bodyRight - bodyLeft + 1, 1, WATER_EDGE))
      }
    })
  })
  return shapes
}

type RingSpan = readonly [row: number, left: number, width: number]

const RING_SPANS: ReadonlyArray<ReadonlyArray<RingSpan>> = [
  [
    [-1, -1, 3],
    [0, -2, 1],
    [0, 2, 1],
    [1, -1, 3],
  ],
  [
    [-1, -2, 5],
    [0, -3, 1],
    [0, 3, 1],
    [1, -2, 5],
  ],
  [
    [-2, -2, 5],
    [-1, -3, 1],
    [-1, 3, 1],
    [0, -4, 1],
    [0, 4, 1],
    [1, -3, 1],
    [1, 3, 1],
    [2, -2, 5],
  ],
]

const ringOf = (leak: Leak, step: number): ReadonlyArray<Draw.Shape> => {
  const { x, y } = leak.spot
  const spans = RING_SPANS[clamp(step, 1, RING_SPANS.length) - 1] ?? []
  return Array.map(spans, ([row, left, width]) =>
    rect(x + left, y + row, width, 1, RING),
  )
}

const streakOn = (
  row: PuddleRow,
  centerX: number,
  length: number,
  color: string,
): ReadonlyArray<Draw.Shape> => {
  const inside = row.right - row.left - 1
  const width = Math.min(length, inside)
  if (width < 1) {
    return []
  }
  const left = clamp(
    centerX - Math.floor(width / 2),
    row.left + 1,
    row.right - width,
  )
  return [rect(left, row.y, width, 1, color)]
}

const flameStreaksOf = (
  leak: Leak,
  mirror: Mirror,
  rowIndex: number,
): ReadonlyArray<Draw.Shape> => {
  const strength = clamp(
    mirror.weight * (1 - gapTo(leak, mirror) / MIRROR_REACH),
    0,
    1,
  )
  const row = leak.rows[rowIndex]
  if (row === undefined || strength <= 0) {
    return []
  }
  const centerX = clamp(mirror.x, row.left + 2, row.right - 2)
  const length = 3 + Math.round(strength * 4)
  const alpha = hundredths(0.6 + 0.4 * strength)
  const shimmer = leak.rows[rowIndex + 1]
  return [
    ...streakOn(row, centerX, length, `rgba(${mirror.rgb}, ${alpha})`),
    ...(strength > 0.25
      ? streakOn(row, centerX, 2, `rgba(${mirror.coreRgb}, 1)`)
      : []),
    ...(shimmer !== undefined && strength > 0.2
      ? streakOn(
          shimmer,
          centerX + 1,
          length - 2,
          `rgba(${mirror.rgb}, ${hundredths(0.4 * strength + 0.35)})`,
        )
      : []),
  ]
}

const mirrorRowOf = (leak: Leak, mirror: Mirror, taken: number): number => {
  const { top } = boxOfRows(leak.rows)
  const last = leak.rows.length - 2
  const wanted = clamp(mirror.y - top, 1, Math.max(1, last))
  return Math.abs(wanted - taken) < 2
    ? wanted + 2 <= last
      ? wanted + 2
      : Math.max(1, wanted - 2)
    : wanted
}

const strikeBandOf = (
  rows: ReadonlyArray<PuddleRow>,
  step: number,
): ReadonlyArray<Draw.Shape> => {
  const [first, second] = rows
  if (first === undefined || step === 0) {
    return []
  }
  const alpha = hundredths(0.25 + (0.7 * step) / STRIKE_STEPS)
  return [
    rect(
      first.left,
      first.y,
      first.right - first.left + 1,
      1,
      `rgba(${STRIKE_RGB}, ${alpha})`,
    ),
    ...(second !== undefined && step >= STRIKE_STEPS - 1
      ? streakOn(
          second,
          Math.round((second.left + second.right) / 2),
          Math.max(2, second.right - second.left - 4),
          `rgba(${STRIKE_RGB}, 0.5)`,
        )
      : []),
  ]
}

const POOL_GLINT_PX = 34
const BEAM_RGB = '226, 238, 255'

type Viewer = Readonly<{ x: number; y: number; facing: Vector }>

const isCaughtBy = (viewer: Viewer, { spot }: Leak): boolean => {
  const dx = spot.x - viewer.x
  const dy = spot.y - viewer.y
  return (
    Math.hypot(dx, dy) < POOL_GLINT_PX ||
    beamReach({ facing: viewer.facing, dx, dy }) < 1
  )
}

const isInDarkAt = (world: World, level: Level, viewer: Viewer): boolean =>
  !isCellarLit(world) &&
  Array.some(
    level.rooms,
    ({ id, isOpen, box }) =>
      id === CELLAR_ROOM_ID &&
      isOpen &&
      viewer.x >= box.left &&
      viewer.x < box.right &&
      viewer.y >= box.top &&
      viewer.y < box.bottom,
  )

const beamGlintOf = (leak: Leak, viewer: Viewer): ReadonlyArray<Draw.Shape> => {
  const { rows } = leak
  const first = Array.headNonEmpty(rows)
  const middle = rows[Math.floor(rows.length / 2)] ?? first
  const centerX = clamp(
    Math.round((leak.spot.x * 2 + viewer.x) / 3),
    middle.left + 2,
    middle.right - 2,
  )
  return [
    rect(
      first.left,
      first.y,
      first.right - first.left + 1,
      1,
      `rgba(${BEAM_RGB}, 0.7)`,
    ),
    ...streakOn(middle, centerX, 6, `rgba(${BEAM_RGB}, 0.75)`),
    ...streakOn(middle, centerX, 2, `rgba(${BEAM_RGB}, 1)`),
  ]
}

const glintsOf = (
  leak: Leak,
  mirrors: ReadonlyArray<Mirror>,
  lit: ReadonlySet<FlameKind>,
  strikeStep: number,
): ReadonlyArray<Draw.Shape> => {
  const shown = Array.take(
    Array.filter(mirrors, ({ kind }) => lit.has(kind)),
    MOST_MIRRORS,
  )
  const shapes: Array<Draw.Shape> = []
  let taken = -10
  Array.forEach(shown, mirror => {
    const rowIndex = mirrorRowOf(leak, mirror, taken)
    taken = rowIndex
    shapes.push(...flameStreaksOf(leak, mirror, rowIndex))
  })
  return leak.isUnderground
    ? shapes
    : [...shapes, ...strikeBandOf(leak.rows, strikeStep)]
}

const NEAR_X = 360
const NEAR_Y = 260

const isNear = (viewer: Vector, { spot }: Leak): boolean =>
  Math.abs(spot.x - viewer.x) < NEAR_X && Math.abs(spot.y - viewer.y) < NEAR_Y

const LIGHTS: ReadonlyArray<FlameKind> = [
  'Candle',
  'Hearth',
  'Sconce',
  'Oven',
  'Chandelier',
  'Bulb',
]

export const litOf = (world: World): ReadonlySet<FlameKind> =>
  new Set(Array.filter(LIGHTS, kind => isFlameLit(world, kind)))

export const strikeStepOf = (world: World): number =>
  Math.round(strikeOf(world) * STRIKE_STEPS)

export const puddleKeyOf = ({
  world,
  level,
  viewer,
}: Readonly<{ world: World; level: Level; viewer: Viewer }>): string => {
  const isDark = isInDarkAt(world, level, viewer)
  let rings = ''
  let beam = ''
  for (const leak of leaksOf(level)) {
    rings += isNear(viewer, leak) ? `${ringStepOf(leak, world.elapsedMs)}` : '0'
    if (isDark && leak.isUnderground) {
      beam += isCaughtBy(viewer, leak) ? '1' : '0'
    }
  }
  return `${isFlameLit(world, 'Chandelier') ? 1 : 0}${isFlameLit(world, 'Bulb') ? 1 : 0}|${strikeStepOf(world)}|${rings}|${beam}`
}

export const puddleGlintsOf = ({
  world,
  level,
  viewer,
}: Readonly<{
  world: World
  level: Level
  viewer: Viewer
}>): ReadonlyArray<Draw.Shape> => {
  const lit = litOf(world)
  const strike = strikeStepOf(world)
  const mirrors = mirrorsOf(level)
  const isDark = isInDarkAt(world, level, viewer)
  return Array.flatMap(leaksOf(level), (leak, index) => {
    const step = isNear(viewer, leak) ? ringStepOf(leak, world.elapsedMs) : 0
    return [
      ...glintsOf(leak, mirrors[index] ?? [], lit, strike),
      ...(isDark && leak.isUnderground && isCaughtBy(viewer, leak)
        ? beamGlintOf(leak, viewer)
        : []),
      ...(step > 0 ? ringOf(leak, step) : []),
    ]
  })
}
