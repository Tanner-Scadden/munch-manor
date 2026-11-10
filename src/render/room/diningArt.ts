import { Array, Function, Option, Result } from 'effect'
import type { Canvas } from 'foldkit'

import { type Palette, bakeShapes } from '../../art/sprite'
import { TILE_SIZE } from '../../shared/constants'
import { type Level, symbolAt } from '../../world/level/arena'
import { CHANDELIER_SYMBOL } from '../../world/level/plan'
import { pixelArt, rect } from '../drawing'
import {
  BONE_COLOR,
  type Box,
  CANDLE_COLOR,
  CASING_COLOR,
  CASING_DARK_COLOR,
  CASING_LIGHT_COLOR,
  CHAIR_RAIL_Y,
  FACE_TOP,
  FLAME_COLOR,
  FLAME_TIP_COLOR,
  GOLD_COLOR,
  GOLD_DARK_COLOR,
  GOLD_LIGHT_COLOR,
  INK_COLOR,
  ZOMBIE_SKIN_COLOR,
  pick,
  roll,
} from './roomPalette'
import { type Span, spansWithin } from './roomWalls'

// NOTE: the dining room, where the Munches' party has been going for a
// hundred years: a parquet floor, burgundy damask with the family on the
// walls, the long table still set for the feast, the sideboard of silver,
// the china cabinets, the standing candelabras, the chandelier over the gap
// in the table, and the locked front door. Everything but the chandelier is
// drawn once into the room's image; the chandelier is its own sprite, hung
// or fallen, so it can drop.

// PALETTE

const PARQUET_COLOR = '#4a3426'
const PARQUET_SHADES: Array.NonEmptyReadonlyArray<string> = [
  PARQUET_COLOR,
  '#503829',
  '#443022',
  '#4d3628',
  '#47321f',
]
const PARQUET_SEAM_COLOR = '#3a291e'
const PARQUET_JOINT_COLOR = '#41301f'
const PARQUET_GRAIN_COLOR = '#56402e'

const PAPER_COLOR = '#4a1f2a'
const PAPER_STRIPE_COLOR = '#55242f'
const PAPER_MOTIF_COLOR = '#6e3340'
const PAPER_MOTIF_GOLD_COLOR = '#7a5a3a'

const RUNNER_EDGE_COLOR = '#3a1018'
const RUNNER_FIELD_COLOR = '#5e1a26'
const RUNNER_MOTIF_COLOR = '#7a2a36'
const RUNNER_WORN_COLOR = '#6e3038'
const FRINGE_COLOR = '#8a7a5a'

const CLOTH_COLOR = '#d8cfb4'
const CLOTH_LIGHT_COLOR = '#e8e0c8'
const CLOTH_SHADE_COLOR = '#b8ad90'
const CLOTH_DARK_COLOR = '#8f8670'
const CLOTH_STAIN_COLOR = 'rgba(120, 90, 40, 0.3)'
const WINE_STAIN_COLOR = 'rgba(110, 20, 40, 0.45)'
const TABLE_RUNNER_COLOR = '#7a2338'
const PLATE_COLOR = '#e8e2d0'
const PLATE_SHADE_COLOR = '#b8b2a0'
const SILVER_COLOR = '#c0c4cc'
const SILVER_LIGHT_COLOR = '#e8ecf2'
const SILVER_DARK_COLOR = '#7a7e88'
const MUSH_COLOR = '#6a8a3a'
const ROT_COLOR = '#3a2a1a'
const CAKE_COLOR = '#e8c8d0'
const CAKE_SHADE_COLOR = '#c8a0ac'
const CAKE_ROT_COLOR = '#8a9a6a'
const CHAIR_COLOR = '#3a2214'
const CHAIR_LIGHT_COLOR = '#5a3a22'
const CHAIR_SEAT_COLOR = '#6a1e2e'

const WOOD_COLOR = '#4a2a18'
const WOOD_LIGHT_COLOR = '#6b4423'
const WOOD_DARK_COLOR = '#2e1a0e'
const GLASS_COLOR = '#22303a'
const GLASS_SHINE_COLOR = 'rgba(200, 230, 255, 0.35)'
const CHINA_BLUE_COLOR = '#3d5a9a'

const DOOR_OAK_COLOR = '#3a2214'
const DOOR_OAK_LIGHT_COLOR = '#4e3020'
const IRON_COLOR = '#2a2a30'
const IRON_LIGHT_COLOR = '#5a5a66'
const STONE_COLOR = '#6b6170'
const STONE_LIGHT_COLOR = '#857a8c'
const TRANSOM_LIGHT_COLOR = '#ffcf7a'

const BUNTING_COLORS: Array.NonEmptyReadonlyArray<string> = [
  '#8a4a5a',
  '#5a7a5a',
  '#8a7a3a',
  '#4a5a8a',
]
const BUNTING_STRING_COLOR = '#7a6a5a'

// FLOOR

const PARQUET_CELL = TILE_SIZE

// NOTE: basket weave parquet: each tile is two planks, lying across on one
// tile and along on the next, like a checkerboard.
const parquetCell = (
  room: Box,
  column: number,
  row: number,
): ReadonlyArray<Canvas.Shape> => {
  const x = room.x + column * PARQUET_CELL
  const y = room.y + row * PARQUET_CELL
  const half = PARQUET_CELL / 2
  const isAcross = (column + row) % 2 === 0
  const first = pick(PARQUET_SHADES, roll(column + 900, row))
  const second = pick(PARQUET_SHADES, roll(row + 900, column))
  return isAcross
    ? [
        rect(x, y, PARQUET_CELL, half, first),
        rect(x, y + half, PARQUET_CELL, half, second),
        rect(x, y + half, PARQUET_CELL, 1, PARQUET_JOINT_COLOR),
        rect(
          x + 1 + Math.floor(roll(column, row + 950) * 6),
          y + 2,
          3,
          1,
          PARQUET_GRAIN_COLOR,
        ),
      ]
    : [
        rect(x, y, half, PARQUET_CELL, first),
        rect(x + half, y, half, PARQUET_CELL, second),
        rect(x + half, y, 1, PARQUET_CELL, PARQUET_JOINT_COLOR),
        rect(
          x + 2,
          y + 1 + Math.floor(roll(column + 950, row) * 6),
          1,
          3,
          PARQUET_GRAIN_COLOR,
        ),
      ]
}

export const diningFloorShapes = (room: Box): ReadonlyArray<Canvas.Shape> => {
  const columns = Math.ceil(room.width / PARQUET_CELL)
  const rows = Math.ceil(room.height / PARQUET_CELL)
  return [
    rect(room.x, room.y, room.width, room.height, PARQUET_COLOR),
    ...Array.flatMap(
      Array.makeBy(rows, row => row),
      row =>
        Array.flatMap(
          Array.makeBy(columns, column => column),
          column => parquetCell(room, column, row),
        ),
    ),
    ...Array.makeBy(rows, row =>
      rect(
        room.x,
        room.y + row * PARQUET_CELL,
        room.width,
        1,
        PARQUET_SEAM_COLOR,
      ),
    ),
    ...Array.makeBy(columns, column =>
      rect(
        room.x + column * PARQUET_CELL,
        room.y,
        1,
        room.height,
        PARQUET_SEAM_COLOR,
      ),
    ),
  ]
}

// RUNNER RUGS

const FRINGE_STEP = 2

// NOTE: a long runner with a fringe at its two short ends, a border, and a
// row of medallions down its middle, worn where a century of feet went.
const runnerShapes = (rug: Box): ReadonlyArray<Canvas.Shape> => {
  const { x, y, width, height } = rug
  const isAcross = width >= height
  const length = isAcross ? width : height
  const motifs = Math.floor((length - 16) / 14)
  const centerX = x + Math.floor(width / 2)
  const centerY = y + Math.floor(height / 2)
  const fringe = isAcross
    ? Array.flatMap(
        Array.makeBy(Math.floor((height - 2) / FRINGE_STEP), index => index),
        index => [
          rect(x - 2, y + 1 + index * FRINGE_STEP, 2, 1, FRINGE_COLOR),
          rect(x + width, y + 1 + index * FRINGE_STEP, 2, 1, FRINGE_COLOR),
        ],
      )
    : Array.flatMap(
        Array.makeBy(Math.floor((width - 2) / FRINGE_STEP), index => index),
        index => [
          rect(x + 1 + index * FRINGE_STEP, y - 2, 1, 2, FRINGE_COLOR),
          rect(x + 1 + index * FRINGE_STEP, y + height, 1, 2, FRINGE_COLOR),
        ],
      )
  const motifAt = (index: number): ReadonlyArray<Canvas.Shape> => {
    const along = 8 + 7 + index * 14
    const motifX = isAcross ? x + along : centerX
    const motifY = isAcross ? centerY : y + along
    return [
      rect(motifX - 3, motifY, 7, 1, GOLD_DARK_COLOR),
      rect(motifX, motifY - 3, 1, 7, GOLD_DARK_COLOR),
      rect(motifX - 2, motifY - 1, 5, 3, RUNNER_MOTIF_COLOR),
      rect(motifX - 1, motifY - 2, 3, 5, RUNNER_MOTIF_COLOR),
      rect(motifX, motifY, 1, 1, GOLD_LIGHT_COLOR),
    ]
  }
  const wear = Array.makeBy(Math.floor(length / 6), index =>
    rect(
      x + 4 + Math.floor(roll(index, 710) * (width - 10)),
      y + 4 + Math.floor(roll(index, 711) * (height - 10)),
      1 + Math.floor(roll(index, 712) * 3),
      1 + Math.floor(roll(index, 713) * 2),
      RUNNER_WORN_COLOR,
    ),
  )
  return [
    ...fringe,
    rect(x, y, width, height, RUNNER_EDGE_COLOR),
    rect(x + 2, y + 2, width - 4, height - 4, GOLD_DARK_COLOR),
    rect(x + 3, y + 3, width - 6, height - 6, RUNNER_EDGE_COLOR),
    rect(x + 5, y + 5, width - 10, height - 10, GOLD_COLOR),
    rect(x + 6, y + 6, width - 12, height - 12, RUNNER_FIELD_COLOR),
    ...wear,
    ...Array.flatMap(
      Array.makeBy(motifs, index => index),
      motifAt,
    ),
  ]
}

// NOTE: the rug under the party table, and the hall runner from the front
// door up to the gap, placed by hand on the drafted map (docs/ROOM_DRAFTS.md).
export const diningRugShapes = (room: Box): ReadonlyArray<Canvas.Shape> => [
  ...runnerShapes({ x: room.x + 62, y: room.y + 86, width: 236, height: 48 }),
  ...runnerShapes({ x: room.x + 166, y: room.y + 138, width: 28, height: 62 }),
  // NOTE: a dropped napkin and a spilled goblet's stain on the rug.
  rect(room.x + 104, room.y + 128, 5, 3, CLOTH_COLOR),
  rect(room.x + 105, room.y + 128, 3, 1, CLOTH_LIGHT_COLOR),
  rect(room.x + 250, room.y + 90, 8, 3, WINE_STAIN_COLOR),
  rect(room.x + 252, room.y + 93, 5, 2, WINE_STAIN_COLOR),
]

// WALLS

const paperShapes = ({ x, y, width }: Span): ReadonlyArray<Canvas.Shape> => {
  const top = y - TILE_SIZE * 2 + FACE_TOP + 2
  const railY = y - TILE_SIZE * 2 + CHAIR_RAIL_Y
  const columns = Array.makeBy(width, index => x + index)
  return [
    rect(x, top, width, railY - top, PAPER_COLOR),
    ...Array.filterMap(columns, column =>
      column % 8 === 0
        ? Result.succeed(rect(column, top, 1, railY - top, PAPER_STRIPE_COLOR))
        : Result.failVoid,
    ),
    ...Array.flatMap(columns, column =>
      column % 8 === 4
        ? [
            rect(column, top + 1, 1, 1, PAPER_MOTIF_GOLD_COLOR),
            rect(column - 1, top + 2, 3, 1, PAPER_MOTIF_COLOR),
            rect(column - 2, top + 3, 5, 1, PAPER_MOTIF_COLOR),
            rect(column - 1, top + 4, 3, 1, PAPER_MOTIF_COLOR),
            rect(column, top + 5, 1, 1, PAPER_MOTIF_GOLD_COLOR),
            rect(column, top + 7, 1, 1, PAPER_MOTIF_COLOR),
          ]
        : [],
    ),
  ]
}

// NOTE: the party's bunting, a hundred years old, sagging along the top of
// every stretch of wall, with a pennant gone here and there.
const buntingShapes = ({ x, y, width }: Span): ReadonlyArray<Canvas.Shape> => {
  const stringY = y - TILE_SIZE * 2 + FACE_TOP + 3
  const count = Math.floor((width - 4) / 7)
  return [
    ...Array.makeBy(count + 1, index =>
      rect(
        x + 1 + index * 7,
        stringY + (index % 2 === 0 ? 0 : 1),
        7,
        1,
        BUNTING_STRING_COLOR,
      ),
    ),
    ...Array.flatMap(
      Array.makeBy(count, index => index),
      index => {
        if (roll(x + index, 720) < 0.15) {
          return []
        }
        const pennantX = x + 3 + index * 7
        const pennantY = stringY + 1 + (index % 2 === 0 ? 0 : 1)
        const color = pick(BUNTING_COLORS, roll(index, x + 721))
        return [
          rect(pennantX, pennantY, 5, 1, color),
          rect(pennantX + 1, pennantY + 1, 3, 1, color),
          rect(pennantX + 2, pennantY + 2, 1, 1, color),
        ]
      },
    ),
  ]
}

// NOTE: burgundy damask over the parlour's wainscot, and the bunting, on
// the stretches of north wall inside the dining room's block.
export const diningWallShapes: {
  (room: Box): (level: Level) => ReadonlyArray<Canvas.Shape>
  (level: Level, room: Box): ReadonlyArray<Canvas.Shape>
} = Function.dual(2, (level: Level, room: Box): ReadonlyArray<Canvas.Shape> =>
  Array.flatMap(spansWithin(level, room), (span: Span) => [
    ...paperShapes(span),
    ...buntingShapes(span),
  ]),
)

// THE FAMILY ON THE WALL

const UNCLE_CHUNK_PIXELS: ReadonlyArray<string> = [
  'FFFFFFFFFFFFFFFFFF',
  'FffffffffffffffffF',
  'Ff......pk......fF',
  'Ff.....pPpP.....fF',
  'Ff....PpPpPp....fF',
  'Ff...SSSSSSSS...fF',
  'Ff..SSwkSSwkSS..fF',
  'Ff..SSSmmmmSSS..fF',
  'Ff...SSSSSSSS...fF',
  'Ff.ttttwbbwtttt.fF',
  'FffffffffffffffffF',
  'FFFFFFFFFFFFFFFFFF',
]

const UNCLE_CHUNK_PALETTE: Palette = {
  F: GOLD_COLOR,
  f: GOLD_DARK_COLOR,
  '.': '#2a1a30',
  p: '#c8463c',
  P: '#ffd23f',
  k: '#f4f1de',
  S: ZOMBIE_SKIN_COLOR,
  w: '#f4f1de',
  m: '#4a1010',
  t: '#141018',
  b: '#c8343c',
}

const LADY_PIXELS: ReadonlyArray<string> = [
  'FFFFFFFFFFFF',
  'Ff..hhhh..fF',
  'Ff.hhhhhh.fF',
  'Ff.hSSSSh.fF',
  'Ff.hwSSwh.fF',
  'Ff.hSSSSh.fF',
  'Ff..SmmS..fF',
  'Ff..pppp..fF',
  'Ff.dddddd.fF',
  'Ff.dddddd.fF',
  'FFFFFFFFFFFF',
]

const LADY_PALETTE: Palette = {
  F: GOLD_COLOR,
  f: GOLD_DARK_COLOR,
  '.': '#1e2a34',
  h: '#c8b070',
  S: '#a8c890',
  w: '#c8343c',
  m: '#6a1a2a',
  p: '#f4f1de',
  d: '#3a5a7a',
}

const HOUND_PIXELS: ReadonlyArray<string> = [
  'FFFFFFFFFFFF',
  'Ff........fF',
  'Ff.ee..ee.fF',
  'Ff.eBBBBe.fF',
  'Ff..BwBw..fF',
  'Ff..BBBB..fF',
  'Ff...nn...fF',
  'Ff.rrrrrr.fF',
  'Ff.rrrrrr.fF',
  'Ff..BBBB..fF',
  'FFFFFFFFFFFF',
]

const HOUND_PALETTE: Palette = {
  F: GOLD_COLOR,
  f: GOLD_DARK_COLOR,
  '.': '#2a2418',
  e: '#5a3a22',
  B: '#8a6a44',
  w: '#e8f070',
  n: '#141018',
  r: '#f4f1de',
}

const MANOR_PAINTING_PIXELS: ReadonlyArray<string> = [
  'FFFFFFFFFFFFFFFF',
  'FffffffffffffffF',
  'FfsssssssssmssfF',
  'FfssssshhsssssfF',
  'FfsssshhhhssssfF',
  'FfssshhwhwhsssfF',
  'FfssshhhhhhsssfF',
  'FfgggghhdhhgggfF',
  'FfggggggggggggfF',
  'FffffffffffffffF',
  'FFFFFFFFFFFFFFFF',
]

const MANOR_PAINTING_PALETTE: Palette = {
  F: GOLD_COLOR,
  f: GOLD_DARK_COLOR,
  s: '#1c2a44',
  m: '#e8e0b0',
  h: '#141018',
  w: FLAME_COLOR,
  d: '#3a2a1a',
  g: '#18301c',
}

// NOTE: the Munches, hung by hand between the drafted room's doors and
// furniture: a lady in pearls, Uncle Chunk in his party hat over the
// sideboard, the manor on its hill, and the family hound in a ruff.
export const diningWallDecorShapes = (
  room: Box,
): ReadonlyArray<Canvas.Shape> => [
  ...pixelArt(room.x + 24, room.y + 5, LADY_PIXELS, LADY_PALETTE),
  ...pixelArt(
    room.x + 92,
    room.y + 6,
    MANOR_PAINTING_PIXELS,
    MANOR_PAINTING_PALETTE,
  ),
  ...pixelArt(
    room.x + 171,
    room.y + 3,
    UNCLE_CHUNK_PIXELS,
    UNCLE_CHUNK_PALETTE,
  ),
  ...pixelArt(room.x + 242, room.y + 5, HOUND_PIXELS, HOUND_PALETTE),
  ...pixelArt(room.x + 318, room.y + 5, LADY_PIXELS, {
    ...LADY_PALETTE,
    h: '#3a2a1a',
    d: '#5a2a4a',
    S: '#9ab880',
  }),
]

// NOTE: the umbrella stand by the East door, a hiding spot: two black
// umbrellas and a cane in a cracked china pot.
export const umbrellaStandShapes = (room: Box): ReadonlyArray<Canvas.Shape> => {
  const x = room.x + 342
  const y = room.y + 190
  return [
    rect(x + 1, y + 9, 7, 1, 'rgba(0, 0, 0, 0.35)'),
    rect(x + 2, y - 5, 1, 9, INK_COLOR),
    rect(x + 1, y - 7, 3, 3, '#242030'),
    rect(x + 2, y - 8, 1, 1, '#242030'),
    rect(x + 5, y - 6, 1, 10, INK_COLOR),
    rect(x + 4, y - 9, 3, 4, '#2a2436'),
    rect(x + 6, y - 7, 2, 1, '#2a2436'),
    rect(x + 7, y - 4, 1, 8, CASING_COLOR),
    rect(x + 7, y - 5, 2, 1, CASING_LIGHT_COLOR),
    rect(x + 1, y + 1, 7, 8, '#d8d4c8'),
    rect(x + 1, y + 1, 7, 1, '#e8e4d8'),
    rect(x + 1, y + 4, 7, 1, CHINA_BLUE_COLOR),
    rect(x + 3, y + 6, 1, 2, '#8a8478'),
    rect(x + 4, y + 7, 1, 1, '#8a8478'),
  ]
}

// THE PARTY TABLE

const SEAT_STEP = 15

const northChair = (seatX: number, y: number): ReadonlyArray<Canvas.Shape> => [
  rect(seatX - 1, y - 9, 9, 2, CHAIR_LIGHT_COLOR),
  rect(seatX, y - 7, 7, 7, CHAIR_COLOR),
  rect(seatX + 2, y - 7, 3, 6, CHAIR_SEAT_COLOR),
  rect(seatX + 3, y - 6, 1, 4, '#8a2a40'),
]

const southChair = (
  seatX: number,
  y: number,
  isPulledOut: boolean,
): ReadonlyArray<Canvas.Shape> => {
  const chairY = y + (isPulledOut ? 15 : 13)
  return [
    rect(seatX, chairY, 7, 7, CHAIR_COLOR),
    rect(seatX - 1, chairY - 1, 9, 2, CHAIR_LIGHT_COLOR),
    rect(seatX + 2, chairY + 1, 3, 5, CHAIR_SEAT_COLOR),
    rect(seatX + 3, chairY + 2, 1, 3, '#8a2a40'),
    rect(seatX, chairY + 7, 1, 1, WOOD_DARK_COLOR),
    rect(seatX + 6, chairY + 7, 1, 1, WOOD_DARK_COLOR),
  ]
}

// NOTE: what a guest left on the plate, picked by a fixed roll.
const leftovers = (
  plateX: number,
  plateY: number,
  seed: number,
): ReadonlyArray<Canvas.Shape> => {
  const kind = Math.floor(roll(seed, 730) * 4)
  return kind === 0
    ? [rect(plateX + 2, plateY + 1, 2, 1, MUSH_COLOR)]
    : kind === 1
      ? [
          rect(plateX + 1, plateY + 1, 4, 1, BONE_COLOR),
          rect(plateX + 1, plateY, 1, 1, BONE_COLOR),
        ]
      : kind === 2
        ? [rect(plateX + 2, plateY + 1, 3, 1, ROT_COLOR)]
        : []
}

const placeSetting = (
  plateX: number,
  plateY: number,
  seed: number,
): ReadonlyArray<Canvas.Shape> => [
  rect(plateX, plateY, 6, 3, PLATE_COLOR),
  rect(plateX + 1, plateY + 1, 4, 1, PLATE_SHADE_COLOR),
  ...leftovers(plateX, plateY, seed),
  rect(plateX - 2, plateY, 1, 3, SILVER_DARK_COLOR),
  rect(plateX + 7, plateY, 1, 3, SILVER_COLOR),
  ...(roll(seed, 731) < 0.2
    ? [rect(plateX + 8, plateY + 1, 2, 1, GOLD_DARK_COLOR)]
    : [
        rect(plateX + 8, plateY - 2, 2, 2, GOLD_COLOR),
        rect(plateX + 9, plateY, 1, 2, GOLD_DARK_COLOR),
      ]),
]

const tableCandelabra = (
  centerX: number,
  y: number,
): ReadonlyArray<Canvas.Shape> => [
  rect(centerX - 8, y - 6, 17, 10, 'rgba(255, 200, 90, 0.08)'),
  rect(centerX - 2, y + 7, 5, 2, GOLD_DARK_COLOR),
  rect(centerX, y + 1, 1, 6, GOLD_COLOR),
  rect(centerX - 3, y + 1, 7, 1, GOLD_COLOR),
  rect(centerX - 3, y - 2, 1, 3, CANDLE_COLOR),
  rect(centerX, y - 3, 1, 4, CANDLE_COLOR),
  rect(centerX + 3, y - 2, 1, 3, CANDLE_COLOR),
  rect(centerX - 3, y - 3, 1, 1, FLAME_COLOR),
  rect(centerX, y - 4, 1, 1, FLAME_COLOR),
  rect(centerX + 3, y - 3, 1, 1, FLAME_COLOR),
  rect(centerX, y - 5, 1, 1, FLAME_TIP_COLOR),
]

// NOTE: the birthday cake, a hundred years old, its candles somehow lit,
// with Uncle Chunk's spare party hat beside it.
const cakeShapes = (x: number, y: number): ReadonlyArray<Canvas.Shape> => [
  rect(x - 1, y + 9, 16, 2, SILVER_DARK_COLOR),
  rect(x, y + 8, 14, 2, SILVER_COLOR),
  rect(x + 1, y + 3, 12, 6, CAKE_COLOR),
  rect(x + 1, y + 3, 12, 1, CLOTH_LIGHT_COLOR),
  rect(x + 1, y + 7, 12, 1, CAKE_SHADE_COLOR),
  rect(x + 3, y - 1, 8, 4, CAKE_COLOR),
  rect(x + 3, y - 1, 8, 1, CLOTH_LIGHT_COLOR),
  rect(x + 3, y + 2, 8, 1, CAKE_SHADE_COLOR),
  rect(x + 5, y - 4, 4, 3, CAKE_COLOR),
  rect(x + 5, y - 4, 4, 1, CLOTH_LIGHT_COLOR),
  // NOTE: drips, mould, and a slice long gone.
  rect(x + 2, y + 4, 1, 2, CLOTH_LIGHT_COLOR),
  rect(x + 6, y + 4, 1, 3, CLOTH_LIGHT_COLOR),
  rect(x + 10, y + 4, 1, 1, CLOTH_LIGHT_COLOR),
  rect(x + 9, y + 5, 2, 2, CAKE_ROT_COLOR),
  rect(x + 4, y, 1, 1, CAKE_ROT_COLOR),
  rect(x + 11, y + 3, 2, 5, '#8a5a4a'),
  rect(x + 11, y + 3, 2, 1, CAKE_SHADE_COLOR),
  rect(x + 6, y - 7, 1, 3, '#7ab0e0'),
  rect(x + 8, y - 6, 1, 2, '#e07ab0'),
  rect(x + 6, y - 8, 1, 1, FLAME_COLOR),
  rect(x + 8, y - 7, 1, 1, FLAME_COLOR),
  rect(x + 3, y - 10, 9, 5, 'rgba(255, 210, 63, 0.1)'),
  // NOTE: the spare party hat, tipped over.
  rect(x + 16, y + 6, 6, 2, '#c8463c'),
  rect(x + 18, y + 5, 3, 1, '#ffd23f'),
  rect(x + 21, y + 5, 2, 1, '#c8463c'),
  rect(x + 23, y + 4, 1, 1, '#f4f1de'),
]

// NOTE: the roast: a picked turkey on a silver platter, and a green punch.
const roastShapes = (x: number, y: number): ReadonlyArray<Canvas.Shape> => [
  rect(x - 1, y + 2, 16, 7, SILVER_DARK_COLOR),
  rect(x, y + 2, 14, 6, SILVER_COLOR),
  rect(x + 1, y + 2, 12, 1, SILVER_LIGHT_COLOR),
  rect(x + 3, y + 3, 8, 4, '#8a5a2a'),
  rect(x + 3, y + 3, 8, 1, '#a8703a'),
  ...Array.makeBy(4, index => rect(x + 4 + index * 2, y + 2, 1, 4, BONE_COLOR)),
  rect(x + 2, y + 5, 2, 1, BONE_COLOR),
  rect(x + 11, y + 5, 3, 1, BONE_COLOR),
  rect(x + 13, y + 4, 1, 1, BONE_COLOR),
  rect(x + 20, y + 1, 9, 7, SILVER_COLOR),
  rect(x + 21, y + 1, 7, 1, SILVER_LIGHT_COLOR),
  rect(x + 21, y + 2, 7, 4, '#6a9a3a'),
  rect(x + 22, y + 2, 2, 1, '#a6c450'),
  rect(x + 26, y + 3, 1, 1, MUSH_COLOR),
  rect(x + 27, y - 2, 1, 5, SILVER_COLOR),
]

// NOTE: one half of the party table, the cloth draped to the floor, chairs
// on both long sides and at the far end, the runner down the middle, place
// settings, candelabras, and the feast: the cake on the west half, the roast
// on the east. The two halves meet at the gap under the chandelier.
export const partyTableShapes: {
  (level: Level): (box: Box) => ReadonlyArray<Canvas.Shape>
  (box: Box, level: Level): ReadonlyArray<Canvas.Shape>
} = Function.dual(2, (box: Box, level: Level): ReadonlyArray<Canvas.Shape> => {
  const { x, y, width } = box
  // NOTE: the west half is the one whose east end meets the gap.
  const isWest = Option.exists(
    symbolAt(level, (x + width) / TILE_SIZE, y / TILE_SIZE),
    symbol => symbol === CHANDELIER_SYMBOL,
  )
  const seats = Math.floor((width - 6) / SEAT_STEP)
  const seatXs = Array.makeBy(seats, index => x + 5 + index * SEAT_STEP)
  const headX = isWest ? x - 7 : x + width
  return [
    ...Array.flatMap(seatXs, seatX => northChair(seatX, y)),
    // NOTE: the chair at the table's far end.
    rect(headX, y - 4, 7, 18, CHAIR_COLOR),
    rect(headX + (isWest ? 0 : 5), y - 6, 2, 21, CHAIR_LIGHT_COLOR),
    rect(headX + 2, y - 1, 3, 12, CHAIR_SEAT_COLOR),
    rect(x, y - 2, width, 16, CLOTH_COLOR),
    rect(x, y - 2, width, 1, CLOTH_LIGHT_COLOR),
    rect(x, y + 13, width, 6, CLOTH_SHADE_COLOR),
    rect(x, y + 13, width, 1, CLOTH_DARK_COLOR),
    ...Array.makeBy(Math.floor(width / 4), index =>
      rect(x + 1 + index * 4, y + 18, 2, 1, CLOTH_DARK_COLOR),
    ),
    ...Array.makeBy(Math.floor(width / 4), index =>
      rect(x + 2 + index * 4, y + 16, 1, 1, CLOTH_LIGHT_COLOR),
    ),
    rect(x, y + 4, width, 4, TABLE_RUNNER_COLOR),
    rect(x, y + 4, width, 1, GOLD_DARK_COLOR),
    rect(x, y + 7, width, 1, GOLD_DARK_COLOR),
    ...Array.makeBy(5, index =>
      rect(
        x + 4 + Math.floor(roll(index, x + 740) * (width - 12)),
        y + Math.floor(roll(index, x + 741) * 11),
        3 + Math.floor(roll(index, 742) * 4),
        2,
        index === 0 ? WINE_STAIN_COLOR : CLOTH_STAIN_COLOR,
      ),
    ),
    ...Array.flatMap(seatXs, (seatX, index) => [
      ...placeSetting(seatX, y - 1, x + index),
      ...placeSetting(seatX, y + 9, x + index + 50),
    ]),
    ...(isWest
      ? [...cakeShapes(x + width - 34, y - 1), ...tableCandelabra(x + 20, y)]
      : [...roastShapes(x + 12, y - 1), ...tableCandelabra(x + width - 20, y)]),
    ...tableCandelabra(x + Math.floor(width / 2) + (isWest ? -8 : 8), y),
    ...Array.flatMap(seatXs, (seatX, index) =>
      southChair(seatX, y, roll(index, x + 743) < 0.3),
    ),
    // NOTE: legs where the cloth ends at the gap.
    rect(isWest ? x + width - 2 : x, y + 18, 2, 2, WOOD_DARK_COLOR),
  ]
})

// HUTCHES

// NOTE: the long sideboard against the north wall, its top crowded with
// silver: candlesticks, a tea service, a cloche, plates, a fruit bowl gone
// bad. Its left drawer is open a crack, with the silver spoon in it.
const sideboardShapes = ({ x, y, width }: Box): ReadonlyArray<Canvas.Shape> => {
  const right = x + width
  const doors = Math.floor((width - 8) / 18)
  return [
    rect(x, y - 4, width, 13, WOOD_COLOR),
    rect(x - 1, y - 5, width + 2, 3, WOOD_LIGHT_COLOR),
    rect(x - 1, y - 5, width + 2, 1, '#8a5a32'),
    rect(x + 1, y - 2, width - 2, 1, WOOD_DARK_COLOR),
    ...Array.flatMap(
      Array.makeBy(doors, index => x + 4 + index * 18),
      doorX => [
        rect(doorX, y - 1, 16, 3, WOOD_DARK_COLOR),
        rect(doorX + 1, y - 1, 14, 2, '#5a3420'),
        rect(doorX + 7, y, 2, 1, GOLD_COLOR),
        rect(doorX, y + 3, 16, 5, '#3a2214'),
        rect(doorX + 1, y + 4, 14, 3, '#4e2e1a'),
        rect(doorX + 7, y + 5, 2, 1, GOLD_COLOR),
      ],
    ),
    rect(x, y + 9, 2, 1, WOOD_DARK_COLOR),
    rect(right - 2, y + 9, 2, 1, WOOD_DARK_COLOR),
    // NOTE: the open drawer and the spoon.
    rect(x + 4, y - 1, 16, 1, '#140c08'),
    rect(x + 4, y, 16, 2, '#5a3420'),
    rect(x + 11, y + 1, 2, 1, GOLD_COLOR),
    rect(x + 8, y - 1, 4, 1, SILVER_LIGHT_COLOR),
    rect(x + 7, y - 1, 1, 1, SILVER_COLOR),
    // NOTE: the silver on top, kept clear of Uncle Chunk's portrait over its
    // middle: candlesticks at the ends, the tea service and plates to the
    // west, the cloche and a bowl of fruit gone bad to the east.
    rect(x + 3, y - 12, 1, 7, SILVER_COLOR),
    rect(x + 2, y - 6, 3, 1, SILVER_DARK_COLOR),
    rect(x + 3, y - 14, 1, 2, CANDLE_COLOR),
    rect(x + 3, y - 15, 1, 1, FLAME_COLOR),
    rect(right - 4, y - 12, 1, 7, SILVER_COLOR),
    rect(right - 5, y - 6, 3, 1, SILVER_DARK_COLOR),
    rect(right - 4, y - 14, 1, 2, CANDLE_COLOR),
    rect(right - 4, y - 15, 1, 1, FLAME_COLOR),
    rect(x + 9, y - 7, 16, 2, SILVER_DARK_COLOR),
    rect(x + 11, y - 11, 6, 4, SILVER_COLOR),
    rect(x + 12, y - 11, 3, 1, SILVER_LIGHT_COLOR),
    rect(x + 17, y - 10, 2, 1, SILVER_COLOR),
    rect(x + 19, y - 11, 1, 1, SILVER_COLOR),
    rect(x + 13, y - 12, 2, 1, SILVER_DARK_COLOR),
    rect(x + 20, y - 8, 3, 2, PLATE_COLOR),
    rect(x + 28, y - 9, 10, 4, PLATE_COLOR),
    ...Array.makeBy(3, index =>
      rect(x + 28, y - 8 + index, 10, 1, PLATE_SHADE_COLOR),
    ),
    rect(x + 28, y - 10, 10, 1, CHINA_BLUE_COLOR),
    rect(x + 44, y - 7, 2, 2, SILVER_COLOR),
    rect(x + 54, y - 7, 2, 2, SILVER_COLOR),
    rect(x + 62, y - 7, 14, 2, SILVER_DARK_COLOR),
    rect(x + 63, y - 13, 12, 6, SILVER_COLOR),
    rect(x + 65, y - 14, 8, 1, SILVER_COLOR),
    rect(x + 64, y - 12, 4, 1, SILVER_LIGHT_COLOR),
    rect(x + 68, y - 16, 2, 2, SILVER_DARK_COLOR),
    rect(x + 79, y - 7, 12, 2, SILVER_DARK_COLOR),
    rect(x + 80, y - 10, 10, 3, SILVER_COLOR),
    rect(x + 81, y - 12, 3, 3, '#6a4a7a'),
    rect(x + 84, y - 13, 3, 3, '#5a6a3a'),
    rect(x + 86, y - 11, 3, 2, '#7a5a2a'),
    rect(x + 83, y - 12, 1, 1, '#8a9a6a'),
  ]
}

// NOTE: a tall china cabinet: a crown, glass doors with plates standing on
// their shelves, and a drawer under them.
const cabinetShapes = ({
  x,
  y,
  width,
  height,
}: Box): ReadonlyArray<Canvas.Shape> => {
  const top = height > TILE_SIZE ? y - 14 : y - 6
  const bottom = y + height
  const lowerTop = bottom - 7
  const shelves = Math.max(1, Math.floor((lowerTop - top - 4) / 7))
  const plates = Math.max(1, Math.floor((width - 4) / 6))
  return [
    rect(x, top, width, bottom - top - 1, WOOD_COLOR),
    rect(x - 1, top - 2, width + 2, 3, WOOD_LIGHT_COLOR),
    rect(x - 1, top - 2, width + 2, 1, '#8a5a32'),
    rect(x + 2, top + 2, width - 4, lowerTop - top - 3, GLASS_COLOR),
    ...Array.flatMap(
      Array.makeBy(shelves, index => top + 8 + index * 7),
      shelfY => [
        ...Array.flatMap(
          Array.makeBy(plates, index => x + 3 + index * 6),
          plateX => [
            rect(plateX + 1, shelfY - 5, 3, 1, PLATE_COLOR),
            rect(plateX, shelfY - 4, 5, 3, PLATE_COLOR),
            rect(plateX + 1, shelfY - 1, 3, 1, PLATE_COLOR),
            rect(plateX + 1, shelfY - 4, 3, 3, CHINA_BLUE_COLOR),
            rect(plateX + 2, shelfY - 3, 1, 1, PLATE_COLOR),
          ],
        ),
        rect(x + 2, shelfY, width - 4, 1, WOOD_LIGHT_COLOR),
      ],
    ),
    rect(x + Math.floor(width / 2), top + 2, 1, lowerTop - top - 3, WOOD_COLOR),
    rect(x + 3, top + 3, 1, 4, GLASS_SHINE_COLOR),
    rect(x + 4, top + 3, 1, 2, GLASS_SHINE_COLOR),
    rect(x + 1, lowerTop, width - 2, 5, '#3a2214'),
    rect(x + 1, lowerTop, width - 2, 1, WOOD_LIGHT_COLOR),
    rect(x + Math.floor(width / 2) - 1, lowerTop + 2, 2, 1, GOLD_COLOR),
    rect(x, bottom - 1, 2, 1, WOOD_DARK_COLOR),
    rect(x + width - 2, bottom - 1, 2, 1, WOOD_DARK_COLOR),
  ]
}

// NOTE: tall wood against a wall: the long one under the north wall's
// paper is the sideboard, any shorter one a china cabinet.
export const hutchShapes = (box: Box): ReadonlyArray<Canvas.Shape> =>
  box.width >= TILE_SIZE * 5 ? sideboardShapes(box) : cabinetShapes(box)

// NOTE: a standing candelabra taller than a guest, its glow on the floor.
export const candelabraShapes = ({
  x,
  y,
}: Box): ReadonlyArray<Canvas.Shape> => {
  const centerX = x + 4
  return [
    rect(centerX - 8, y - 22, 17, 14, 'rgba(255, 200, 90, 0.07)'),
    rect(centerX - 5, y - 19, 11, 9, 'rgba(255, 200, 90, 0.07)'),
    rect(centerX - 3, y + 7, 7, 2, GOLD_DARK_COLOR),
    rect(centerX - 2, y + 6, 5, 1, GOLD_COLOR),
    rect(centerX, y - 8, 1, 14, GOLD_COLOR),
    rect(centerX - 1, y - 2, 3, 2, GOLD_COLOR),
    rect(centerX - 1, y + 3, 3, 1, GOLD_DARK_COLOR),
    rect(centerX - 4, y - 9, 9, 1, GOLD_COLOR),
    rect(centerX - 4, y - 11, 1, 2, GOLD_COLOR),
    rect(centerX + 4, y - 11, 1, 2, GOLD_COLOR),
    rect(centerX - 5, y - 12, 3, 1, GOLD_DARK_COLOR),
    rect(centerX + 3, y - 12, 3, 1, GOLD_DARK_COLOR),
    rect(centerX - 1, y - 10, 3, 1, GOLD_DARK_COLOR),
    rect(centerX - 4, y - 15, 1, 3, CANDLE_COLOR),
    rect(centerX, y - 14, 1, 4, CANDLE_COLOR),
    rect(centerX + 4, y - 15, 1, 3, CANDLE_COLOR),
    rect(centerX - 3, y - 13, 1, 1, CANDLE_COLOR),
    rect(centerX - 4, y - 16, 1, 1, FLAME_COLOR),
    rect(centerX, y - 15, 1, 1, FLAME_COLOR),
    rect(centerX + 4, y - 16, 1, 1, FLAME_COLOR),
    rect(centerX - 4, y - 17, 1, 1, FLAME_TIP_COLOR),
    rect(centerX, y - 16, 1, 1, FLAME_TIP_COLOR),
    rect(centerX + 4, y - 17, 1, 1, FLAME_TIP_COLOR),
  ]
}

// THE FRONT DOOR

const transomLight = (door: Box): ReadonlyArray<Canvas.Shape> => {
  const centerX = door.x + Math.floor(door.width / 2)
  return Array.flatMap(
    Array.makeBy(26, row => row),
    row => {
      const fade = 1 - row / 26
      const half = Math.round(door.width / 2 + 2 + row * 0.9)
      const lightY = door.y - 1 - row
      return [
        rect(
          centerX - half,
          lightY,
          half * 2,
          1,
          `rgba(255, 210, 130, ${(0.09 * fade).toFixed(3)})`,
        ),
        // NOTE: the shadows of the fanlight's spokes, fanning out.
        ...Array.map([-2, -1, 0, 1, 2], spoke =>
          rect(
            centerX + Math.round(spoke * (4 + row * 0.55)),
            lightY,
            1,
            1,
            `rgba(0, 0, 0, ${(0.08 * fade).toFixed(3)})`,
          ),
        ),
      ]
    },
  )
}

// NOTE: the front door: a big oak double door in the south wall, banded in
// iron, chained shut with a padlock the size of a fist. The fanlight over it
// is lit from outside, so light fans across the front hall's floor and
// leaks through the crack between the leaves. It opens only for the finale.
export const frontDoorShapes = (door: Box): ReadonlyArray<Canvas.Shape> => {
  const { x, y, width, height } = door
  const right = x + width
  const middle = x + Math.floor(width / 2)
  return [
    ...transomLight(door),
    rect(x - 3, y - 4, width + 6, 4, STONE_COLOR),
    rect(x - 3, y - 4, width + 6, 1, STONE_LIGHT_COLOR),
    rect(x - 3, y - 1, width + 6, 1, '#4e4552'),
    rect(x - 6, y - 2, 6, height + 2, CASING_COLOR),
    rect(x - 6, y - 2, 6, 1, CASING_LIGHT_COLOR),
    rect(x - 1, y - 1, 1, height + 1, CASING_DARK_COLOR),
    rect(right, y - 2, 6, height + 2, CASING_COLOR),
    rect(right, y - 2, 6, 1, CASING_LIGHT_COLOR),
    rect(right, y - 1, 1, height + 1, CASING_DARK_COLOR),
    rect(x, y, width, height, DOOR_OAK_COLOR),
    ...Array.makeBy(Math.floor(width / 4), index =>
      rect(x + 2 + index * 4, y, 1, height, DOOR_OAK_LIGHT_COLOR),
    ),
    rect(x, y + 2, width, 1, IRON_COLOR),
    rect(x, y + 7, width, 1, IRON_COLOR),
    ...Array.makeBy(Math.floor(width / 6), index =>
      rect(x + 3 + index * 6, y + 2, 1, 1, IRON_LIGHT_COLOR),
    ),
    rect(middle - 1, y, 2, height, '#1a0e08'),
    rect(middle, y, 1, height, TRANSOM_LIGHT_COLOR),
    // NOTE: the chain across both leaves, and the padlock.
    ...Array.makeBy(Math.floor((width + 4) / 3), index =>
      rect(
        x - 2 + index * 3,
        y + 4 + (index % 2),
        2,
        1,
        index % 2 === 0 ? IRON_LIGHT_COLOR : '#8a8a96',
      ),
    ),
    rect(middle - 3, y + 3, 7, 6, GOLD_DARK_COLOR),
    rect(middle - 2, y + 3, 5, 5, GOLD_COLOR),
    rect(middle - 2, y + 1, 1, 2, '#8a8a96'),
    rect(middle + 2, y + 1, 1, 2, '#8a8a96'),
    rect(middle - 1, y, 3, 1, '#8a8a96'),
    rect(middle, y + 5, 1, 2, INK_COLOR),
    rect(middle - 2, y + 3, 1, 1, GOLD_LIGHT_COLOR),
    // NOTE: the knockers.
    rect(x + 5, y + 4, 3, 3, GOLD_COLOR),
    rect(x + 6, y + 5, 1, 1, DOOR_OAK_COLOR),
    rect(right - 8, y + 4, 3, 3, GOLD_COLOR),
    rect(right - 7, y + 5, 1, 1, DOOR_OAK_COLOR),
  ]
}

// THE CHANDELIER

export type ChandelierState = 'Hung' | 'Fallen'

const CHAIN_COLOR = '#8a8a96'
const CHAIN_DARK_COLOR = '#4a4a56'
const CRYSTAL_COLOR = '#bfe3f0'
const CRYSTAL_LIGHT_COLOR = '#f2fbff'
const STREAMER_COLOR = '#c86a8a'
const RING_HALF_WIDTH = 12
const RING_HALF_HEIGHT = 3
// NOTE: how far over the floor the hung chandelier's hub is drawn, so it
// reads as hanging overhead with its shadow on the floor under it.
const HUNG_RISE = 12

type Point = Readonly<{ x: number; y: number }>

const ringPoints = (
  halfWidth: number,
  halfHeight: number,
  count: number,
): ReadonlyArray<Point> =>
  Array.makeBy(count, index => {
    const angle = (index / count) * Math.PI * 2
    return {
      x: Math.round(Math.cos(angle) * halfWidth),
      y: Math.round(Math.sin(angle) * halfHeight),
    }
  })

// NOTE: an oval of rim pixels, its back half darker than its front.
const ringShapes = (
  centerX: number,
  centerY: number,
  halfWidth: number,
  halfHeight: number,
): ReadonlyArray<Canvas.Shape> =>
  Array.map(ringPoints(halfWidth, halfHeight, 48), ({ x, y }) =>
    rect(centerX + x, centerY + y, 2, 1, y < 0 ? GOLD_DARK_COLOR : GOLD_COLOR),
  )

const standingCandle = ({ x, y }: Point): ReadonlyArray<Canvas.Shape> => [
  rect(x - 1, y, 3, 1, GOLD_COLOR),
  rect(x, y - 4, 1, 4, CANDLE_COLOR),
  rect(x, y - 5, 1, 1, FLAME_COLOR),
  rect(x, y - 6, 1, 1, FLAME_TIP_COLOR),
]

// NOTE: hung, seen from below and in front: the chain up out of sight, the
// hub, a ring of eight candles with crystals dripping off its front, a party
// streamer still caught on it, and its glow. Drawn about the hub; the sprite
// lifts it over the middle of the table's gap.
const hungShapes = (): ReadonlyArray<Canvas.Shape> => {
  const candles = ringPoints(RING_HALF_WIDTH, RING_HALF_HEIGHT, 8)
  const back = Array.filter(candles, ({ y }) => y < 0)
  const front = Array.filter(candles, ({ y }) => y >= 0)
  return [
    rect(-16, -14, 33, 22, 'rgba(255, 210, 120, 0.06)'),
    rect(-11, -10, 23, 14, 'rgba(255, 210, 120, 0.07)'),
    ...Array.flatMap(
      Array.makeBy(8, index => index),
      index => [
        rect(0, -42 + index * 4, 1, 2, CHAIN_COLOR),
        rect(-1, -40 + index * 4, 3, 1, CHAIN_DARK_COLOR),
      ],
    ),
    rect(-2, -10, 5, 2, GOLD_COLOR),
    rect(-1, -8, 3, 5, GOLD_COLOR),
    rect(-1, -8, 1, 5, GOLD_LIGHT_COLOR),
    rect(0, -3, 1, 5, GOLD_DARK_COLOR),
    ...Array.flatMap(back, standingCandle),
    ...ringShapes(0, 1, RING_HALF_WIDTH, RING_HALF_HEIGHT),
    rect(-8, 0, 7, 1, GOLD_DARK_COLOR),
    rect(2, 0, 7, 1, GOLD_DARK_COLOR),
    rect(-2, 1, 5, 3, GOLD_COLOR),
    rect(-1, 1, 1, 1, GOLD_LIGHT_COLOR),
    ...Array.flatMap(front, standingCandle),
    ...Array.flatMap(
      Array.makeBy(8, index => -10 + index * 3),
      crystalX => [
        rect(crystalX, 4 + (crystalX % 2 === 0 ? 0 : 1), 1, 2, CRYSTAL_COLOR),
        rect(
          crystalX,
          6 + (crystalX % 2 === 0 ? 0 : 1),
          1,
          1,
          CRYSTAL_LIGHT_COLOR,
        ),
      ],
    ),
    rect(0, 4, 1, 4, CRYSTAL_COLOR),
    rect(0, 8, 1, 1, CRYSTAL_LIGHT_COLOR),
    rect(9, 4, 1, 3, STREAMER_COLOR),
    rect(10, 7, 1, 3, STREAMER_COLOR),
    rect(9, 10, 1, 2, STREAMER_COLOR),
  ]
}

const CRYSTAL_SPRAY: ReadonlyArray<Point> = [
  { x: -15, y: 5 },
  { x: -12, y: -6 },
  { x: -8, y: 10 },
  { x: -3, y: -8 },
  { x: 4, y: 11 },
  { x: 9, y: -7 },
  { x: 13, y: 8 },
  { x: 16, y: -1 },
  { x: -17, y: -2 },
  { x: 1, y: 13 },
]

// NOTE: fallen, in the table's gap: cracked floor, the ring bent flat and
// broken, candles snapped and rolled, one still burning, crystals sprayed
// everywhere, the chain heaped on top, and a green hand under it all.
type Strip = readonly [number, number, number, number]

const FLOOR_CRACKS: ReadonlyArray<Strip> = [
  [-14, 4, 6, 1],
  [-9, 5, 1, 4],
  [8, 6, 7, 1],
  [12, 7, 1, 4],
  [-3, 9, 1, 4],
  [3, -6, 1, 3],
]

const SNAPPED_CANDLES: ReadonlyArray<Strip> = [
  [-11, 4, 4, 1],
  [-7, -2, 3, 1],
  [5, 6, 4, 1],
  [10, 1, 1, 3],
  [-14, 1, 1, 3],
]

const fallenShapes = (): ReadonlyArray<Canvas.Shape> => [
  ...Array.map(FLOOR_CRACKS, ([x, y, width, height]) =>
    rect(x, y, width, height, 'rgba(0, 0, 0, 0.45)'),
  ),
  rect(-13, -1, 27, 9, 'rgba(0, 0, 0, 0.3)'),
  ...Array.filter(
    [
      ...ringShapes(0, 2, 13, 5),
      ...ringShapes(0, 3, 12, 4),
      ...ringShapes(0, 3, 11, 4),
    ],
    shape => shape._tag !== 'Rect' || shape.x < 6 || shape.y > 4,
  ),
  rect(-12, 3, 4, 2, GOLD_COLOR),
  rect(-4, 6, 8, 2, GOLD_COLOR),
  rect(-3, 6, 3, 1, GOLD_LIGHT_COLOR),
  rect(6, -3, 3, 1, GOLD_COLOR),
  rect(9, -2, 2, 1, GOLD_DARK_COLOR),
  rect(-3, 0, 6, 4, GOLD_COLOR),
  rect(-2, 0, 2, 1, GOLD_LIGHT_COLOR),
  rect(-6, 1, 4, 1, GOLD_DARK_COLOR),
  rect(3, 3, 5, 1, GOLD_DARK_COLOR),
  ...Array.map(SNAPPED_CANDLES, ([x, y, width, height]) =>
    rect(x, y, width, height, CANDLE_COLOR),
  ),
  rect(-8, 6, 1, 3, CANDLE_COLOR),
  rect(-8, 5, 1, 1, FLAME_COLOR),
  rect(-8, 4, 1, 1, FLAME_TIP_COLOR),
  rect(-9, 1, 3, 2, 'rgba(160, 160, 170, 0.35)'),
  rect(-8, -1, 2, 2, 'rgba(160, 160, 170, 0.25)'),
  ...Array.flatMap(CRYSTAL_SPRAY, ({ x, y }) => [
    rect(x, y, 1, 1, CRYSTAL_COLOR),
    rect(x + 1, y, 1, 1, CRYSTAL_LIGHT_COLOR),
  ]),
  ...Array.flatMap(
    Array.makeBy(9, index => index),
    index => [
      rect(
        -6 + index * 2,
        -4 + Math.round(Math.sin(index) * 2),
        2,
        1,
        index % 2 === 0 ? CHAIN_COLOR : CHAIN_DARK_COLOR,
      ),
    ],
  ),
  rect(-2, -6, 4, 2, CHAIN_DARK_COLOR),
  rect(-1, -7, 3, 1, CHAIN_COLOR),
  // NOTE: whoever stood under it.
  rect(13, 3, 3, 2, ZOMBIE_SKIN_COLOR),
  rect(16, 2, 1, 2, ZOMBIE_SKIN_COLOR),
  rect(16, 5, 2, 1, ZOMBIE_SKIN_COLOR),
  rect(13, 3, 1, 1, '#5a8a3a'),
  rect(9, 9, 6, 1, STREAMER_COLOR),
  rect(14, 10, 3, 1, STREAMER_COLOR),
]

// NOTE: the hung chandelier's shadow on the floor under it, wide and soft.
const shadowShapes = (): ReadonlyArray<Canvas.Shape> => [
  rect(-11, HUNG_RISE + 7, 23, 5, 'rgba(0, 0, 0, 0.14)'),
  rect(-8, HUNG_RISE + 6, 17, 7, 'rgba(0, 0, 0, 0.1)'),
]

// NOTE: each state's pixels as rectangles about the middle of the table's
// gap, for a room image that bakes the chandelier in with everything else
// (the studio's preview).
export const CHANDELIER_SHAPES: Readonly<
  Record<ChandelierState, ReadonlyArray<Canvas.Shape>>
> = {
  Hung: [
    ...shadowShapes(),
    ...Array.map(hungShapes(), shape =>
      shape._tag === 'Rect' ? { ...shape, y: shape.y - HUNG_RISE } : shape,
    ),
  ],
  Fallen: fallenShapes(),
}

// NOTE: each state's sprite, built once, drawn about the middle of the
// table's gap: hung from the ceiling over it, or lying in it.
export const CHANDELIER_SPRITES: Readonly<
  Record<ChandelierState, ReadonlyArray<Canvas.Shape>>
> = {
  Hung: bakeShapes(CHANDELIER_SHAPES.Hung),
  Fallen: bakeShapes(CHANDELIER_SHAPES.Fallen),
}
