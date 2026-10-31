import { Array, Option, Result, pipe } from 'effect'
import type { Canvas } from 'foldkit'

import { type Level, SHOP_STALL_SYMBOL, tilesWithSymbol } from './arena'
import { SHAKE_MAX_PX, TILE_SIZE } from './constants'
import { pixelArt, rect } from './drawing'
import {
  BLOOD_COLOR,
  type Box,
  COBWEB_COLOR,
  COBWEB_FAINT_COLOR,
  FLOOR_COLOR,
  GOLD_COLOR,
  GOLD_DARK_COLOR,
  GOLD_LIGHT_COLOR,
  KNOT_COLOR,
  PLANK_HEIGHT,
  PLANK_JOINTS,
  PLANK_JOINT_COLOR,
  PLANK_SEAM_COLOR,
  PLANK_SHADES,
  SCUFF_COLOR,
  SLIME_PRINT_COLOR,
  boundingBox,
  pick,
  roll,
} from './roomPalette'
import { type Palette, mirrorRows } from './sprite'

// FLOOR

// NOTE: the parlour's plank floor covers the parlour's own block of the
// map, which is the whole map when the level is the parlour alone.
export type Floor = Readonly<{
  width: number
  height: number
  tileCount: number
}>

export const parlourFloorOf = (level: Level): Floor =>
  pipe(
    level.rooms,
    Array.findFirst(({ id }) => id === 'Parlour'),
    Option.match({
      onNone: () => ({
        width: level.width,
        height: level.height,
        tileCount: level.tileCount,
      }),
      onSome: ({ box }) => ({
        width: box.right - box.left,
        height: box.bottom - box.top,
        tileCount:
          ((box.right - box.left) * (box.bottom - box.top)) /
          (TILE_SIZE * TILE_SIZE),
      }),
    }),
  )

const plankRow = (level: Floor, row: number): ReadonlyArray<Canvas.Shape> => {
  const y = row * PLANK_HEIGHT
  const joints = Array.sort(
    Array.makeBy(PLANK_JOINTS, index =>
      Math.floor(((index + roll(row, index)) / PLANK_JOINTS) * level.width),
    ),
    (first: number, second: number) => (first < second ? -1 : 1),
  )
  const edges = [0, ...joints, level.width]
  const segments = Array.zip(Array.dropRight(edges, 1), Array.drop(edges, 1))
  return [
    ...Array.filterMap(segments, ([left, right], index) => {
      const shade = pick(PLANK_SHADES, roll(row, index + 7))
      return shade === FLOOR_COLOR
        ? Result.failVoid
        : Result.succeed(
            rect(left, y + 1, right - left, PLANK_HEIGHT - 1, shade),
          )
    }),
    rect(0, y, level.width, 1, PLANK_SEAM_COLOR),
    ...Array.map(joints, x =>
      rect(x, y + 1, 1, PLANK_HEIGHT - 1, PLANK_JOINT_COLOR),
    ),
  ]
}

const plankRowsOf = (level: Floor): number =>
  Math.ceil(level.height / PLANK_HEIGHT)

const FLOOR_MARKS_PER_TILE = 70 / (32 * 18)

const floorMark = (level: Floor, index: number): Canvas.Shape => {
  const x = Math.floor(roll(index, 101) * level.width)
  const plank = Math.floor(roll(index, 102) * plankRowsOf(level))
  const isKnot = roll(index, 103) < 0.4
  return isKnot
    ? rect(x, plank * PLANK_HEIGHT + 2, 1, 1, KNOT_COLOR)
    : rect(
        x,
        plank * PLANK_HEIGHT + 2,
        2 + Math.floor(roll(index, 104) * 3),
        1,
        SCUFF_COLOR,
      )
}

export const boardShapes = (level: Floor): ReadonlyArray<Canvas.Shape> => [
  rect(
    -SHAKE_MAX_PX,
    -SHAKE_MAX_PX,
    level.width + SHAKE_MAX_PX * 2,
    level.height + SHAKE_MAX_PX * 2,
    FLOOR_COLOR,
  ),
  ...Array.flatMap(
    Array.makeBy(plankRowsOf(level), row => row),
    row => plankRow(level, row),
  ),
  ...Array.makeBy(Math.round(FLOOR_MARKS_PER_TILE * level.tileCount), index =>
    floorMark(level, index),
  ),
]

// RUG

const RUG_EDGE_COLOR = '#4a1622'
const RUG_FIELD_COLOR = '#7d2532'
const RUG_LATTICE_COLOR = '#8e2d3b'
const RUG_WORN_COLOR = '#93404a'
const RUG_STAIN_COLOR = '#4a0f16'
const TASSEL_COLOR = '#7a6a4c'
const TASSEL_SPACING = 2
const LATTICE_SPACING = 8

const diamond = (
  centerX: number,
  centerY: number,
  radius: number,
  fill: string,
): ReadonlyArray<Canvas.Shape> =>
  Array.makeBy(radius * 2 + 1, index => {
    const dy = index - radius
    const halfWidth = radius - Math.abs(dy)
    return rect(centerX - halfWidth, centerY + dy, halfWidth * 2 + 1, 1, fill)
  })

export const rugShapes = (rug: Box): ReadonlyArray<Canvas.Shape> => {
  const { x, y, width, height } = rug
  const right = x + width
  const bottom = y + height
  const centerX = x + Math.floor(width / 2)
  const centerY = y + Math.floor(height / 2)
  const field: Box = {
    x: x + 8,
    y: y + 8,
    width: width - 16,
    height: height - 16,
  }
  const tassels = Array.makeBy(
    Math.floor((height - 4) / TASSEL_SPACING),
    index => {
      const tasselY = y + 2 + index * TASSEL_SPACING
      return [
        rect(x - 2, tasselY, 2, 1, TASSEL_COLOR),
        rect(right, tasselY, 2, 1, TASSEL_COLOR),
      ]
    },
  )
  const borderDots = Array.flatMap(
    Array.makeBy(Math.floor((width - 10) / 6), index => x + 5 + index * 6),
    dotX => [
      rect(dotX, y + 4, 2, 2, GOLD_DARK_COLOR),
      rect(dotX, bottom - 6, 2, 2, GOLD_DARK_COLOR),
    ],
  )
  const sideDots = Array.flatMap(
    Array.makeBy(Math.floor((height - 16) / 6), index => y + 8 + index * 6),
    dotY => [
      rect(x + 4, dotY, 2, 2, GOLD_DARK_COLOR),
      rect(right - 6, dotY, 2, 2, GOLD_DARK_COLOR),
    ],
  )
  const lattice = Array.flatMap(
    Array.makeBy(Math.floor(field.height / LATTICE_SPACING), row => row),
    row =>
      Array.makeBy(Math.floor(field.width / LATTICE_SPACING), column =>
        rect(
          field.x + 3 + column * LATTICE_SPACING + (row % 2) * 4,
          field.y + 3 + row * LATTICE_SPACING,
          1,
          1,
          RUG_LATTICE_COLOR,
        ),
      ),
  )
  const cornerMotif = (
    cornerX: number,
    cornerY: number,
    dx: number,
    dy: number,
  ) => [
    rect(cornerX, cornerY, 1, 1, GOLD_COLOR),
    rect(cornerX + dx, cornerY, 1, 1, GOLD_COLOR),
    rect(cornerX + dx * 2, cornerY, 1, 1, GOLD_COLOR),
    rect(cornerX, cornerY + dy, 1, 1, GOLD_COLOR),
    rect(cornerX, cornerY + dy * 2, 1, 1, GOLD_COLOR),
    rect(cornerX + dx, cornerY + dy, 1, 1, GOLD_DARK_COLOR),
  ]
  const wear = Array.makeBy(26, index => {
    const wearX = field.x + Math.floor(roll(index, 201) * field.width)
    const wearY =
      centerY + 4 + Math.floor(roll(index, 202) * (field.height / 2))
    return rect(
      Math.min(wearX, field.x + field.width - 3),
      Math.min(wearY, field.y + field.height - 2),
      1 + Math.floor(roll(index, 203) * 3),
      1 + Math.floor(roll(index, 204) * 2),
      RUG_WORN_COLOR,
    )
  })
  const biteX = x + 30
  return [
    ...Array.flatten(tassels),
    rect(x, y, width, height, RUG_EDGE_COLOR),
    rect(x + 2, y + 2, width - 4, height - 4, GOLD_COLOR),
    rect(x + 3, y + 3, width - 6, height - 6, RUG_EDGE_COLOR),
    ...borderDots,
    ...sideDots,
    rect(
      field.x - 1,
      field.y - 1,
      field.width + 2,
      field.height + 2,
      GOLD_COLOR,
    ),
    rect(field.x, field.y, field.width, field.height, RUG_FIELD_COLOR),
    ...lattice,
    ...cornerMotif(field.x + 2, field.y + 2, 1, 1),
    ...cornerMotif(field.x + field.width - 3, field.y + 2, -1, 1),
    ...cornerMotif(field.x + 2, field.y + field.height - 3, 1, -1),
    ...cornerMotif(
      field.x + field.width - 3,
      field.y + field.height - 3,
      -1,
      -1,
    ),
    ...diamond(centerX, centerY, 15, GOLD_COLOR),
    ...diamond(centerX, centerY, 13, RUG_EDGE_COLOR),
    ...diamond(centerX, centerY, 9, GOLD_DARK_COLOR),
    ...diamond(centerX, centerY, 7, RUG_FIELD_COLOR),
    ...diamond(centerX, centerY, 3, GOLD_LIGHT_COLOR),
    rect(centerX, centerY, 1, 1, RUG_EDGE_COLOR),
    ...wear,
    rect(centerX + 24, centerY + 14, 6, 3, RUG_STAIN_COLOR),
    rect(centerX + 23, centerY + 15, 9, 2, RUG_STAIN_COLOR),
    rect(centerX + 31, centerY + 17, 2, 1, RUG_STAIN_COLOR),
    // NOTE: something took a bite out of the rug's corner and its edge.
    rect(right - 7, y, 7, 2, FLOOR_COLOR),
    rect(right - 5, y + 2, 5, 2, FLOOR_COLOR),
    rect(right - 2, y + 4, 2, 2, FLOOR_COLOR),
    rect(right - 8, y + 2, 1, 1, PLANK_SEAM_COLOR),
    rect(right, y, 3, 6, FLOOR_COLOR),
    rect(biteX, bottom - 2, 8, 2, FLOOR_COLOR),
    rect(biteX + 1, bottom - 3, 6, 1, FLOOR_COLOR),
    rect(biteX + 2, bottom - 4, 4, 1, FLOOR_COLOR),
    rect(biteX + 10, bottom - 2, 5, 2, FLOOR_COLOR),
    rect(biteX + 11, bottom - 3, 3, 1, FLOOR_COLOR),
  ]
}

export const PARLOUR_RUG: Box = { x: 98, y: 34, width: 124, height: 98 }

const GLOW_ROWS = 26
const GLOW_RINGS = 3

// NOTE: the hearth's warm light: a row of nested strips for each pixel row
// out from the fire, fainter and narrower the farther they are.
export const fireGlow = (hearth: Box): ReadonlyArray<Canvas.Shape> => {
  const centerX = Math.floor(hearth.x + hearth.width / 2)
  const top = hearth.y + hearth.height
  return Array.flatMap(
    Array.makeBy(GLOW_ROWS, row => row),
    row => {
      const fade = 1 - row / GLOW_ROWS
      return Array.makeBy(GLOW_RINGS, ring => {
        const half = Math.round((ring + 1) * 15 * (0.55 + 0.45 * fade))
        return rect(
          centerX - half,
          top + row,
          half * 2,
          1,
          `rgba(255, 150, 60, ${(0.04 * fade).toFixed(3)})`,
        )
      })
    },
  )
}

const STALL_MAT_COLOR = '#2c3d33'
const STALL_MAT_EDGE_COLOR = '#1d2a22'

export const stallMatShapes = (stall: Box): ReadonlyArray<Canvas.Shape> => {
  const x = stall.x - 8
  const y = stall.y - 10
  const width = stall.width + 16
  const height = stall.height + 10
  return [
    rect(x, y, width, height, STALL_MAT_EDGE_COLOR),
    rect(x + 1, y + 1, width - 2, height - 1, GOLD_DARK_COLOR),
    rect(x + 2, y + 2, width - 4, height - 2, STALL_MAT_COLOR),
    ...Array.makeBy(Math.floor((width - 6) / 4), index =>
      rect(x + 3 + index * 4, y + 4, 2, 1, '#3a5244'),
    ),
  ]
}

export const stallBox = (level: Level): Option.Option<Box> =>
  pipe(
    tilesWithSymbol(level, SHOP_STALL_SYMBOL),
    Option.liftPredicate(Array.isReadonlyArrayNonEmpty),
    Option.map(boundingBox),
  )

export const bloodTrail = (
  points: ReadonlyArray<readonly [number, number, number, number]>,
): ReadonlyArray<Canvas.Shape> =>
  Array.map(points, ([x, y, width, height]) =>
    rect(x, y, width, height, BLOOD_COLOR),
  )

// NOTE: slimy footprints walk in from the south door and wander off.
const SLIME_STEPS = 9

export const slimePrints = (door: Box): ReadonlyArray<Canvas.Shape> =>
  Array.makeBy(SLIME_STEPS, index => {
    const isLeft = index % 2 === 0
    return rect(
      door.x + 6 + (isLeft ? 0 : 5) + index * 2,
      door.y - 6 - index * 5,
      2,
      3,
      SLIME_PRINT_COLOR,
    )
  })

const COBWEB_PIXELS: ReadonlyArray<string> = [
  'WwwwwwwW',
  'wWw.w.w.',
  'wwWw.w..',
  'w.wWw...',
  'ww.wW...',
  'w.w..W..',
  'ww....W.',
  'W.......',
]

const COBWEB_PALETTE: Palette = { W: COBWEB_COLOR, w: COBWEB_FAINT_COLOR }

export const cobweb = (
  x: number,
  y: number,
  facesRight: boolean,
  facesDown: boolean,
): ReadonlyArray<Canvas.Shape> => {
  const flipped = facesRight ? COBWEB_PIXELS : mirrorRows(COBWEB_PIXELS)
  const pixels = facesDown ? flipped : Array.reverse(flipped)
  return pixelArt(
    facesRight ? x : x - 8,
    facesDown ? y : y - 8,
    pixels,
    COBWEB_PALETTE,
  )
}
