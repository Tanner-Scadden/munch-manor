import { Array, Function, Result } from 'effect'

import { type Palette, bakeShapes } from '../../art/sprite'
import { TILE_SIZE } from '../../shared/constants'
import type { Level } from '../../world/level/arena'
import { LIBRARY_RUG } from '../../world/level/rugs'
import type * as Draw from '../draw'
import { pixelArt, rect } from '../drawing'
import { WALL_FACE_ROWS } from '../iso/space'
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
  FACE_TOP,
  FLAME_COLOR,
  GOLD_COLOR,
  GOLD_DARK_COLOR,
  GOLD_LIGHT_COLOR,
  INK_COLOR,
  PLANK_HEIGHT,
  PLANK_JOINT_COLOR,
  PLANK_SEAM_COLOR,
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
): ReadonlyArray<Draw.Shape> => [
  rect(room.x, room.y, room.width, room.height, FLOOR_SHADE_COLOR),
]

export const libraryRugShapes = (room: Box): ReadonlyArray<Draw.Shape> => {
  const x = room.x + LIBRARY_RUG.x
  const y = room.y + LIBRARY_RUG.y
  const { width, height } = LIBRARY_RUG
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

const paperShapes = ({ x, y, width }: Span): ReadonlyArray<Draw.Shape> => {
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
  (room: Box): (level: Level) => ReadonlyArray<Draw.Shape>
  (level: Level, room: Box): ReadonlyArray<Draw.Shape>
} = Function.dual(2, (level: Level, room: Box): ReadonlyArray<Draw.Shape> =>
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

const windowSpotOf = (room: Box): Readonly<{ x: number; y: number }> => ({
  x: room.x + 44,
  y: room.y + 4,
})

// NOTE: the glass of the library's arched window, below its arch, where the
// storm rains and flashes (src/render/iso/storm.ts).
export const libraryWindowPaneOf = (room: Box): Box => {
  const { x, y } = windowSpotOf(room)
  return { x: x + 1, y: y + 2, width: 10, height: 13 }
}

// NOTE: a tall arched window with the moon in it, between two stretches of
// paper; a clock stopped at the party's hour and a map with a red X, either
// side of the rose window (roseWindowArt.ts); and a Munch who never looked
// up from her book.
export const libraryWallDecorShapes = (
  room: Box,
): ReadonlyArray<Draw.Shape> => {
  const { x: windowX, y: windowY } = windowSpotOf(room)
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
    ...pixelArt(room.x + 204, room.y + 4, CLOCK_PIXELS, CLOCK_PALETTE),
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
}: Box): ReadonlyArray<Draw.Shape> => {
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
export const ladderShapes = (room: Box): ReadonlyArray<Draw.Shape> => {
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
): ReadonlyArray<Draw.Shape> => [
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

const bankerLamp = (x: number, y: number): ReadonlyArray<Draw.Shape> => [
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
export const deskShapes = ({ x, y, width }: Box): ReadonlyArray<Draw.Shape> => {
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
export const globeShapes = ({ x, y }: Box): ReadonlyArray<Draw.Shape> => {
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
  shapes: ReadonlyArray<Draw.Shape>,
  wall: ShelfWall,
): ReadonlyArray<Draw.Shape> =>
  wall === 'West'
    ? shapes
    : Array.map(shapes, shape =>
        shape._tag === 'Rect'
          ? { ...shape, x: TILE_SIZE - shape.x - shape.width }
          : shape,
      )

const bookTops = (seed: number): ReadonlyArray<Draw.Shape> =>
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

// NOTE: shut, the shelf is built into the wall, as tall as the wall it is
// set in: its books' tops show from above, as any wall's top wears its art.
// Its face, the red book sticking out of it, stands carved
// (src/render/room/shelfCarve.ts).
const shutShapes = (): ReadonlyArray<Draw.Shape> => [
  rect(0, -1, TILE_SIZE, SHELF_LENGTH + 2, SHELF_WOOD_COLOR),
  rect(1, 0, TILE_SIZE - 2, SHELF_LENGTH, SHELF_BACK_COLOR),
  ...bookTops(3),
  rect(1, 9, TILE_SIZE - 2, 1, SHELF_EDGE_COLOR),
  rect(TILE_SIZE - 1, -1, 1, SHELF_LENGTH + 2, SHELF_EDGE_COLOR),
  rect(TILE_SIZE - 3, 6, 3, 2, ODD_BOOK_COLOR),
]

// NOTE: open, the shelf has swung into the room on its hinge at the north
// end and stands across the floor with its books to the south (the swung
// case, `SWUNG_SHELF_SPRITES`), its arc scraped in the dust and two books
// shaken loose. The wall it stood in is a passage, planks running through
// it from the room next door, the library's shade over its own half.
const openShapes = (): ReadonlyArray<Draw.Shape> => [
  ...Array.flatMap(
    Array.makeBy(SHELF_LENGTH / PLANK_HEIGHT, row => row * PLANK_HEIGHT),
    y => [
      rect(-TILE_SIZE, y, SHELF_LENGTH, 1, PLANK_SEAM_COLOR),
      rect(
        -TILE_SIZE,
        y + 1,
        SHELF_LENGTH,
        PLANK_HEIGHT - 1,
        pick(PLANK_SHADES, roll(y, 880)),
      ),
    ],
  ),
  rect(-3, 1, 1, PLANK_HEIGHT - 1, PLANK_JOINT_COLOR),
  rect(4, 11, 1, PLANK_HEIGHT - 1, PLANK_JOINT_COLOR),
  rect(0, 0, TILE_SIZE, SHELF_LENGTH, FLOOR_SHADE_COLOR),
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
  rect(TILE_SIZE + 4, 12, 4, 2, '#3d4f7a'),
  rect(TILE_SIZE + 4, 12, 4, 1, '#5a6f9a'),
  rect(TILE_SIZE + 11, 15, 3, 2, '#b8813f'),
]

// NOTE: the case seen square from its books' side, as long as the shelf and
// as tall as the wall it is set in (a tall wall's rows of face,
// src/render/iso/space.ts): its rim, two rows of books on a ledge, its
// base, and the red book `oddBookX` from its left on the top row.
export const SHELF_CASE_HEIGHT = WALL_FACE_ROWS

export const SHELF_CASE_LENGTH = SHELF_LENGTH

const CASE_BASE_COLOR = '#1a110a'

// NOTE: how tall a book stands, the ledge between the two rows of books,
// and each row's top.
const BOOK_PX = 3
const LEDGE_ROW = 1 + BOOK_PX
const BOOK_ROWS: ReadonlyArray<number> = [1, LEDGE_ROW + 1]

export const shelfCaseShapes = (
  oddBookX: number,
): ReadonlyArray<Draw.Shape> => [
  rect(0, 0, SHELF_LENGTH, SHELF_CASE_HEIGHT, SHELF_WOOD_COLOR),
  rect(0, 0, SHELF_LENGTH, 1, SHELF_EDGE_COLOR),
  rect(1, 1, SHELF_LENGTH - 2, SHELF_CASE_HEIGHT - 2, SHELF_BACK_COLOR),
  ...Array.flatMap(BOOK_ROWS, row =>
    Array.filterMap(
      Array.makeBy(Math.floor((SHELF_LENGTH - 2) / 2), index => index),
      index => {
        if (roll(row + 13, index + 890) < 0.15) {
          return Result.failVoid
        }
        const sunk = Math.floor(roll(row + 13, index + 895) * 2)
        return Result.succeed(
          rect(
            1 + index * 2,
            row + sunk,
            2,
            BOOK_PX - sunk,
            pick(BOOK_COLORS, roll(row + 13, index + 900)),
          ),
        )
      },
    ),
  ),
  rect(1, LEDGE_ROW, SHELF_LENGTH - 2, 1, SHELF_EDGE_COLOR),
  rect(0, SHELF_CASE_HEIGHT - 1, SHELF_LENGTH, 1, CASE_BASE_COLOR),
  rect(oddBookX, 1, 2, BOOK_PX, ODD_BOOK_COLOR),
]

// NOTE: the colors of the case's frame: its wood, rim, ledges, and base,
// which stand a pixel prouder than its books where it is carved.
export const SHELF_FRAME_COLORS: ReadonlySet<string> = new Set([
  SHELF_WOOD_COLOR,
  SHELF_EDGE_COLOR,
  CASE_BASE_COLOR,
])

export const SHELF_BOOK_COLORS = {
  odd: ODD_BOOK_COLOR,
  light: ODD_BOOK_LIGHT_COLOR,
  glint: BOOK_GLINT_COLOR,
} as const

const shifted = (
  shapes: ReadonlyArray<Draw.Shape>,
  dx: number,
  dy: number,
): ReadonlyArray<Draw.Shape> =>
  Array.map(shapes, shape =>
    shape._tag === 'Rect'
      ? { ...shape, x: shape.x + dx, y: shape.y + dy }
      : shape,
  )

// NOTE: swung open, the case stands across the floor east of the west
// wall's tile, its books to the south and its hinge at the wall, its foot
// 7 pixels below the shelf's top: drawn as if in the west wall, flipped for
// the east, as the shelf's own art is.
export const SWUNG_SHELF_FOOT_PX = 7

const swungShapes = (): ReadonlyArray<Draw.Shape> =>
  shifted(
    shelfCaseShapes(9),
    TILE_SIZE,
    SWUNG_SHELF_FOOT_PX - SHELF_CASE_HEIGHT,
  )

// NOTE: each state's pixels on each wall as rectangles, drawn at the top
// left corner of the shelf's two wall tiles, for a room image that bakes
// the shelf in with everything else (the studio's preview).
export const SHELF_SHAPES: Readonly<
  Record<ShelfWall, Readonly<Record<ShelfState, ReadonlyArray<Draw.Shape>>>>
> = {
  West: { Shut: shutShapes(), Open: openShapes() },
  East: {
    Shut: flipped(shutShapes(), 'East'),
    Open: flipped(openShapes(), 'East'),
  },
}

// NOTE: the swung case on each wall, built once: it stands carved in the
// room (src/render/room/tallCover.ts).
export const SWUNG_SHELF_SPRITES: Readonly<
  Record<ShelfWall, ReadonlyArray<Draw.Shape>>
> = {
  West: bakeShapes(swungShapes()),
  East: bakeShapes(flipped(swungShapes(), 'East')),
}

// NOTE: each state's sprite on each wall, built once.
export const SHELF_SPRITES: Readonly<
  Record<ShelfWall, Readonly<Record<ShelfState, ReadonlyArray<Draw.Shape>>>>
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
