import { Array, Function, Result } from 'effect'
import type { Canvas } from 'foldkit'

import { type Palette, bakeShapes } from '../../art/sprite'
import { TILE_SIZE } from '../../shared/constants'
import type { Level } from '../../world/level/arena'
import { pixelArt, rect } from '../drawing'
import {
  BOOK_COLORS,
  SHELF_BACK_COLOR,
  SHELF_EDGE_COLOR,
  SHELF_WOOD_COLOR,
} from './roomCover'
import {
  BONE_COLOR,
  type Box,
  CANDLE_COLOR,
  CHAIR_RAIL_Y,
  EXIT_GAP_COLOR,
  FACE_TOP,
  FLAME_COLOR,
  GOLD_COLOR,
  GOLD_DARK_COLOR,
  GOLD_LIGHT_COLOR,
  INK_COLOR,
  PLANK_SHADES,
  pick,
  roll,
} from './roomPalette'
import { type Span, spansWithin } from './roomWalls'

// NOTE: the library: a dark plank floor, green paper, stacks of shelves in
// aisles, a reading desk with its lamps and chairs, a globe, a rolling
// ladder, and the shelf in the side wall that swings open when its one
// odd book is pulled. Everything but the swinging shelf is drawn once into
// the room's image; the shelf is its own sprite, shut or open.

// PALETTE

const FLOOR_SHADE_COLOR = 'rgba(14, 8, 20, 0.38)'
const PAPER_COLOR = '#1f3328'
const PAPER_STRIPE_COLOR = '#243b2e'
const PAPER_MOTIF_COLOR = '#2f4a39'
const RUG_EDGE_COLOR = '#1a2e24'
const RUG_FIELD_COLOR = '#2a4a38'
const RUG_MOTIF_COLOR = '#3a5e48'
const LEATHER_COLOR = '#2f5d50'
const LEATHER_LIGHT_COLOR = '#4a8a72'
const LEATHER_DARK_COLOR = '#22463c'
const DESK_COLOR = '#5a3a22'
const DESK_LIGHT_COLOR = '#7a5232'
const DESK_DARK_COLOR = '#3a2414'
const DESK_TOP_COLOR = '#2c4a3a'
const PAGE_COLOR = '#efe6d2'
const PAGE_SHADE_COLOR = '#c9bfa8'
const LAMP_SHADE_COLOR = '#2f7a4a'
const LAMP_LIGHT_COLOR = '#5aaa6a'
const OCEAN_COLOR = '#3d6a9a'
const OCEAN_DARK_COLOR = '#2d4f78'
const LAND_COLOR = '#7a9a4a'
const STACK_END_COLOR = '#33200f'
const NIGHT_COLOR = '#1c2a44'
const MOON_COLOR = '#e8e0b0'
const BOOK_GLINT_COLOR = '#ffe9a0'
const ODD_BOOK_COLOR = '#c8343c'
const ODD_BOOK_LIGHT_COLOR = '#e05a5a'
const DUST_COLOR = 'rgba(200, 190, 170, 0.22)'

// FLOOR

// NOTE: the parlour's planks under a dusk of shade, so the wood reads dark.
export const libraryFloorShadeShapes = (
  room: Box,
): ReadonlyArray<Canvas.Shape> => [
  rect(room.x, room.y, room.width, room.height, FLOOR_SHADE_COLOR),
]

// NOTE: the long green rug under the reading desk in the nook, placed by
// hand on the map.
export const libraryRugShapes = (room: Box): ReadonlyArray<Canvas.Shape> => {
  const x = room.x + 176
  const y = room.y + 102
  const width = 108
  const height = 36
  return [
    rect(x, y, width, height, RUG_EDGE_COLOR),
    rect(x + 2, y + 2, width - 4, height - 4, GOLD_DARK_COLOR),
    rect(x + 3, y + 3, width - 6, height - 6, RUG_FIELD_COLOR),
    ...Array.flatMap(
      Array.makeBy(Math.floor((width - 10) / 8), index => x + 6 + index * 8),
      motifX => [
        rect(motifX, y + 5, 3, 1, RUG_MOTIF_COLOR),
        rect(motifX + 1, y + 4, 1, 3, RUG_MOTIF_COLOR),
        rect(motifX, y + height - 6, 3, 1, RUG_MOTIF_COLOR),
        rect(motifX + 1, y + height - 7, 1, 3, RUG_MOTIF_COLOR),
      ],
    ),
    ...Array.makeBy(Math.floor((height - 2) / 2), index =>
      rect(x - 2, y + 1 + index * 2, 2, 1, '#7a6a4c'),
    ),
    ...Array.makeBy(Math.floor((height - 2) / 2), index =>
      rect(x + width, y + 1 + index * 2, 2, 1, '#7a6a4c'),
    ),
  ]
}

// WALLS

const paperShapes = ({ x, y, width }: Span): ReadonlyArray<Canvas.Shape> => {
  const top = y - TILE_SIZE * 2 + FACE_TOP + 2
  const railY = y - TILE_SIZE * 2 + CHAIR_RAIL_Y
  const columns = Array.makeBy(width, index => x + index)
  return [
    rect(x, top, width, railY - top, PAPER_COLOR),
    ...Array.filterMap(columns, column =>
      column % 5 === 0
        ? Result.succeed(rect(column, top, 1, railY - top, PAPER_STRIPE_COLOR))
        : Result.failVoid,
    ),
    ...Array.filterMap(columns, column =>
      column % 10 === 7
        ? Result.succeed(rect(column - 1, top + 3, 3, 3, PAPER_MOTIF_COLOR))
        : Result.failVoid,
    ),
  ]
}

// NOTE: green paper with a fine stripe over the parlour's wainscot, on the
// north wall faces in the library's own block.
export const libraryWallShapes: {
  (room: Box): (level: Level) => ReadonlyArray<Canvas.Shape>
  (level: Level, room: Box): ReadonlyArray<Canvas.Shape>
} = Function.dual(2, (level: Level, room: Box): ReadonlyArray<Canvas.Shape> =>
  Array.flatMap(spansWithin(level, room), paperShapes),
)

const CLOCK_PIXELS: ReadonlyArray<string> = [
  '..WWWW..',
  '.WccccW.',
  'WcckcccW',
  'WcckcccW',
  'WcckkkcW',
  'WccccccW',
  '.WccccW.',
  '..WWWW..',
  '...WW...',
  '...bW...',
  '...WW...',
  '..WWWW..',
]

const CLOCK_PALETTE: Palette = {
  W: '#5a3a22',
  c: '#e8dcc0',
  k: INK_COLOR,
  b: GOLD_COLOR,
}

const MAP_PIXELS: ReadonlyArray<string> = [
  'FFFFFFFFFFFFFF',
  'FppppppppppppF',
  'FppLLppppxpppF',
  'FpLLLLpppppppF',
  'FppLLppppLLLpF',
  'FpppppppLLLLpF',
  'FppkkkpppLLppF',
  'FppppkpppppppF',
  'FFFFFFFFFFFFFF',
]

const MAP_PALETTE: Palette = {
  F: GOLD_DARK_COLOR,
  p: '#c9b88a',
  L: '#8a7a4a',
  x: '#c8343c',
  k: '#6a4a2a',
}

const READER_PIXELS: ReadonlyArray<string> = [
  'FFFFFFFFFFFF',
  'Ff..hhhh..fF',
  'Ff.hSSSSh.fF',
  'Ff.hgSSgh.fF',
  'Ff..SSSS..fF',
  'Ff..bbbb..fF',
  'Ff.ddPPdd.fF',
  'Ff.ddPPdd.fF',
  'FFFFFFFFFFFF',
]

const READER_PALETTE: Palette = {
  F: GOLD_COLOR,
  f: GOLD_DARK_COLOR,
  '.': '#20302a',
  h: '#e8e2cc',
  S: '#a8c890',
  g: '#c9c3b0',
  b: '#7a2338',
  d: '#2a2a3a',
  P: PAGE_COLOR,
}

// NOTE: a tall arched window with the moon in it, between two stretches of
// paper; a clock stopped at the party's hour; a map with a red X; and a
// Munch who never looked up from her book.
export const libraryWallDecorShapes = (
  room: Box,
): ReadonlyArray<Canvas.Shape> => {
  const windowX = room.x + 44
  const windowY = room.y + 4
  return [
    rect(windowX - 1, windowY, 14, 16, '#3a2616'),
    rect(windowX + 1, windowY + 2, 10, 13, NIGHT_COLOR),
    rect(windowX + 2, windowY + 1, 8, 1, NIGHT_COLOR),
    rect(windowX + 7, windowY + 3, 3, 3, MOON_COLOR),
    rect(windowX + 6, windowY + 4, 1, 1, MOON_COLOR),
    rect(windowX + 6, windowY + 2, 1, 13, '#3a2616'),
    rect(windowX + 1, windowY + 8, 10, 1, '#3a2616'),
    rect(windowX - 2, windowY + 15, 16, 2, '#5a3a22'),
    rect(windowX + 2, windowY + 10, 2, 2, 'rgba(200, 220, 255, 0.25)'),
    ...pixelArt(room.x + 96, room.y + 6, READER_PIXELS, READER_PALETTE),
    ...pixelArt(room.x + 214, room.y + 4, CLOCK_PIXELS, CLOCK_PALETTE),
    ...pixelArt(room.x + 252, room.y + 7, MAP_PIXELS, MAP_PALETTE),
  ]
}

// STACKS

// NOTE: a freestanding stack of shelves, open on top so the books' tops
// show in two rows either side of its spine, with its end panel to the
// room and a brass label. Some carry a candle, a skull, or a pile of books
// left lying on top.
export const stackShapes = ({
  x,
  y,
  width,
  height,
}: Box): ReadonlyArray<Canvas.Shape> => {
  const top = y - 6
  const faceTop = y + height - 9
  const bottom = y + height
  const middle = x + Math.floor(width / 2)
  const rows = Math.floor((faceTop - top - 3) / 2)
  const halves: ReadonlyArray<readonly [number, number]> = [
    [x + 2, middle - 1],
    [middle + 1, x + width - 2],
  ]
  const seed = x * 7 + y
  const extra = roll(seed, 800)
  return [
    rect(x, top, width, faceTop - top, SHELF_EDGE_COLOR),
    rect(x + 1, top + 1, width - 2, faceTop - top - 1, SHELF_BACK_COLOR),
    ...Array.flatMap(halves, ([left, right], half) =>
      Array.filterMap(
        Array.makeBy(rows, row => row),
        row =>
          roll(seed + half, row + 810) < 0.12
            ? Result.failVoid
            : Result.succeed(
                rect(
                  left + Math.floor(roll(seed + half, row + 820) * 2),
                  top + 2 + row * 2,
                  right - left - 1,
                  1 + (roll(seed + half, row + 830) < 0.3 ? 1 : 0),
                  pick(BOOK_COLORS, roll(seed + half, row + 840)),
                ),
              ),
      ),
    ),
    ...Array.makeBy(Math.floor((faceTop - top) / 9), index =>
      rect(x + 1, top + 8 + index * 9, width - 2, 1, SHELF_WOOD_COLOR),
    ),
    rect(middle - 1, top + 1, 2, faceTop - top - 1, SHELF_WOOD_COLOR),
    rect(x, top, width, 1, '#7a5232'),
    rect(x, faceTop, width, bottom - faceTop - 1, STACK_END_COLOR),
    rect(x + 2, faceTop + 2, width - 4, bottom - faceTop - 6, SHELF_WOOD_COLOR),
    rect(x, faceTop, width, 1, SHELF_EDGE_COLOR),
    rect(middle - 3, faceTop + 3, 6, 3, GOLD_COLOR),
    rect(middle - 2, faceTop + 4, 4, 1, INK_COLOR),
    rect(x, bottom - 2, width, 1, '#1a110a'),
    ...(extra < 0.25
      ? [
          rect(x + 3, top - 3, 2, 4, CANDLE_COLOR),
          rect(x + 3, top - 5, 2, 2, FLAME_COLOR),
          rect(x + 1, top - 7, 6, 6, 'rgba(255, 210, 63, 0.1)'),
        ]
      : extra < 0.45
        ? [
            rect(middle + 2, top - 2, 5, 4, BONE_COLOR),
            rect(middle + 3, top - 1, 1, 1, INK_COLOR),
            rect(middle + 5, top - 1, 1, 1, INK_COLOR),
          ]
        : extra < 0.7
          ? [
              rect(x + 3, top + 3, 7, 2, '#7a2338'),
              rect(x + 4, top + 1, 6, 2, '#3d4f7a'),
              rect(x + 3, top, 7, 1, '#b8813f'),
            ]
          : []),
  ]
}

// NOTE: the rolling ladder, hooked on a stack's end and standing in the
// aisle beside it (the stack nearest the nook), placed by hand on the map.
export const ladderShapes = (room: Box): ReadonlyArray<Canvas.Shape> => {
  const x = room.x + 173
  const top = room.y + 46
  const bottom = room.y + 87
  const rungs = Math.floor((bottom - top - 2) / 4)
  return [
    rect(x + 1, bottom, 9, 1, 'rgba(0, 0, 0, 0.35)'),
    rect(x, top, 1, bottom - top, '#8a6440'),
    rect(x + 8, top, 1, bottom - top, '#8a6440'),
    rect(x + 1, top, 1, bottom - top, '#5a3a22'),
    rect(x + 9, top, 1, bottom - top, '#5a3a22'),
    ...Array.makeBy(rungs, index =>
      rect(x + 1, top + 3 + index * 4, 8, 1, '#a8865a'),
    ),
    rect(x - 1, top - 2, 3, 2, GOLD_DARK_COLOR),
    rect(x + 8, top - 2, 3, 2, GOLD_DARK_COLOR),
    rect(x - 1, bottom - 1, 3, 2, '#2a2a30'),
    rect(x + 8, bottom - 1, 3, 2, '#2a2a30'),
  ]
}

// THE DESK

const readingChair = (
  centerX: number,
  y: number,
): ReadonlyArray<Canvas.Shape> => [
  rect(centerX - 6, y - 10, 13, 11, LEATHER_DARK_COLOR),
  rect(centerX - 5, y - 11, 11, 3, LEATHER_COLOR),
  rect(centerX - 5, y - 11, 11, 1, LEATHER_LIGHT_COLOR),
  rect(centerX - 7, y - 8, 2, 8, LEATHER_COLOR),
  rect(centerX + 6, y - 8, 2, 8, LEATHER_COLOR),
  rect(centerX - 3, y - 7, 1, 1, LEATHER_DARK_COLOR),
  rect(centerX + 1, y - 7, 1, 1, LEATHER_DARK_COLOR),
  rect(centerX - 1, y - 5, 1, 1, LEATHER_DARK_COLOR),
  rect(centerX - 4, y - 8, 9, 6, LEATHER_COLOR),
  rect(centerX - 3, y - 8, 1, 1, '#1a3229'),
  rect(centerX + 2, y - 8, 1, 1, '#1a3229'),
  rect(centerX, y - 6, 1, 1, '#1a3229'),
]

const bankerLamp = (x: number, y: number): ReadonlyArray<Canvas.Shape> => [
  rect(x - 6, y - 4, 16, 12, 'rgba(255, 230, 150, 0.08)'),
  rect(x, y + 5, 4, 2, GOLD_DARK_COLOR),
  rect(x + 1, y, 1, 5, GOLD_COLOR),
  rect(x - 2, y - 2, 8, 3, LAMP_SHADE_COLOR),
  rect(x - 2, y - 2, 8, 1, LAMP_LIGHT_COLOR),
  rect(x - 1, y + 1, 6, 1, '#fff2b0'),
]

// NOTE: the reading desk: green leather on its top, two banker's lamps, an
// open book, papers, an inkwell and quill, a pile of books, drawers to the
// front, and two wingback chairs pulled up behind it. Its west drawer is
// open a crack.
export const deskShapes = ({
  x,
  y,
  width,
}: Box): ReadonlyArray<Canvas.Shape> => {
  const right = x + width
  const middle = x + Math.floor(width / 2)
  return [
    ...readingChair(x + 18, y + 1),
    ...readingChair(right - 18, y + 1),
    rect(x, y - 1, width, 14, DESK_COLOR),
    rect(x, y - 1, width, 1, DESK_LIGHT_COLOR),
    rect(x + 3, y + 1, width - 6, 9, DESK_TOP_COLOR),
    rect(x + 4, y + 2, width - 8, 1, GOLD_DARK_COLOR),
    rect(x + 4, y + 8, width - 8, 1, GOLD_DARK_COLOR),
    rect(x, y + 12, width, 7, '#4a2e17'),
    rect(x, y + 12, width, 1, DESK_DARK_COLOR),
    rect(x + 3, y + 14, 22, 4, DESK_COLOR),
    rect(right - 25, y + 14, 22, 4, DESK_COLOR),
    rect(x + 13, y + 15, 2, 1, GOLD_COLOR),
    rect(right - 15, y + 15, 2, 1, GOLD_COLOR),
    rect(middle - 10, y + 13, 20, 6, '#1a110a'),
    rect(x + 3, y + 13, 22, 1, '#140c08'),
    rect(x, y + 19, 3, 1, DESK_DARK_COLOR),
    rect(right - 3, y + 19, 3, 1, DESK_DARK_COLOR),
    ...bankerLamp(x + 8, y + 2),
    ...bankerLamp(right - 12, y + 2),
    rect(middle - 7, y + 3, 14, 6, PAGE_COLOR),
    rect(middle, y + 3, 1, 6, PAGE_SHADE_COLOR),
    ...Array.flatMap(
      Array.makeBy(3, index => y + 4 + index * 2),
      lineY => [
        rect(middle - 6, lineY, 5, 1, PAGE_SHADE_COLOR),
        rect(middle + 2, lineY, 5, 1, PAGE_SHADE_COLOR),
      ],
    ),
    rect(middle - 7, y + 9, 14, 1, '#7a2338'),
    rect(x + 20, y + 4, 6, 4, PAGE_COLOR),
    rect(x + 22, y + 5, 5, 4, '#e2d8c0'),
    rect(right - 26, y + 3, 3, 3, INK_COLOR),
    rect(right - 25, y + 2, 1, 1, '#3d4f7a'),
    rect(right - 24, y - 2, 1, 5, '#f4f1de'),
    rect(right - 23, y - 3, 1, 2, '#f4f1de'),
    rect(right - 20, y + 2, 8, 2, '#3d4f7a'),
    rect(right - 21, y + 4, 9, 2, '#8a4a2a'),
    rect(right - 20, y + 6, 8, 2, '#4a6a3a'),
  ]
}

// NOTE: a globe on a tripod, oceans and two continents, its brass
// meridian, taller than the desk.
export const globeShapes = ({ x, y }: Box): ReadonlyArray<Canvas.Shape> => {
  const centerX = x + 5
  const centerY = y - 3
  const radius = 4
  return [
    rect(x + 1, y + 7, 1, 3, DESK_DARK_COLOR),
    rect(x + 8, y + 7, 1, 3, DESK_DARK_COLOR),
    rect(x + 4, y + 7, 2, 3, DESK_COLOR),
    rect(x + 1, y + 6, 8, 1, DESK_COLOR),
    rect(centerX, y + 2, 1, 4, GOLD_DARK_COLOR),
    ...Array.makeBy(radius * 2 + 1, index => {
      const dy = index - radius
      const half = Math.round(Math.sqrt(radius * radius - dy * dy + 1))
      return rect(
        centerX - half,
        centerY + dy,
        half * 2 + 1,
        1,
        dy > 1 ? OCEAN_DARK_COLOR : OCEAN_COLOR,
      )
    }),
    rect(centerX - 3, centerY - 2, 3, 2, LAND_COLOR),
    rect(centerX - 2, centerY, 2, 2, LAND_COLOR),
    rect(centerX + 1, centerY + 1, 3, 2, LAND_COLOR),
    rect(centerX + 2, centerY - 3, 1, 1, LAND_COLOR),
    rect(centerX - 2, centerY - 3, 1, 1, '#a8d0f0'),
    rect(centerX - 6, centerY - 1, 1, 5, GOLD_COLOR),
    rect(centerX - 5, centerY - 4, 1, 3, GOLD_COLOR),
    rect(centerX - 4, centerY - 6, 3, 1, GOLD_COLOR),
    rect(centerX - 1, centerY - 6, 1, 1, GOLD_LIGHT_COLOR),
    rect(centerX - 5, centerY + 4, 2, 1, GOLD_COLOR),
  ]
}

// THE SECRET SHELF

export type ShelfState = 'Shut' | 'Open'

// NOTE: which side wall the shelf stands in: the west wall faces the room
// to its east.
export type ShelfWall = 'West' | 'East'

const SHELF_LENGTH = TILE_SIZE * 2

// NOTE: the shelf is drawn as if in the west wall, with x counting into the
// room from the wall tile's left edge; the east wall's is the same flipped.
const flipped = (
  shapes: ReadonlyArray<Canvas.Shape>,
  wall: ShelfWall,
): ReadonlyArray<Canvas.Shape> =>
  wall === 'West'
    ? shapes
    : Array.map(shapes, shape =>
        shape._tag === 'Rect'
          ? { ...shape, x: TILE_SIZE - shape.x - shape.width }
          : shape,
      )

const bookTops = (seed: number): ReadonlyArray<Canvas.Shape> =>
  Array.filterMap(
    Array.makeBy(SHELF_LENGTH - 2, row => row),
    row =>
      row === 9 || roll(seed, row + 850) < 0.15
        ? Result.failVoid
        : Result.succeed(
            rect(
              2 + Math.floor(roll(seed, row + 860) * 2),
              1 + row,
              6,
              1,
              pick(BOOK_COLORS, roll(seed, row + 870)),
            ),
          ),
  )

// NOTE: shut, the shelf is built into the wall: its books' tops show from
// above, and one red book sticks out into the room, glinting.
const shutShapes = (): ReadonlyArray<Canvas.Shape> => [
  rect(0, -1, TILE_SIZE, SHELF_LENGTH + 2, SHELF_WOOD_COLOR),
  rect(1, 0, TILE_SIZE - 2, SHELF_LENGTH, SHELF_BACK_COLOR),
  ...bookTops(3),
  rect(1, 9, TILE_SIZE - 2, 1, SHELF_EDGE_COLOR),
  rect(TILE_SIZE - 1, -1, 1, SHELF_LENGTH + 2, SHELF_EDGE_COLOR),
  rect(TILE_SIZE - 3, 6, 5, 2, ODD_BOOK_COLOR),
  rect(TILE_SIZE + 1, 6, 1, 2, ODD_BOOK_LIGHT_COLOR),
  rect(TILE_SIZE + 1, 6, 1, 1, BOOK_GLINT_COLOR),
]

// NOTE: open, the shelf has swung into the room on its hinge at the north
// end and stands across the floor with its books to the south, the wall
// behind it a dark gap with the next room's floor showing through, its arc
// scraped in the dust, and two books shaken loose.
const openShapes = (): ReadonlyArray<Canvas.Shape> => [
  rect(0, 0, TILE_SIZE, SHELF_LENGTH, EXIT_GAP_COLOR),
  ...Array.makeBy(4, index =>
    rect(0, 1 + index * 5, 3, 4, pick(PLANK_SHADES, roll(index, 880))),
  ),
  rect(3, 0, 1, SHELF_LENGTH, '#0a0708'),
  ...Array.makeBy(14, index => {
    const angle = (index / 13) * (Math.PI / 2)
    return rect(
      TILE_SIZE + Math.round(Math.cos(angle) * SHELF_LENGTH),
      Math.round(Math.sin(angle) * SHELF_LENGTH),
      1,
      1,
      DUST_COLOR,
    )
  }),
  rect(TILE_SIZE, -6, SHELF_LENGTH, 13, SHELF_WOOD_COLOR),
  rect(TILE_SIZE - 1, -7, SHELF_LENGTH + 2, 2, SHELF_EDGE_COLOR),
  rect(TILE_SIZE + 1, -4, SHELF_LENGTH - 2, 9, SHELF_BACK_COLOR),
  ...Array.flatMap([-4, 1], shelfY =>
    Array.filterMap(
      Array.makeBy(Math.floor((SHELF_LENGTH - 2) / 2), index => index),
      index =>
        roll(shelfY + 20, index + 890) < 0.15
          ? Result.failVoid
          : Result.succeed(
              rect(
                TILE_SIZE + 1 + index * 2,
                shelfY + Math.floor(roll(shelfY + 20, index + 895) * 2),
                2,
                4,
                pick(BOOK_COLORS, roll(shelfY + 20, index + 900)),
              ),
            ),
    ),
  ),
  rect(TILE_SIZE + 1, 0, SHELF_LENGTH - 2, 1, SHELF_EDGE_COLOR),
  rect(TILE_SIZE + 1, 5, SHELF_LENGTH - 2, 1, SHELF_EDGE_COLOR),
  rect(TILE_SIZE, 6, SHELF_LENGTH, 1, '#1a110a'),
  rect(TILE_SIZE + 9, -4, 2, 4, ODD_BOOK_COLOR),
  rect(TILE_SIZE + 4, 12, 4, 2, '#3d4f7a'),
  rect(TILE_SIZE + 4, 12, 4, 1, '#5a6f9a'),
  rect(TILE_SIZE + 11, 15, 3, 2, '#b8813f'),
]

// NOTE: each state's pixels on each wall as rectangles, drawn at the top
// left corner of the shelf's two wall tiles, for a room image that bakes
// the shelf in with everything else (the studio's preview).
export const SHELF_SHAPES: Readonly<
  Record<ShelfWall, Readonly<Record<ShelfState, ReadonlyArray<Canvas.Shape>>>>
> = {
  West: { Shut: shutShapes(), Open: openShapes() },
  East: {
    Shut: flipped(shutShapes(), 'East'),
    Open: flipped(openShapes(), 'East'),
  },
}

// NOTE: each state's sprite on each wall, built once.
export const SHELF_SPRITES: Readonly<
  Record<ShelfWall, Readonly<Record<ShelfState, ReadonlyArray<Canvas.Shape>>>>
> = {
  West: {
    Shut: bakeShapes(SHELF_SHAPES.West.Shut),
    Open: bakeShapes(SHELF_SHAPES.West.Open),
  },
  East: {
    Shut: bakeShapes(SHELF_SHAPES.East.Shut),
    Open: bakeShapes(SHELF_SHAPES.East.Open),
  },
}
