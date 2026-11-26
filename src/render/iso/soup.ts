// The kitchen's goop as the roof leaks' puddles are drawn (leaks.ts): one
// picture on the floor, a thick stew you can just see the tiles through.
// Its footprint is the World's slip area (src/world/kitchen/kitchen.ts,
// src/world/kitchen/soupPot.ts): every soup tile whole, and the pot's puddle
// every pixel whose middle lies inside its radius. The stew is a rounded
// splat over it, never more than a pixel past its edge, darker and murkier
// toward its middle and lighter where it runs thin at its rim, a pale sheen
// on its far edge and a dark lip on its near one, carrots, peas, and potato
// in chunks of two and three pixels. The kitchen's flames show in it as
// short streaks of light, as on the leaks' water, and bubbles swell and pop
// off the World's clock. Cosmetic only, and in whole game pixels.
//
// Plain data, no pixi.

import { Array, Option, Order, Result } from 'effect'

import { TILE_SIZE } from '../../shared/constants'
import { unitOf } from '../../shared/prng'
import type { Level } from '../../world/level/arena'
import { KITCHEN_ROOM_ID } from '../../world/level/plan'
import {
  SOUP_SYMBOL,
  boxCenter,
  tilesWithSymbol,
} from '../../world/level/tileGrid'
import type { World } from '../../world/schema/worldSchema'
import { stationBoxOf } from '../../world/stations/stationSpots'
import { TOOL_RULES } from '../../world/stations/toolRules'
import { clamp, hundredths } from '../../world/step/geometry'
import type * as Draw from '../draw'
import { rect } from '../drawing'
import { isRoomOpen } from '../room/room'
import type { Mote } from './air'
import type { TileQuad } from './house'
import {
  MIRROR_REACH,
  type Mirror,
  STRIKE_RGB,
  STRIKE_STEPS,
  mirrorOf,
} from './leaks'
import { type FlameKind, flameSpecsOf } from './lightSpecs'

// THE FOOTPRINT

// NOTE: a game pixel of the footprint, by its top left corner.
type Pixel = Readonly<{ x: number; y: number }>

const keyOf = (x: number, y: number): string => `${x},${y}`

// NOTE: the footprint: its pixels, a key each.
export type Footprint = ReadonlyMap<string, Pixel>

// NOTE: every soup tile whole, as the World's tile flag reads it, while the
// kitchen is open (the World slips no one in it before).
export const soupFootprintOf = (level: Level): Footprint => {
  const pixels = new Map<string, Pixel>()
  if (!isRoomOpen(level, KITCHEN_ROOM_ID)) {
    return pixels
  }
  Array.forEach(tilesWithSymbol(level, SOUP_SYMBOL), ({ column, row }) => {
    for (let dy = 0; dy < TILE_SIZE; dy += 1) {
      for (let dx = 0; dx < TILE_SIZE; dx += 1) {
        const x = column * TILE_SIZE + dx
        const y = row * TILE_SIZE + dy
        pixels.set(keyOf(x, y), { x, y })
      }
    }
  })
  return pixels
}

// NOTE: the pot's puddle, every pixel whose middle lies inside its radius,
// as `isInPuddle` reads a point, with the soup's tiles under it.
export const spilledFootprintOf = ({
  level,
  soup,
}: Readonly<{ level: Level; soup: Footprint }>): Option.Option<Footprint> =>
  Option.map(stationBoxOf(level, 'SoupPot'), box => {
    const rules = TOOL_RULES.SoupPot
    const center = boxCenter(box)
    const middle = { x: center.x, y: center.y + rules.spillDownPx }
    const pixels = new Map(soup)
    const reach = Math.ceil(rules.radiusPx)
    for (let dy = -reach; dy <= reach; dy += 1) {
      for (let dx = -reach; dx <= reach; dx += 1) {
        const x = Math.floor(middle.x) + dx
        const y = Math.floor(middle.y) + dy
        if (
          Math.hypot(x + 0.5 - middle.x, y + 0.5 - middle.y) < rules.radiusPx
        ) {
          pixels.set(keyOf(x, y), { x, y })
        }
      }
    }
    return pixels
  })

// THE SPLAT

// NOTE: the picture's margin round the footprint, the blur's reach that
// rounds its corners, and how far past the footprint the stew may run.
const PAD = 4
const BLUR = 4
const REACH_PAST = 1
// NOTE: the edge's wobble: a lattice this many pixels apart, nudging the
// edge in or out by up to a pixel.
const WOBBLE_CELL = 6
const WOBBLE = 0.2
// NOTE: the most a pixel's way in from the edge is counted.
const DEEPEST = 8

// NOTE: the drawn stew: each pixel's way in from its edge, 1 at the edge
// and 0 where there is no stew, over a box in game pixels.
export type Splat = Readonly<{
  left: number
  top: number
  width: number
  height: number
  depth: Uint8Array
}>

const roll = (x: number, y: number, use: number): number =>
  unitOf(x * 92821 + y * 68917 + use * 7)

const depthAt = (splat: Splat, x: number, y: number): number => {
  const column = x - splat.left
  const row = y - splat.top
  return column < 0 || column >= splat.width || row < 0 || row >= splat.height
    ? 0
    : (splat.depth[row * splat.width + column] ?? 0)
}

// NOTE: a smooth roll over the floor, from -1 to 1, for the edge's wobble.
const wobbleAt = (x: number, y: number): number => {
  const gx = Math.floor(x / WOBBLE_CELL)
  const gy = Math.floor(y / WOBBLE_CELL)
  const fx = x / WOBBLE_CELL - gx
  const fy = y / WOBBLE_CELL - gy
  const top = roll(gx, gy, 40) * (1 - fx) + roll(gx + 1, gy, 40) * fx
  const bottom = roll(gx, gy + 1, 40) * (1 - fx) + roll(gx + 1, gy + 1, 40) * fx
  return (top * (1 - fy) + bottom * fy) * 2 - 1
}

const EMPTY: Splat = {
  left: 0,
  top: 0,
  width: 0,
  height: 0,
  depth: new Uint8Array(0),
}

// NOTE: the footprint blurred and cut again at its middle, so its corners
// round and its edge wobbles a pixel either way; then each pixel's way in
// from the edge, a chamfer's guess at the straight distance.
export const splatOf = (footprint: Footprint): Splat => {
  const pixels = [...footprint.values()]
  if (pixels.length === 0) {
    return EMPTY
  }
  const xs = Array.map(pixels, ({ x }) => x)
  const ys = Array.map(pixels, ({ y }) => y)
  const left = Math.min(...xs) - PAD
  const top = Math.min(...ys) - PAD
  const width = Math.max(...xs) - Math.min(...xs) + 1 + PAD * 2
  const height = Math.max(...ys) - Math.min(...ys) + 1 + PAD * 2
  const stride = width + 1
  const sums = new Float64Array(stride * (height + 1))
  const inside = new Uint8Array(width * height)
  Array.forEach(pixels, ({ x, y }) => {
    inside[(y - top) * width + (x - left)] = 1
  })
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      sums[(row + 1) * stride + column + 1] =
        (inside[row * width + column] ?? 0) +
        (sums[row * stride + column + 1] ?? 0) +
        (sums[(row + 1) * stride + column] ?? 0) -
        (sums[row * stride + column] ?? 0)
    }
  }
  const boxSum = (column: number, row: number, reach: number): number => {
    const x0 = clamp(column - reach, 0, width)
    const x1 = clamp(column + reach + 1, 0, width)
    const y0 = clamp(row - reach, 0, height)
    const y1 = clamp(row + reach + 1, 0, height)
    return (
      (sums[y1 * stride + x1] ?? 0) -
      (sums[y0 * stride + x1] ?? 0) -
      (sums[y1 * stride + x0] ?? 0) +
      (sums[y0 * stride + x0] ?? 0)
    )
  }
  const across = (BLUR * 2 + 1) ** 2
  const far = 255
  const distance = new Uint16Array(width * height)
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const isNear = boxSum(column, row, REACH_PAST) > 0
      const field =
        boxSum(column, row, BLUR) / across +
        WOBBLE * wobbleAt(left + column, top + row)
      distance[row * width + column] = isNear && field >= 0.5 ? far : 0
    }
  }
  // NOTE: the chamfer's two passes, 3 a step along and 4 a step across.
  const relax = (index: number, other: number, step: number): void => {
    const through = (distance[other] ?? 0) + step
    if (through < (distance[index] ?? 0)) {
      distance[index] = through
    }
  }
  for (let row = 1; row < height - 1; row += 1) {
    for (let column = 1; column < width - 1; column += 1) {
      const index = row * width + column
      relax(index, index - 1, 3)
      relax(index, index - width, 3)
      relax(index, index - width - 1, 4)
      relax(index, index - width + 1, 4)
    }
  }
  for (let row = height - 2; row > 0; row -= 1) {
    for (let column = width - 2; column > 0; column -= 1) {
      const index = row * width + column
      relax(index, index + 1, 3)
      relax(index, index + width, 3)
      relax(index, index + width + 1, 4)
      relax(index, index + width - 1, 4)
    }
  }
  const depth = Uint8Array.from(distance, value =>
    value === 0 ? 0 : Math.min(DEEPEST, Math.round(value / 3)),
  )
  return { left, top, width, height, depth }
}

// NOTE: every drawn pixel of a splat, row by row.
const forEachPixel = (
  splat: Splat,
  visit: (x: number, y: number, depth: number) => void,
): void => {
  for (let row = 0; row < splat.height; row += 1) {
    for (let column = 0; column < splat.width; column += 1) {
      const depth = splat.depth[row * splat.width + column] ?? 0
      if (depth > 0) {
        visit(splat.left + column, splat.top + row, depth)
      }
    }
  }
}

// NOTE: the puddle's quads sit over the leaks' (0.013) and under the storm's
// thrown light (0.014).
const OVER_FLOOR = 0.0135

// NOTE: every tile the splats and their near lip's shadow lie on, a quad
// each, over the picture of the whole level.
export const splatTilesOf = ({
  level,
  splats,
}: Readonly<{
  level: Level
  splats: ReadonlyArray<Splat>
}>): ReadonlyArray<TileQuad> => {
  const keys = new Set<number>()
  const tiles: Array<TileQuad> = []
  Array.forEach(splats, splat => {
    forEachPixel(splat, (x, y) => {
      Array.forEach([y, y + 1], at => {
        const row = Math.floor((at - level.top) / TILE_SIZE)
        const column = Math.floor((x - level.left) / TILE_SIZE)
        const key = row * level.columns + column
        if (!keys.has(key)) {
          keys.add(key)
          tiles.push({ row, column, y: OVER_FLOOR })
        }
      })
    })
  })
  return tiles
}

// THE STEW

// NOTE: greenish ochre, murkier and less see-through the deeper it lies,
// by the way in from its edge.
const STEW: ReadonlyArray<string> = [
  'rgba(164, 150, 66, 0.6)',
  'rgba(138, 126, 48, 0.8)',
  'rgba(118, 108, 40, 0.86)',
  'rgba(104, 94, 36, 0.89)',
  'rgba(94, 84, 32, 0.9)',
  'rgba(84, 76, 28, 0.91)',
  'rgba(76, 68, 26, 0.92)',
  'rgba(68, 60, 22, 0.93)',
]
const SHEEN = 'rgba(212, 202, 122, 0.78)'
const LIP = 'rgba(58, 46, 16, 0.94)'
const LIP_SHADOW = 'rgba(16, 10, 2, 0.55)'
const FAT = 'rgba(184, 172, 88, 0.7)'

const stewOf = (depth: number): string =>
  STEW[clamp(depth, 1, STEW.length) - 1] ?? 'transparent'

// NOTE: the color a pixel of stew is painted: the far edge's sheen, the
// near edge's lip, else the stew by its depth.
const colorAt = (splat: Splat, x: number, y: number, depth: number): string =>
  depthAt(splat, x, y - 1) === 0
    ? SHEEN
    : depthAt(splat, x, y + 1) === 0
      ? LIP
      : stewOf(depth)

type Chunk = Readonly<{
  pixels: ReadonlyArray<ReadonlyArray<string>>
}>

// NOTE: what floats in it, each two or three pixels: a carrot's coin, a
// chunk of carrot, a pea, a cube of potato.
const CHUNKS: ReadonlyArray<Chunk> = [
  {
    pixels: [
      ['#e8913e', '#e8913e', '#c8641e'],
      ['#a84e16', '#a84e16', '#7a3a10'],
    ],
  },
  {
    pixels: [
      ['#e8913e', '#c8641e'],
      ['#c8641e', '#8a4010'],
    ],
  },
  {
    pixels: [
      ['#a4c050', '#7a9a2e'],
      ['#7a9a2e', '#4e6a1c'],
    ],
  },
  {
    pixels: [
      ['#c8ac62', '#b0944e', '#b0944e'],
      ['#8a7036', '#8a7036', '#5e4a22'],
    ],
  },
]

type Spot = Readonly<{ x: number; y: number; kind: number }>

// NOTE: spots spread over the stew a cell each, rolled, deep enough in that
// what sits there never touches the rim.
const spotsOf = (
  input: Readonly<{
    splat: Splat
    cellX: number
    cellY: number
    chance: number
    use: number
    kinds: number
  }>,
): ReadonlyArray<Spot> => {
  const { splat, cellX, cellY, chance, use, kinds } = input
  const spots: Array<Spot> = []
  for (let top = splat.top; top < splat.top + splat.height; top += cellY) {
    for (
      let left = splat.left;
      left < splat.left + splat.width;
      left += cellX
    ) {
      if (roll(left, top, use) >= chance) {
        continue
      }
      const x = left + Math.floor(roll(left, top, use + 1) * (cellX - 3))
      const y = top + Math.floor(roll(left, top, use + 2) * (cellY - 2))
      const isDeep =
        depthAt(splat, x, y) >= 3 &&
        depthAt(splat, x + 2, y + 1) >= 3 &&
        depthAt(splat, x, y + 1) >= 3 &&
        depthAt(splat, x + 2, y) >= 3
      if (isDeep) {
        spots.push({
          x,
          y,
          kind: Math.floor(roll(left, top, use + 3) * kinds),
        })
      }
    }
  }
  return spots
}

const chunksOf = (splat: Splat): ReadonlyArray<Spot> =>
  spotsOf({
    splat,
    cellX: 9,
    cellY: 6,
    chance: 0.38,
    use: 50,
    kinds: CHUNKS.length,
  })

// NOTE: the stew's picture, which changes only as the pot's puddle comes
// and goes: each row in runs of one color, the fat in a few glints, and
// the chunks over it.
export const stewShapesOf = (splat: Splat): ReadonlyArray<Draw.Shape> => {
  const shapes: Array<Draw.Shape> = []
  for (let row = 0; row < splat.height; row += 1) {
    const y = splat.top + row
    let runStart = 0
    let runColor = ''
    const close = (end: number): void => {
      if (runColor !== '') {
        shapes.push(rect(splat.left + runStart, y, end - runStart, 1, runColor))
      }
    }
    for (let column = 0; column <= splat.width; column += 1) {
      const x = splat.left + column
      const depth = column < splat.width ? depthAt(splat, x, y) : 0
      const color = depth === 0 ? '' : colorAt(splat, x, y, depth)
      if (color !== runColor) {
        close(column)
        runStart = column
        runColor = color
      }
      // NOTE: under the near lip, its shadow on the floor, a pixel deep.
      if (depth > 0 && depthAt(splat, x, y + 1) === 0) {
        shapes.push(rect(x, y + 1, 1, 1, LIP_SHADOW))
      }
    }
  }
  Array.forEach(
    spotsOf({ splat, cellX: 11, cellY: 7, chance: 0.4, use: 60, kinds: 1 }),
    ({ x, y }) => {
      shapes.push(rect(x, y, 2, 1, FAT))
    },
  )
  Array.forEach(chunksOf(splat), ({ x, y, kind }) => {
    Array.forEach(CHUNKS[kind]?.pixels ?? [], (line, dy) => {
      Array.forEach(line, (color, dx) => {
        shapes.push(rect(x + dx, y + dy, 1, 1, color))
      })
    })
  })
  return shapes
}

// THE FLAMES IN IT

// NOTE: a flame near the stew and the pixel of it nearest its mirror image,
// deep enough in that its streak never lies on the rim.
export type SoupMirror = Readonly<{
  mirror: Mirror
  x: number
  y: number
  gap: number
}>

const MOST_MIRRORS = 3

// NOTE: once per splat: each of the house's few dozen flames against the
// stew's pixels, the near ones kept, nearest first.
export const soupMirrorsOf = ({
  level,
  splat,
}: Readonly<{ level: Level; splat: Splat }>): ReadonlyArray<SoupMirror> => {
  const inner: Array<Readonly<{ x: number; y: number }>> = []
  forEachPixel(splat, (x, y, depth) => {
    if (depth >= 2) {
      inner.push({ x, y })
    }
  })
  const near = Array.filterMap(flameSpecsOf(level), spec => {
    const mirror = mirrorOf(spec)
    let best = { x: 0, y: 0, gap: Infinity }
    // NOTE: once per level, a flame against the stew's few thousand pixels.
    Array.forEach(inner, ({ x, y }) => {
      const gap = Math.hypot(x - mirror.x, y - mirror.y)
      if (gap < best.gap) {
        best = { x, y, gap }
      }
    })
    return best.gap < MIRROR_REACH
      ? Result.succeed<SoupMirror>({ mirror, ...best })
      : Result.failVoid
  })
  return Array.sortWith(near, ({ gap }) => gap, Order.Number)
}

// NOTE: a streak of light along a row of the stew, held off its rim.
const streakAt = (
  input: Readonly<{
    splat: Splat
    x: number
    y: number
    length: number
    color: string
  }>,
): ReadonlyArray<Draw.Shape> => {
  const { splat, x, y, length, color } = input
  const shapes: Array<Draw.Shape> = []
  const start = x - Math.floor(length / 2)
  for (let at = start; at < start + length; at += 1) {
    if (depthAt(splat, at, y) >= 2) {
      shapes.push(rect(at, y, 1, 1, color))
    }
  }
  return shapes
}

// NOTE: a flame in the stew: a warm streak, longer and brighter the nearer,
// a paler core, and a shorter shimmer a row nearer, kept rows apart.
const flameStreaksOf = (
  splat: Splat,
  { mirror, x, gap }: SoupMirror,
  row: number,
): ReadonlyArray<Draw.Shape> => {
  const strength = clamp(mirror.weight * (1 - gap / MIRROR_REACH), 0, 1)
  if (strength <= 0) {
    return []
  }
  const length = 2 + Math.round(strength * 4)
  const alpha = hundredths(0.45 + 0.45 * strength)
  return [
    ...streakAt({
      splat,
      x,
      y: row,
      length,
      color: `rgba(${mirror.rgb}, ${alpha})`,
    }),
    ...(strength > 0.5
      ? streakAt({
          splat,
          x,
          y: row,
          length: 2,
          color: `rgba(${mirror.coreRgb}, 0.9)`,
        })
      : []),
    ...(strength > 0.3
      ? streakAt({
          splat,
          x: x + 1,
          y: row + 1,
          length: length - 3,
          color: `rgba(${mirror.rgb}, ${hundredths(0.2 + 0.3 * strength)})`,
        })
      : []),
  ]
}

// NOTE: the stew's glints: its nearest lit flames, and the lightning along
// its far edge.
export const soupGlintsOf = (
  input: Readonly<{
    splat: Splat
    mirrors: ReadonlyArray<SoupMirror>
    lit: ReadonlySet<FlameKind>
    strikeStep: number
  }>,
): ReadonlyArray<Draw.Shape> => {
  const { splat, mirrors, lit, strikeStep } = input
  const shapes: Array<Draw.Shape> = []
  const rows: Array<number> = []
  Array.forEach(
    Array.take(
      Array.filter(mirrors, ({ mirror }) => lit.has(mirror.kind)),
      MOST_MIRRORS,
    ),
    near => {
      // NOTE: a streak keeps two rows off a nearer flame's, of the three
      // shown at most.
      const isTaken = (row: number): boolean =>
        // oxlint-disable-next-line munch/no-nested-scan
        Array.some(rows, other => Math.abs(other - row) < 2)
      const row = isTaken(near.y)
        ? isTaken(near.y + 2)
          ? near.y - 2
          : near.y + 2
        : near.y
      rows.push(row)
      shapes.push(...flameStreaksOf(splat, near, row))
    },
  )
  if (strikeStep > 0) {
    const color = `rgba(${STRIKE_RGB}, ${hundredths(0.2 + (0.6 * strikeStep) / STRIKE_STEPS)})`
    forEachPixel(splat, (x, y) => {
      if (depthAt(splat, x, y - 1) === 0) {
        shapes.push(rect(x, y, 1, 1, color))
      }
    })
  }
  return shapes
}

// THE BUBBLES

// NOTE: a bubble's beat: it swells a pixel at a time, then pops in a ring
// of spray, and the stew lies still till its next.
const SWELL_STEP_MS = 340
const POP_MS = 160
const SWELL_STEPS = 3

export type Bubble = Readonly<{
  x: number
  y: number
  periodMs: number
  offsetMs: number
}>

export const bubblesOfSplat = (splat: Splat): ReadonlyArray<Bubble> =>
  Array.map(
    spotsOf({ splat, cellX: 10, cellY: 7, chance: 0.55, use: 70, kinds: 1 }),
    ({ x, y }) => {
      const periodMs = 2600 + Math.floor(roll(x, y, 80) * 2400)
      return {
        x: x + 1,
        y,
        periodMs,
        offsetMs: Math.floor(roll(x, y, 81) * periodMs),
      }
    },
  )

const BUBBLE_SKIN = 0x8a8236
const BUBBLE_BODY = 0xb4ac62
const BUBBLE_SHINE = 0xeee4aa
const SPRAY = 0xd2c88a

const mote = (
  x: number,
  y: number,
  hover: number,
  width: number,
  color: number,
): Mote => ({ x, y, hover, width, color, alpha: 0.95, isGlowing: true })

// NOTE: each bubble this frame, off the World's clock: a dot, a dome two
// wide, a dome three wide with its shine on top, then its spray.
export const bubbleMotesOf = ({
  bubbles,
  world,
}: Readonly<{
  bubbles: ReadonlyArray<Bubble>
  world: World
}>): ReadonlyArray<Mote> =>
  Array.flatMap(bubbles, ({ x, y, periodMs, offsetMs }) => {
    const since = (world.elapsedMs + offsetMs) % periodMs
    const step = Math.floor(since / SWELL_STEP_MS)
    if (step === 0) {
      return [mote(x, y, 0, 1, BUBBLE_BODY)]
    }
    if (step === 1) {
      return [mote(x, y, 0, 2, BUBBLE_SKIN), mote(x, y, 1, 1, BUBBLE_SHINE)]
    }
    if (step === 2) {
      return [
        mote(x - 1, y, 0, 3, BUBBLE_SKIN),
        mote(x - 1, y, 1, 2, BUBBLE_BODY),
        mote(x, y, 2, 1, BUBBLE_SHINE),
      ]
    }
    return since < SWELL_STEPS * SWELL_STEP_MS + POP_MS
      ? [
          mote(x - 2, y, 0, 1, SPRAY),
          mote(x + 2, y, 0, 1, SPRAY),
          mote(x - 1, y, 2, 1, SPRAY),
          mote(x + 1, y, 3, 1, SPRAY),
        ]
      : []
  })
