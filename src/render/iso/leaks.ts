// The roof leaks: the storm (storm.ts) finds a few holes over every open
// room, each dripping into a puddle on the floor. A drop falls from the
// ceiling in whole pixels, a small ring splashes out as it lands, and the
// puddle mirrors the flames near it and the lightning, as a cheap fake: no
// reflection is rendered, only the puddle's own pixels lit in the flame's
// color, by a 4x4 Bayer dither on whole game pixels like the look pass
// (look.ts). The spots are rolled off each room's map, on plain floor clear
// of cover and doorways, and the drips are read off the World's clock, so
// every player in a co-op room sees and hears the same leaks. Cosmetic only:
// nothing in the World knows they are there.

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
import type { Mote } from './air'
import type { TileQuad } from './house'
import { type FlameKind, flameSpecsOf, isFlameLit } from './lightSpecs'
import { mixColor, strikeOf, unitOf } from './mood'
import { PITCH, STRETCH, UNIT } from './space'

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

const leaksIn = (
  level: Level,
  room: Level['rooms'][number],
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
        if (isClearTile(level, column, row)) {
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
    const spot = {
      x: column * TILE_SIZE + 3 + Math.floor(tileRoll(column, row, 1) * 4),
      y: row * TILE_SIZE + 4 + Math.floor(tileRoll(column, row, 2) * 3),
    }
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
  Array.forEach(level.rooms, room => {
    if (room.isOpen) {
      leaks.push(...leaksIn(level, room))
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

const WATER = 'rgba(22, 30, 48, 0.5)'
const SHEEN = 'rgba(150, 172, 206, 0.32)'
const RING = 'rgba(190, 212, 240, 0.7)'
const STRIKE_GLINT = '#e8f0ff'

// NOTE: how far a flame's mirror image lights a puddle, in game pixels, and
// how strongly each kind does.
const MIRROR_REACH = 52
const MIRROR_WEIGHT: Readonly<Record<FlameKind, number>> = {
  Candle: 0.9,
  Hearth: 1,
  Sconce: 0.55,
  Oven: 0.75,
  Chandelier: 1.1,
  Bulb: 1.1,
}
// NOTE: the share of a puddle's pixels the brightest lightning lights.
const STRIKE_SHARE = 0.75
// NOTE: the share of a puddle's far edge the dark sky glints off, always,
// so a puddle reads as wet with no flame near it.
const SKY_SHARE = 0.14
const SKY_GLINT = 'rgb(118, 138, 172)'
// NOTE: a point of light on water stretches toward the viewer: a mirror
// image reaches this much further down the floor than across it.
const STREAK_ACROSS = 1.8
const STREAK_DOWN = 0.7
const STRIKE_STEPS = 4

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]

const bayerAt = (x: number, y: number): number =>
  (BAYER[(y & 3) * 4 + (x & 3)] ?? 0) / 16 + 1 / 32

const cssOf = (color: number): string =>
  `rgb(${(color >> 16) & 0xff}, ${(color >> 8) & 0xff}, ${color & 0xff})`

// NOTE: a flame's mirror image as the camera sees it on the floor: the
// light's point turned under the floor, slid down the view to the floor.
type Mirror = Readonly<{
  x: number
  y: number
  kind: FlameKind
  weight: number
  color: string
  core: string
}>

const mirrorCache = new WeakMap<Level, ReadonlyArray<ReadonlyArray<Mirror>>>()

// NOTE: each leak's flames near enough to show in its puddle.
const mirrorsOf = (level: Level): ReadonlyArray<ReadonlyArray<Mirror>> => {
  const cached = mirrorCache.get(level)
  if (cached !== undefined) {
    return cached
  }
  const mirrors = Array.map(flameSpecsOf(level), spec => ({
    x: Math.round(spec.x / UNIT),
    y: Math.round((spec.z + spec.y / Math.tan(PITCH)) / (UNIT * STRETCH)),
    kind: spec.kind,
    weight: MIRROR_WEIGHT[spec.kind],
    color: cssOf(spec.color),
    core: cssOf(mixColor({ from: spec.color, to: 0xffffff, share: 0.5 })),
  }))
  // NOTE: once per level, the house's few dozen flames for its few dozen
  // leaks.
  const near = Array.map(leaksOf(level), leak =>
    // oxlint-disable-next-line munch/no-nested-scan
    Array.filter(
      mirrors,
      mirror =>
        Math.hypot(
          (mirror.x - leak.spot.x) * STREAK_ACROSS,
          (mirror.y - leak.spot.y) * STREAK_DOWN,
        ) <
        MIRROR_REACH + 8,
    ),
  )
  mirrorCache.set(level, near)
  return near
}

// NOTE: the body of every puddle, which never changes: dark water and a
// sheen along its far edge.
export const puddlesOf = (level: Level): ReadonlyArray<Canvas.Shape> =>
  Array.flatMap(leaksOf(level), ({ rows }) => [
    ...Array.map(rows, ({ y, left, right }) =>
      rect(left, y, right - left + 1, 1, WATER),
    ),
    ...Option.match(Array.head(rows), {
      onNone: () => [],
      onSome: ({ y, left, right }) =>
        right - left > 3 ? [rect(left + 2, y, right - left - 3, 1, SHEEN)] : [],
    }),
  ])

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

// NOTE: a puddle's glints: each pixel lit by the flame whose mirror image
// is nearest it, dithered by how near (a streak down the floor, its core
// paler), the lightning's cold white brightest at the far edge, and the
// dark sky's faint sheen there too.
const glintsOf = (
  leak: Leak,
  mirrors: ReadonlyArray<Mirror>,
  lit: ReadonlySet<FlameKind>,
  strike: number,
): ReadonlyArray<Canvas.Shape> => {
  const shapes: Array<Canvas.Shape> = []
  const last = Math.max(1, leak.rows.length - 1)
  Array.forEach(leak.rows, ({ y, left, right }, index) => {
    const far = 1 - (0.8 * index) / last
    const strikeLevel = leak.isUnderground ? 0 : strike * STRIKE_SHARE * far
    const skyLevel = leak.isUnderground ? 0 : SKY_SHARE * far
    for (let x = left; x <= right; x += 1) {
      const threshold = bayerAt(x, y)
      let best = 0
      let color = ''
      for (const mirror of mirrors) {
        if (!lit.has(mirror.kind)) {
          continue
        }
        const near =
          1 -
          Math.hypot(
            (mirror.x - x) * STREAK_ACROSS,
            (mirror.y - y) * STREAK_DOWN,
          ) /
            MIRROR_REACH
        const level = near > 0 ? mirror.weight * near * near * near : 0
        if (level > best) {
          best = level
          color = level > 0.85 ? mirror.core : mirror.color
        }
      }
      if (strikeLevel > threshold && strikeLevel >= best) {
        shapes.push(rect(x, y, 1, 1, STRIKE_GLINT))
      } else if (best > threshold) {
        shapes.push(rect(x, y, 1, 1, color))
      } else if (skyLevel > threshold) {
        shapes.push(rect(x, y, 1, 1, SKY_GLINT))
      }
    }
  })
  return shapes
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
  const strike = strikeStepOf(world) / STRIKE_STEPS
  const mirrors = mirrorsOf(level)
  return Array.flatMap(leaksOf(level), (leak, index) => {
    const step = isNear(viewer, leak) ? ringStepOf(leak, world.elapsedMs) : 0
    return [
      ...glintsOf(leak, mirrors[index] ?? [], lit, strike),
      ...(step > 0 ? ringOf(leak, step) : []),
    ]
  })
}
