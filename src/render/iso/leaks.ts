// The roof leaks: the storm (storm.ts) finds a few holes over every open
// room, each dripping into a puddle on the floor. A drop falls from the
// ceiling in whole pixels, a small ring splashes out as it lands, and the
// puddle darkens and cools the planks under it, a pale rim on its far edge.
// It mirrors the flames near it and the lightning as a cheap fake: no
// reflection is rendered, only short streaks of light across the water, a
// flame's warm and the strike's a bright band along the far edge. The spots
// are rolled off each room's map, on plain floor clear of cover, rugs, and
// doorways, and the drips are read off the World's clock, so every player
// in a co-op room sees and hears the same leaks. Cosmetic only: nothing in
// the World knows they are there.

import { Array, Option, Order } from 'effect'
import type { Canvas } from 'foldkit'

import { TILE_SIZE } from '../../shared/constants'
import { type Level, TILE_DOOR, hasTileFlag } from '../../world/level/arena'
import { CELLAR_ROOM_ID } from '../../world/level/plan'
import { symbolAt, tileIndex } from '../../world/level/tileGrid'
import type { Vector } from '../../world/schema/entitySchema'
import type { World } from '../../world/schema/worldSchema'
import { clamp, distanceBetween } from '../../world/step/geometry'
import { rect } from '../drawing'
import { rugsOf } from '../room/room'
import type { Box } from '../room/roomPalette'
import type { Mote } from './air'
import type { TileQuad } from './house'
import {
  FLAME_TUNING,
  type FlameKind,
  type FlameSpec,
  flameSpecsOf,
  isFlameLit,
} from './lightSpecs'
import { mixColor, strikeOf, unitOf } from './mood'

// WHERE THEY ARE

const FLOOR_SYMBOL = '.'

// NOTE: a room's leaks: one for each this many floor tiles, two to three,
// and never two closer than this many tiles.
const TILES_PER_LEAK = 140
const MOST_LEAKS = 3
const LEAST_LEAKS = 2
const LEAK_GAP_TILES = 5
// NOTE: no leak this many tiles or nearer a doorway, so a puddle never sits
// where the zombies come in.
const DOOR_CLEARANCE = 2

type PuddleRow = Readonly<{ y: number; left: number; right: number }>

export type Leak = Readonly<{
  // NOTE: where the drop lands, in whole game pixels.
  spot: Vector
  rows: ReadonlyArray<PuddleRow>
  // NOTE: the drips' beat, and where in it this leak starts.
  periodMs: number
  offsetMs: number
  isUnderground: boolean
}>

// NOTE: a number from 0 to 1 for a tile and a use, the same on every engine
// and in every level the tile is part of.
const tileRoll = (column: number, row: number, use: number): number =>
  unitOf(column * 92821 + row * 68917 + use * 7)

const isPlainFloor = (level: Level, column: number, row: number): boolean =>
  Option.getOrElse(symbolAt(level, column, row), () => '') === FLOOR_SYMBOL

// NOTE: plain floor all round, in reach of no door.
const isClearTile = (level: Level, column: number, row: number): boolean => {
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (!isPlainFloor(level, column + dx, row + dy)) {
        return false
      }
    }
  }
  const reach = DOOR_CLEARANCE + 1
  for (let dy = -reach; dy <= reach; dy += 1) {
    for (let dx = -reach; dx <= reach; dx += 1) {
      const c = column + dx
      const r = row + dy
      const isInside =
        c >= level.leftColumn &&
        c < level.leftColumn + level.columns &&
        r >= level.topRow &&
        r < level.topRow + level.rows
      if (isInside && hasTileFlag(level, tileIndex(level, c, r), TILE_DOOR)) {
        return false
      }
    }
  }
  return true
}

// NOTE: a puddle's pixels, row by row: a squat blob, wider than it is deep
// as the floor is drawn, its edge nibbled by rolls.
const puddleRowsOf = (
  spot: Vector,
  column: number,
  row: number,
): ReadonlyArray<PuddleRow> => {
  const halfWidth = 4 + Math.floor(tileRoll(column, row, 3) * 3)
  const halfDepth = 2 + Math.floor(tileRoll(column, row, 4) * 2)
  return Array.makeBy(halfDepth * 2 + 1, index => {
    const dy = index - halfDepth
    const share = Math.sqrt(1 - (dy / (halfDepth + 0.5)) ** 2)
    const half = Math.max(1, Math.round(halfWidth * share))
    const nibble = (side: number): number =>
      tileRoll(column, row, 10 + index * 2 + side) < 0.35 ? 1 : 0
    return {
      y: spot.y + dy,
      left: spot.x - half + nibble(0),
      right: spot.x + half - nibble(1),
    }
  })
}

// NOTE: a puddle keeps this many game pixels off a rug's edge, past its
// fringe and tassels, so it never reads as lying half on one.
const RUG_CLEARANCE = 4

const isOffRugs = (
  rows: ReadonlyArray<PuddleRow>,
  rugs: ReadonlyArray<Box>,
): boolean =>
  // NOTE: once per level, a puddle's seven rows at most against a room's
  // two rugs.
  Array.every(rows, ({ y, left, right }) =>
    // oxlint-disable-next-line munch/no-nested-scan
    Array.every(
      rugs,
      rug =>
        y < rug.y - RUG_CLEARANCE ||
        y >= rug.y + rug.height + RUG_CLEARANCE ||
        right < rug.x - RUG_CLEARANCE ||
        left >= rug.x + rug.width + RUG_CLEARANCE,
    ),
  )

const spotOf = (column: number, row: number): Vector => ({
  x: column * TILE_SIZE + 3 + Math.floor(tileRoll(column, row, 1) * 4),
  y: row * TILE_SIZE + 4 + Math.floor(tileRoll(column, row, 2) * 3),
})

const leaksIn = (
  level: Level,
  room: Level['rooms'][number],
  rugs: ReadonlyArray<Box>,
): ReadonlyArray<Leak> => {
  const { box } = room
  const candidates: Array<Readonly<{ column: number; row: number }>> = []
  const left = Math.ceil(box.left / TILE_SIZE)
  const right = Math.floor(box.right / TILE_SIZE)
  const top = Math.ceil(box.top / TILE_SIZE)
  const bottom = Math.floor(box.bottom / TILE_SIZE)
  let floorTiles = 0
  for (let row = top; row < bottom; row += 1) {
    for (let column = left; column < right; column += 1) {
      if (isPlainFloor(level, column, row)) {
        floorTiles += 1
        if (
          isClearTile(level, column, row) &&
          isOffRugs(puddleRowsOf(spotOf(column, row), column, row), rugs)
        ) {
          candidates.push({ column, row })
        }
      }
    }
  }
  const wanted = clamp(
    Math.round(floorTiles / TILES_PER_LEAK),
    LEAST_LEAKS,
    MOST_LEAKS,
  )
  const ranked = Array.sortWith(
    candidates,
    ({ column, row }) => tileRoll(column, row, 0),
    Order.Number,
  )
  const picked: Array<Readonly<{ column: number; row: number }>> = []
  for (const tile of ranked) {
    if (picked.length >= wanted) {
      break
    }
    // NOTE: once per level, against the three leaks a room picks at most.
    // oxlint-disable-next-line munch/no-nested-scan
    const isApart = Array.every(
      picked,
      other =>
        Math.max(
          Math.abs(other.column - tile.column),
          Math.abs(other.row - tile.row),
        ) >= LEAK_GAP_TILES,
    )
    if (isApart) {
      picked.push(tile)
    }
  }
  return Array.map(picked, ({ column, row }) => {
    const spot = spotOf(column, row)
    const periodMs = 1700 + Math.floor(tileRoll(column, row, 5) * 1900)
    return {
      spot,
      rows: puddleRowsOf(spot, column, row),
      periodMs,
      offsetMs: Math.floor(tileRoll(column, row, 6) * periodMs),
      isUnderground: room.id === CELLAR_ROOM_ID,
    }
  })
}

const leakCache = new WeakMap<Level, ReadonlyArray<Leak>>()

// NOTE: every open room's leaks, built once per level.
export const leaksOf = (level: Level): ReadonlyArray<Leak> => {
  const cached = leakCache.get(level)
  if (cached !== undefined) {
    return cached
  }
  const leaks: Array<Leak> = []
  const rugs = rugsOf(level)
  Array.forEach(level.rooms, room => {
    if (room.isOpen) {
      leaks.push(...leaksIn(level, room, rugs))
    }
  })
  leakCache.set(level, leaks)
  return leaks
}

// NOTE: the puddles' quads sit over the ground's glows (0.012) and under
// the storm's thrown light (0.014).
const OVER_FLOOR = 0.013

// NOTE: every tile a puddle lies on, a quad each.
export const leakTilesOf = (level: Level): ReadonlyArray<TileQuad> => {
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
          tiles.push({ row, column, y: OVER_FLOOR })
        }
      }
    })
  })
  return tiles
}

// THE DRIPS

// NOTE: a drop falls from this high over the floor, in game pixels, in this
// long, then splashes a ring out in three steps of this long.
const DROP_HEIGHT = 34
const FALL_MS = 420
const RING_STEP_MS = 90
const RING_STEPS = 3
const DROP_COLOR = 0xb4d0ff

const sinceDrip = (leak: Leak, elapsedMs: number): number =>
  (elapsedMs + leak.offsetMs) % leak.periodMs

const landingsBy = (leak: Leak, elapsedMs: number): number =>
  Math.floor((elapsedMs + leak.offsetMs - FALL_MS) / leak.periodMs)

// NOTE: the step of the ring a landed drop splashes, 1 to 3, or 0 for none.
const ringStepOf = (leak: Leak, elapsedMs: number): number => {
  const since = sinceDrip(leak, elapsedMs) - FALL_MS
  return since >= 0 && since < RING_STEPS * RING_STEP_MS
    ? 1 + Math.floor(since / RING_STEP_MS)
    : 0
}

// NOTE: the falling drops, two pixels tall, and the two beads a landing
// throws up, lit as the dust is, so they show only in the light.
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

// NOTE: where a drop landed between two readings of the World's clock that
// the listener hears, the nearest, for the drip's sound.
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

// THE PUDDLES

// NOTE: the water darkens and cools the planks under it and lets them show
// through, softer at its two ends; its far edge is a pixel of pale sheen,
// the sky off the wet.
const WATER = 'rgba(4, 10, 20, 0.66)'
const WATER_EDGE = 'rgba(4, 10, 20, 0.4)'
const RIM = 'rgba(150, 176, 196, 0.18)'
const RING = 'rgba(190, 212, 240, 0.5)'
const STRIKE_RGB = '232, 240, 255'

// NOTE: how far from a puddle a flame still shows in it, in game pixels,
// and how strongly each kind does. A point of light on water is a short
// streak across it, longer and paler at its core the nearer the flame.
const MIRROR_REACH = 120
const MIRROR_WEIGHT: Readonly<Record<FlameKind, number>> = {
  Candle: 1,
  Hearth: 1.1,
  Sconce: 0.75,
  Oven: 0.85,
  Chandelier: 1.2,
  Bulb: 1.2,
}
// NOTE: a puddle shows the two nearest flames at most, a row apart.
const MOST_MIRRORS = 2
const STRIKE_STEPS = 4

// NOTE: a flame's mirror image as the camera sees it on the floor: as far
// under the flame's foot on the screen as the flame stands over it, which
// on the floor is as many game pixels south.
type Mirror = Readonly<{
  x: number
  y: number
  kind: FlameKind
  weight: number
  rgb: string
  coreRgb: string
}>

const rgbOf = (color: number): string =>
  `${(color >> 16) & 0xff}, ${(color >> 8) & 0xff}, ${color & 0xff}`

const mirrorOf = (spec: FlameSpec): Mirror => {
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

const hundredths = (value: number): number => Math.round(value * 100) / 100

const boxOfRows = (rows: ReadonlyArray<PuddleRow>) => ({
  top: Option.getOrElse(Array.head(rows), () => ({ y: 0 })).y,
  bottom: Option.getOrElse(Array.last(rows), () => ({ y: 0 })).y,
})

// NOTE: how far a mirror image lies from a puddle's blob, in game pixels.
const gapTo = (leak: Leak, mirror: Mirror): number => {
  const { top, bottom } = boxOfRows(leak.rows)
  const dy = Math.max(0, top - mirror.y, mirror.y - bottom)
  return Math.hypot(mirror.x - leak.spot.x, dy)
}

const mirrorCache = new WeakMap<Level, ReadonlyArray<ReadonlyArray<Mirror>>>()

// NOTE: each leak's flames near enough to show in its puddle, nearest first.
const mirrorsOf = (level: Level): ReadonlyArray<ReadonlyArray<Mirror>> => {
  const cached = mirrorCache.get(level)
  if (cached !== undefined) {
    return cached
  }
  const mirrors = Array.map(flameSpecsOf(level), spec => mirrorOf(spec))
  // NOTE: once per level, the house's few dozen flames for its few dozen
  // leaks.
  const near = Array.map(leaksOf(level), leak =>
    Array.sortWith(
      // oxlint-disable-next-line munch/no-nested-scan
      Array.filter(mirrors, mirror => gapTo(leak, mirror) < MIRROR_REACH),
      (mirror: Mirror) => gapTo(leak, mirror),
      Order.Number,
    ),
  )
  mirrorCache.set(level, near)
  return near
}

// NOTE: the body of every puddle, which never changes: the water, softer
// at each row's ends, and the pale rim along its far edge.
export const puddlesOf = (level: Level): ReadonlyArray<Canvas.Shape> => {
  const shapes: Array<Canvas.Shape> = []
  Array.forEach(leaksOf(level), ({ rows }) => {
    Array.forEach(rows, ({ y, left, right }, index) => {
      const above = rows[index - 1]
      if (above === undefined) {
        shapes.push(rect(left, y, right - left + 1, 1, RIM))
        return
      }
      // NOTE: in the far half, what a row reaches past the row above it is
      // the far edge too.
      const isFarHalf = index <= rows.length / 2
      const bodyLeft = isFarHalf ? Math.max(left, above.left) : left
      const bodyRight = isFarHalf ? Math.min(right, above.right) : right
      // NOTE: a step out is rim at its outer pixel only, the diagonal edge
      // a line of single pixels rather than a pale block.
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

// NOTE: the ring a landing splashes, one pixel wide, wider each step.
const ringOf = (leak: Leak, step: number): ReadonlyArray<Canvas.Shape> => {
  const { x, y } = leak.spot
  const across = step + 1
  const down = Math.max(1, step - 1)
  return [
    rect(x - across, y, 1, 1, RING),
    rect(x + across, y, 1, 1, RING),
    rect(x - step + 1, y - down, Math.max(1, 2 * step - 1), 1, RING),
    rect(x - step + 1, y + down, Math.max(1, 2 * step - 1), 1, RING),
  ]
}

// NOTE: a horizontal streak of light on a row, held inside it.
const streakOn = (
  row: PuddleRow,
  centerX: number,
  length: number,
  color: string,
): ReadonlyArray<Canvas.Shape> => {
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

// NOTE: a flame in a puddle: a warm streak across the row its mirror image
// falls on (the nearest edge row when it falls outside), longer the nearer,
// a paler core in its middle, and a shorter shimmer a row nearer.
const flameStreaksOf = (
  leak: Leak,
  mirror: Mirror,
  rowIndex: number,
): ReadonlyArray<Canvas.Shape> => {
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
  const length = 2 + Math.round(strength * 4)
  const alpha = hundredths(0.35 + 0.5 * strength)
  const shimmer = leak.rows[rowIndex + 1]
  return [
    ...streakOn(row, centerX, length, `rgba(${mirror.rgb}, ${alpha})`),
    ...(strength > 0.5
      ? streakOn(row, centerX, 2, `rgba(${mirror.coreRgb}, 0.95)`)
      : []),
    ...(shimmer !== undefined && strength > 0.3
      ? streakOn(
          shimmer,
          centerX + 1,
          length - 3,
          `rgba(${mirror.rgb}, ${hundredths(0.3 * strength + 0.2)})`,
        )
      : []),
  ]
}

// NOTE: the row a mirror image falls on, held off the far rim and kept a
// row apart from a nearer flame's.
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

// NOTE: the lightning on a puddle: its far rim lit as a bright band, and
// in the brightest steps a shorter band a row nearer.
const strikeBandOf = (
  rows: ReadonlyArray<PuddleRow>,
  step: number,
): ReadonlyArray<Canvas.Shape> => {
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

// NOTE: a puddle's glints: the nearest lit flames as warm streaks, and the
// lightning's band along the far edge (none underground).
const glintsOf = (
  leak: Leak,
  mirrors: ReadonlyArray<Mirror>,
  lit: ReadonlySet<FlameKind>,
  strikeStep: number,
): ReadonlyArray<Canvas.Shape> => {
  const shown = Array.take(
    Array.filter(mirrors, ({ kind }) => lit.has(kind)),
    MOST_MIRRORS,
  )
  const shapes: Array<Canvas.Shape> = []
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

// NOTE: a leak this far from the viewer, each way, is off every screen the
// game has, so its ring need not be drawn.
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

const litOf = (world: World): ReadonlySet<FlameKind> =>
  new Set(Array.filter(LIGHTS, kind => isFlameLit(world, kind)))

const strikeStepOf = (world: World): number =>
  Math.round(strikeOf(world) * STRIKE_STEPS)

// NOTE: what the puddles' glints and rings depend on: when it is the same
// as last frame's, so is their picture, and it need not be painted again.
export const puddleKeyOf = ({
  world,
  level,
  viewer,
}: Readonly<{ world: World; level: Level; viewer: Vector }>): string => {
  let rings = ''
  for (const leak of leaksOf(level)) {
    rings += isNear(viewer, leak) ? `${ringStepOf(leak, world.elapsedMs)}` : '0'
  }
  return `${isFlameLit(world, 'Chandelier') ? 1 : 0}${isFlameLit(world, 'Bulb') ? 1 : 0}|${strikeStepOf(world)}|${rings}`
}

// NOTE: the puddles' glints and the near rings this frame, over their
// bodies.
export const puddleGlintsOf = ({
  world,
  level,
  viewer,
}: Readonly<{
  world: World
  level: Level
  viewer: Vector
}>): ReadonlyArray<Canvas.Shape> => {
  const lit = litOf(world)
  const strike = strikeStepOf(world)
  const mirrors = mirrorsOf(level)
  return Array.flatMap(leaksOf(level), (leak, index) => {
    const step = isNear(viewer, leak) ? ringStepOf(leak, world.elapsedMs) : 0
    return [
      ...glintsOf(leak, mirrors[index] ?? [], lit, strike),
      ...(step > 0 ? ringOf(leak, step) : []),
    ]
  })
}
