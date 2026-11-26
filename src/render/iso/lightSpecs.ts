import { Array, Function, Option, Order, pipe } from 'effect'

import { isCellarLit } from '../../world/cellar/bulb'
import {
  CHANDELIER_RULES,
  gapBoxOf,
  isChandelierDown,
} from '../../world/dining/chandelier'
import type { Level } from '../../world/level/arena'
import { CELLAR_ROOM_ID } from '../../world/level/plan'
import type { Vector } from '../../world/schema/entitySchema'
import type { World } from '../../world/schema/worldSchema'
import { stationCenterOf } from '../../world/stations/stationSpots'
import { CANDELABRA_FLAME, CHANDELIER_SHAPES } from '../room/diningArt'
import { coverBlocks } from '../room/roomCover'
import { type Mood, moodOf } from './mood'
import { OVERHEAD_FOOT_PX, UNIT, standingPointOf, zOf } from './space'
import { Tunable } from './tunable'

export const AMBIENT = 0.2 * Math.PI

const LIGHT_BUDGET = 32 - 5

const ROOM_TINTS: Readonly<Record<string, number>> = {
  Parlour: 0xffd6a0,
  Dining: 0xffe2b4,
  Kitchen: 0xfff0d8,
  Library: 0xd4f0c0,
  [CELLAR_ROOM_ID]: 0xb8c4ff,
}
const DEFAULT_TINT = 0xffe2b4
export const OPEN_FILL = 0.4
const SHUT_FILL = 0.08

export const DARK_DEPTH = (AMBIENT / Math.PI + OPEN_FILL) * 1.35

export const DARK_HEIGHT = 30

const HALF_RANGE_WINDOW = (1 - 0.5 ** 4) ** 2
export const DARK_TAKES = DARK_DEPTH * HALF_RANGE_WINDOW

export const DARK_EVEN = (AMBIENT / Math.PI) * 1.35

const fillHeightOf = (halfDiagonal: number): number =>
  Math.max(8, halfDiagonal * 1.6)
const FILL_FROM = { x: -0.1, z: -0.2 }

const FILL_GAIN = 3.2

export type FlameKind =
  | 'Candle'
  | 'Hearth'
  | 'Sconce'
  | 'Oven'
  | 'Chandelier'
  | 'Bulb'

export type FlameSpec = Readonly<{
  kind: FlameKind
  spot: Vector
  x: number
  y: number
  z: number
  seed: number
  reflection: Vector
}>

type FlameLook = Readonly<{
  out: number
  color: number
  intensity: number
  range: number
}>

export type FlameLooks = Readonly<Record<FlameKind, FlameLook>>

const FLAME_LOOKS: FlameLooks = {
  Candle: { out: 1.32, color: 0xffb35a, intensity: 11, range: 6 },
  Hearth: { out: 0.7, color: 0xff7a2e, intensity: 22, range: 8 },
  Sconce: {
    out: 0.72,
    color: 0xffc070,
    intensity: 3.5,
    range: 4,
  },
  Oven: { out: 0.5, color: 0xff5a2a, intensity: 7, range: 4.5 },
  Chandelier: {
    out: 0.05,
    color: 0xffd890,
    intensity: 26,
    range: 9,
  },
  Bulb: { out: 1.94, color: 0xfff0c8, intensity: 36, range: 12 },
}

export const FLAME_TUNING = new Tunable<FlameLooks>(FLAME_LOOKS)

const HUNG_BOTTOM = Array.reduce(CHANDELIER_SHAPES.Hung, 0, (most, shape) =>
  shape._tag === 'Rect' ? Math.max(most, shape.y + shape.height) : most,
)

type FlameSpot = Readonly<{
  kind: FlameKind
  spot: Vector
  footY: number
  flame: Vector
}>

const FLAME_RISE_PX: Readonly<Record<Exclude<FlameKind, 'Candle'>, number>> = {
  Hearth: -1,
  Sconce: 14,
  Oven: 0,
  Chandelier: 50,
  Bulb: 10,
}

const placedByEye = (
  kind: Exclude<FlameKind, 'Candle'>,
  spot: Vector,
  footY: number,
): FlameSpot => ({
  kind,
  spot,
  footY,
  flame: { x: spot.x, y: footY - FLAME_RISE_PX[kind] },
})

const flameSpotsOf = (level: Level): ReadonlyArray<FlameSpot> => [
  ...Array.map(coverBlocks(level, 'i'), box => ({
    kind: 'Candle' as const,
    spot: { x: box.x + box.width / 2, y: box.y + box.height },
    footY: box.y + box.height,
    flame: {
      x: box.x + CANDELABRA_FLAME.x + 0.5,
      y: box.y + CANDELABRA_FLAME.y + 0.5,
    },
  })),
  ...Array.flatMap(coverBlocks(level, 'F'), box => [
    placedByEye(
      'Hearth',
      { x: box.x + box.width / 2, y: box.y + box.height + 4 },
      box.y + box.height,
    ),
    placedByEye('Sconce', { x: box.x - 15, y: box.y + 2 }, box.y + box.height),
    placedByEye(
      'Sconce',
      { x: box.x + box.width + 19, y: box.y + 2 },
      box.y + box.height,
    ),
  ]),
  ...Array.map(coverBlocks(level, 'G'), box =>
    placedByEye(
      'Oven',
      { x: box.x + box.width / 2, y: box.y + box.height + 2 },
      box.y + box.height,
    ),
  ),
  ...Option.match(gapBoxOf(level), {
    onNone: () => [],
    onSome: gap => [
      placedByEye(
        'Chandelier',
        {
          x: (gap.left + gap.right) / 2,
          y: gap.top - CHANDELIER_RULES.hungRisePx,
        },
        gap.top + HUNG_BOTTOM + OVERHEAD_FOOT_PX,
      ),
    ],
  }),
  ...Option.match(stationCenterOf(level, 'Bulb'), {
    onNone: () => [],
    onSome: center => [placedByEye('Bulb', center, center.y)],
  }),
]

const flameSpecCache = new WeakMap<Level, ReadonlyArray<FlameSpec>>()

export const flameSpecsOf = (level: Level): ReadonlyArray<FlameSpec> => {
  const cached = flameSpecCache.get(level)
  if (cached !== undefined) {
    return cached
  }
  const specs = Array.map(
    flameSpotsOf(level),
    ({ kind, spot, footY, flame }, index) => {
      const { out } = FLAME_LOOKS[kind]
      return {
        kind,
        spot,
        ...standingPointOf({ x: flame.x, footY, atY: flame.y, out }),
        seed: index * 2.17,
        reflection: { x: flame.x, y: footY + (footY - flame.y) },
      }
    },
  )
  flameSpecCache.set(level, specs)
  return specs
}

const flickerAt = (t: number, seed: number, strength: number): number =>
  1 +
  strength *
    (0.1 * Math.sin(t * 9.1 + seed) +
      0.07 * Math.sin(t * 15.7 + seed * 2.3) +
      0.05 * Math.sin(t * 27.3 + seed * 4.1))

const guttered = (t: number, seed: number, rattle: number): number =>
  1 - rattle * (0.35 + 0.3 * Math.sin(t * 41 + seed * 3.7))

export const isFlameLit: {
  (kind: FlameKind): (world: World) => boolean
  (world: World, kind: FlameKind): boolean
} = Function.dual(2, (world: World, kind: FlameKind): boolean =>
  kind === 'Chandelier'
    ? !isChandelierDown(world)
    : kind !== 'Bulb' || isCellarLit(world),
)

const SWAYS: Readonly<Record<FlameKind, (t: number) => number>> = {
  Candle: () => 0,
  Hearth: () => 0,
  Sconce: () => 0,
  Oven: () => 0,
  Chandelier: t => Math.sin(t * 1.3) * 0.06,
  Bulb: t => Math.sin(t * 2.1) * 0.05,
}

type FlameFrame = Readonly<{
  isShown: boolean
  x: number
  intensity: number
}>

export type FillSpec = Readonly<{
  roomId: string
  from: Readonly<{ x: number; y: number; z: number }>
  to: Readonly<{ x: number; y: number; z: number }>
  color: number
  coneAngle: number
  range: number
  fullIntensity: number
  pool: RoomBox
}>

type RoomBox = Level['rooms'][number]['box']

const FILL_SPARE_DEGREES = 6

const toDegrees = (radians: number): number => (radians * 180) / Math.PI

const spillOf = (slant: number): number =>
  (2 * slant * Math.tan((FILL_SPARE_DEGREES * Math.PI) / 180)) / UNIT

export const fillSpecOf = (room: Level['rooms'][number]): FillSpec => {
  const { left, top, right, bottom } = room.box
  const x = ((left + right) / 2) * UNIT
  const z = zOf((top + bottom) / 2)
  const halfDiagonal = Math.hypot(
    ((right - left) / 2) * UNIT,
    zOf(bottom - top) / 2,
  )
  const height = fillHeightOf(halfDiagonal)
  const from = {
    x: x + FILL_FROM.x * height,
    y: height,
    z: z + FILL_FROM.z * height,
  }
  const axis = { x: x - from.x, y: -from.y, z: z - from.z }
  const reach = Math.hypot(axis.x, axis.y, axis.z)
  const corners = Array.map(
    [
      { x: left * UNIT, z: zOf(top) },
      { x: right * UNIT, z: zOf(top) },
      { x: left * UNIT, z: zOf(bottom) },
      { x: right * UNIT, z: zOf(bottom) },
    ],
    corner => {
      const to = { x: corner.x - from.x, y: -from.y, z: corner.z - from.z }
      const length = Math.hypot(to.x, to.y, to.z)
      const cos =
        (to.x * axis.x + to.y * axis.y + to.z * axis.z) / (length * reach)
      return { angle: Math.acos(Math.min(1, cos)), length }
    },
  )
  const widest = Array.reduce(corners, 0, (most, { angle }) =>
    Math.max(most, angle),
  )
  const farthest = Array.reduce(corners, 0, (most, { length }) =>
    Math.max(most, length),
  )
  const spill = spillOf(farthest)
  return {
    roomId: room.id,
    from,
    to: { x, y: 0, z },
    color: ROOM_TINTS[room.id] ?? DEFAULT_TINT,
    coneAngle: toDegrees(widest) + FILL_SPARE_DEGREES,
    range: farthest * 1.4,
    fullIntensity: (FILL_GAIN * Math.PI * reach * reach * reach) / height,
    pool: {
      left: left - spill,
      top: top - spill,
      right: right + spill,
      bottom: bottom + spill,
    },
  }
}

export type LightsFrame = Readonly<{
  fillShares: ReadonlyArray<number>
  isDark: boolean
  isInDark: boolean
  flames: ReadonlyArray<FlameFrame>
  mood: Mood
}>

const isInBox = (box: RoomBox, { x, y }: Vector): boolean =>
  x >= box.left && x <= box.right && y >= box.top && y <= box.bottom

export const lightsFrameOf = (
  input: Readonly<{
    world: World
    level: Level
    viewer: Vector
    rattle: number
  }>,
): LightsFrame => {
  const { world, level, viewer, rattle } = input
  const t = world.elapsedMs / 1000
  const mood = moodOf(world)
  const maybeCellar = Array.findFirst(
    level.rooms,
    ({ id }) => id === CELLAR_ROOM_ID,
  )
  const isDark = Option.exists(
    maybeCellar,
    ({ isOpen }) => isOpen && !isCellarLit(world),
  )
  const isInDark =
    isDark && Option.exists(maybeCellar, ({ box }) => isInBox(box, viewer))
  const fillShares = Array.map(level.rooms, ({ id, isOpen }) =>
    id === CELLAR_ROOM_ID && isDark
      ? 0
      : (isOpen ? OPEN_FILL : SHUT_FILL) * mood.fill,
  )
  const used =
    Array.reduce(fillShares, 0, (count, share) => count + (share > 0 ? 1 : 0)) +
    (isInDark ? 2 : 0)
  const specs = flameSpecsOf(level)
  const looks = FLAME_TUNING.now
  const nearest = pipe(
    Array.map(specs, (spec, index) => ({
      index,
      isLit: isFlameLit(world, spec.kind),
      distance: Math.hypot(spec.spot.x - viewer.x, spec.spot.y - viewer.y),
    })),
    Array.filter(({ isLit }) => isLit),
    Array.sort(
      Order.mapInput(
        Order.Number,
        ({ distance }: { distance: number }) => distance,
      ),
    ),
    Array.take(Math.max(0, LIGHT_BUDGET - used)),
  )
  const shown = new Set(Array.map(nearest, ({ index }) => index))
  return {
    fillShares,
    isDark,
    isInDark,
    mood,
    flames: Array.map(specs, (spec, index) => ({
      isShown: shown.has(index),
      x: spec.x + SWAYS[spec.kind](t),
      intensity:
        looks[spec.kind].intensity *
        guttered(t, spec.seed, rattle) *
        (spec.kind === 'Bulb' ? 1 : flickerAt(t, spec.seed, mood.flicker)),
    })),
  }
}
