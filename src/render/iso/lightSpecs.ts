// The house's light as plain numbers: each room's own colored fill, the
// flames (candelabras, the hearth and its sconces, the ovens, the chandelier,
// the cellar's bulb), and the cellar's dark. src/render/iso/lights.ts hangs
// them in the 3D view.
//
// Light follows the game's state and nothing else: which rooms are open,
// whether the chandelier hangs, whether the cellar's bulb burns, where the
// player stands and faces. The flicker is a sum of sines over elapsedMs, so a
// replay flickers the same.

import { Array, Option, Order, pipe } from 'effect'

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
import { coverBlocks } from '../room/roomCover'
import { type Mood, moodOf } from './mood'
import { UNIT, zOf } from './space'

// NOTE: what lights a spot where no lamp reaches, as a share of the art's own
// color (lit surfaces divide light by pi). Low, so each room's light and
// each flame reads as a pool.
export const AMBIENT = 0.2 * Math.PI

// NOTE: a view shades at most 32 lights. The rooms' own lights and the
// cellar's dark always shine; the flames nearest the player take what is
// left, less the four the scene keeps (the lamp, the muzzle flash, and two
// to spare).
const LIGHT_BUDGET = 32 - 4

// NOTE: each room's light: its color, and how bright its middle is, as a
// share of the art's own color over the ambient.
const ROOM_TINTS: Readonly<Record<string, number>> = {
  Parlour: 0xffd6a0,
  Dining: 0xffe2b4,
  Kitchen: 0xfff0d8,
  Library: 0xd4f0c0,
  [CELLAR_ROOM_ID]: 0xb8c4ff,
}
const DEFAULT_TINT = 0xffe2b4
const OPEN_FILL = 0.4
const SHUT_FILL = 0.08

// NOTE: how much light the cellar's dark takes away: the ambient and the
// room's own light, and a third more, so it stays black past the edges of
// the player's lights.
export const DARK_DEPTH = (AMBIENT / Math.PI + OPEN_FILL) * 1.35

// NOTE: the dark's cells and the player's pool hang this high, so each
// falls as an even disc.
export const DARK_HEIGHT = 30

// NOTE: a room's light hangs high over its middle and a little to the
// north-west, as if through a skylight, so it falls nearly even across the
// floor and each piece of furniture casts a short shadow south-east,
// toward the lens, where it shows.
const fillHeightOf = (halfDiagonal: number): number =>
  Math.max(8, halfDiagonal * 1.6)
const FILL_FROM = { x: -0.1, z: -0.2 }

// NOTE: a spot's floor lands about a third as bright as the inverse square
// says (its cone's falloff and the range's window), measured off the screen
// in linear color, so the fill is scaled up to the share it is meant to give.
const FILL_GAIN = 3.2

// FLAMES

type FlameKind = 'Candle' | 'Hearth' | 'Sconce' | 'Oven' | 'Chandelier' | 'Bulb'

export type FlameSpec = Readonly<{
  kind: FlameKind
  x: number
  z: number
  height: number
  color: number
  intensity: number
  range: number
  seed: number
}>

type FlameLook = Readonly<{
  height: number
  color: number
  intensity: number
  range: number
}>

const FLAME_LOOKS: Readonly<Record<FlameKind, FlameLook>> = {
  Candle: { height: 1.5, color: 0xffb35a, intensity: 11, range: 6 },
  Hearth: { height: 0.55, color: 0xff7a2e, intensity: 22, range: 8 },
  Sconce: { height: 1.3, color: 0xffc070, intensity: 3.5, range: 4 },
  Oven: { height: 0.45, color: 0xff5a2a, intensity: 7, range: 4.5 },
  Chandelier: { height: 2.4, color: 0xffd890, intensity: 26, range: 9 },
  Bulb: { height: 2.2, color: 0xfff0c8, intensity: 36, range: 12 },
}

type FlameSpot = Readonly<{ kind: FlameKind; spot: Vector }>

const flameSpotsOf = (level: Level): ReadonlyArray<FlameSpot> => [
  ...Array.map(coverBlocks(level, 'i'), box => ({
    kind: 'Candle' as const,
    spot: { x: box.x + box.width / 2, y: box.y + box.height },
  })),
  ...Array.flatMap(coverBlocks(level, 'F'), box => [
    {
      kind: 'Hearth' as const,
      spot: { x: box.x + box.width / 2, y: box.y + box.height + 4 },
    },
    // NOTE: the sconces either side of the hearth (sconceShapes).
    { kind: 'Sconce' as const, spot: { x: box.x - 15, y: box.y + 2 } },
    {
      kind: 'Sconce' as const,
      spot: { x: box.x + box.width + 19, y: box.y + 2 },
    },
  ]),
  ...Array.map(coverBlocks(level, 'G'), box => ({
    kind: 'Oven' as const,
    spot: { x: box.x + box.width / 2, y: box.y + box.height + 2 },
  })),
  ...Option.match(gapBoxOf(level), {
    onNone: () => [],
    onSome: gap => [
      {
        kind: 'Chandelier' as const,
        spot: {
          x: (gap.left + gap.right) / 2,
          y: gap.top - CHANDELIER_RULES.hungRisePx,
        },
      },
    ],
  }),
  ...Option.match(stationCenterOf(level, 'Bulb'), {
    onNone: () => [],
    onSome: center => [{ kind: 'Bulb' as const, spot: center }],
  }),
]

const flameSpecCache = new WeakMap<Level, ReadonlyArray<FlameSpec>>()

export const flameSpecsOf = (level: Level): ReadonlyArray<FlameSpec> => {
  const cached = flameSpecCache.get(level)
  if (cached !== undefined) {
    return cached
  }
  const specs = Array.map(flameSpotsOf(level), ({ kind, spot }, index) => ({
    kind,
    x: spot.x * UNIT,
    z: zOf(spot.y),
    seed: index * 2.17,
    ...FLAME_LOOKS[kind],
  }))
  flameSpecCache.set(level, specs)
  return specs
}

// NOTE: `strength` scales the flicker's swing: the mood's, harder in a wave.
const flickerAt = (t: number, seed: number, strength: number): number =>
  1 +
  strength *
    (0.1 * Math.sin(t * 9.1 + seed) +
      0.07 * Math.sin(t * 15.7 + seed * 2.3) +
      0.05 * Math.sin(t * 27.3 + seed * 4.1))

// NOTE: whether a flame burns now (the chandelier's and the bulb's change),
// how far it sways off its spot in units, and whether it flickers.
const isFlameLit = (world: World, kind: FlameKind): boolean =>
  kind === 'Chandelier'
    ? !isChandelierDown(world)
    : kind !== 'Bulb' || isCellarLit(world)

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

// A ROOM'S FILL

export type FillSpec = Readonly<{
  roomId: string
  from: Readonly<{ x: number; y: number; z: number }>
  to: Readonly<{ x: number; y: number; z: number }>
  color: number
  coneAngle: number
  range: number
  // NOTE: bright at its middle at a share of 1.
  fullIntensity: number
}>

type RoomBox = Level['rooms'][number]['box']

const toDegrees = (radians: number): number => (radians * 180) / Math.PI

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
  // NOTE: the cone just takes in the room's four corners.
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
  return {
    roomId: room.id,
    from,
    to: { x, y: 0, z },
    color: ROOM_TINTS[room.id] ?? DEFAULT_TINT,
    coneAngle: toDegrees(widest) + 6,
    range: farthest * 1.4,
    // NOTE: share * pi * distance squared, over the slant it strikes the
    // floor at.
    fullIntensity: (FILL_GAIN * Math.PI * reach * reach * reach) / height,
  }
}

// THE CELLAR'S DARK

export type DarkCell = Readonly<{ x: number; z: number; coneAngle: number }>

// NOTE: the dark's cells: spots that take light away (a negative intensity),
// each straight down over a square of the room, lit from far overhead so its
// whole square sits inside its cone; the dark overshoots, and the screen
// clamps the overshoot to black.
export const darkCellsOf = (box: RoomBox): ReadonlyArray<DarkCell> => {
  const width = (box.right - box.left) * UNIT
  const depth = zOf(box.bottom - box.top)
  // NOTE: half the room's short side, so a cone's round edge spills only a
  // little past the walls.
  const side = Math.min(width, depth) / 2
  const columns = Math.max(1, Math.round(width / side))
  const rows = Math.max(1, Math.round(depth / side))
  const cellWidth = width / columns
  const cellDepth = depth / rows
  const coneAngle = toDegrees(
    Math.atan(Math.hypot(cellWidth, cellDepth) / 2 / DARK_HEIGHT),
  )
  return Array.flatMap(Array.range(0, columns - 1), column =>
    Array.map(Array.range(0, rows - 1), row => ({
      x: box.left * UNIT + (column + 0.5) * cellWidth,
      z: zOf(box.top) + (row + 0.5) * cellDepth,
      coneAngle,
    })),
  )
}

export const DARK_CELL_INTENSITY =
  -DARK_DEPTH * Math.PI * DARK_HEIGHT * DARK_HEIGHT

// THE FRAME

export type LightsFrame = Readonly<{
  // NOTE: each room's fill share, in the level's room order.
  fillShares: ReadonlyArray<number>
  isDark: boolean
  // NOTE: whether the viewing player stands in the cellar's dark, and so
  // carries the flashlight and the pool.
  isInDark: boolean
  flames: ReadonlyArray<FlameFrame>
  // NOTE: the house's mood (src/render/iso/mood.ts): the fills above are
  // already scaled by it; the tint, the ambient, and the storm are not.
  mood: Mood
}>

const isInBox = (box: RoomBox, { x, y }: Vector): boolean =>
  x >= box.left && x <= box.right && y >= box.top && y <= box.bottom

// NOTE: every light's part this frame: the rooms' fills (none in the dark
// cellar), the dark, the flashlight, and the burning flames nearest the
// viewer, as many as the budget has left.
export const lightsFrameOf = (
  input: Readonly<{ world: World; level: Level; viewer: Vector }>,
): LightsFrame => {
  const { world, level, viewer } = input
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
  const cellCount = Option.match(maybeCellar, {
    onNone: () => 0,
    onSome: ({ box }) => darkCellsOf(box).length,
  })
  const used =
    Array.reduce(fillShares, 0, (count, share) => count + (share > 0 ? 1 : 0)) +
    (isDark ? cellCount : 0) +
    (isInDark ? 2 : 0)
  const specs = flameSpecsOf(level)
  const vx = viewer.x * UNIT
  const vz = zOf(viewer.y)
  const nearest = pipe(
    Array.map(specs, (spec, index) => ({
      index,
      isLit: isFlameLit(world, spec.kind),
      distance: Math.hypot(spec.x - vx, spec.z - vz),
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
        spec.intensity *
        (spec.kind === 'Bulb' ? 1 : flickerAt(t, spec.seed, mood.flicker)),
    })),
  }
}
