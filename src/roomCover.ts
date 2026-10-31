import { Array, Option, Record, Result, pipe } from 'effect'
import type { Canvas } from 'foldkit'

import {
  COVER_SYMBOLS,
  type CoverKind,
  type Level,
  type Tile,
  symbolAt,
  tilesWithSymbol,
} from './arena'
import { TILE_SIZE } from './constants'
import { pixelArt, rect } from './drawing'
import {
  fridgeShapes,
  ovenShapes,
  pantryShapes,
  prepTableShapes,
  sacksShapes,
  sinkShapes,
} from './kitchenView'
import {
  BONE_COLOR,
  type Box,
  CANDLE_COLOR,
  CASING_COLOR,
  COVER_SHADOW_COLOR,
  FACE_TOP,
  FLAME_COLOR,
  GOLD_COLOR,
  GOLD_DARK_COLOR,
  INK_COLOR,
  pick,
  roll,
} from './roomPalette'
import { type Palette, mirrorRows } from './sprite'

// COVER

const isSymbolAt = (
  level: Level,
  symbol: string,
  column: number,
  row: number,
): boolean =>
  Option.exists(symbolAt(level, column, row), found => found === symbol)

const runLength = (
  level: Level,
  symbol: string,
  column: number,
  row: number,
  stepColumn: number,
  stepRow: number,
): number =>
  isSymbolAt(level, symbol, column, row)
    ? 1 +
      runLength(
        level,
        symbol,
        column + stepColumn,
        row + stepRow,
        stepColumn,
        stepRow,
      )
    : 0

const isBlockCorner = (
  level: Level,
  symbol: string,
  { column, row }: Tile,
): boolean =>
  !isSymbolAt(level, symbol, column - 1, row) &&
  !isSymbolAt(level, symbol, column, row - 1)

const blockAt = (level: Level, symbol: string, { column, row }: Tile): Box => ({
  x: column * TILE_SIZE,
  y: row * TILE_SIZE,
  width: runLength(level, symbol, column, row, 1, 0) * TILE_SIZE,
  height: runLength(level, symbol, column, row, 0, 1) * TILE_SIZE,
})

const coverShadow = ({ x, y, width, height }: Box): Canvas.Shape =>
  rect(x + 2, y + height, width - 2, 2, COVER_SHADOW_COLOR)

const isWestHalf = ({ x, width }: Box, level: Level): boolean =>
  x + width / 2 < level.width / 2

// NOTE: an upright piano against the wall, its back rising up the wallpaper,
// with a candelabra on top and one key bitten off.
const pianoShapes = ({
  x,
  y,
  width,
  height,
}: Box): ReadonlyArray<Canvas.Shape> => {
  const bottom = y + height
  const keysY = bottom - 13
  const keyCount = Math.floor((width - 4) / 2)
  return [
    rect(x, y - 13, width, bottom - y + 11, '#241a28'),
    rect(x - 1, y - 14, width + 2, 3, '#352838'),
    rect(x - 1, y - 14, width + 2, 1, '#4a3c50'),
    rect(x + 3, y - 9, 10, 8, '#2c2030'),
    rect(x + width - 13, y - 9, 10, 8, '#2c2030'),
    rect(x + 4, y - 8, 8, 1, GOLD_DARK_COLOR),
    rect(x + width - 12, y - 8, 8, 1, GOLD_DARK_COLOR),
    rect(x + 9, y - 3, 12, 7, '#e8dcc0'),
    rect(x + 10, y - 1, 10, 1, '#8a8090'),
    rect(x + 10, y + 1, 10, 1, '#8a8090'),
    rect(x + 12, y - 2, 1, 2, INK_COLOR),
    rect(x + 16, y, 1, 2, INK_COLOR),
    rect(x, keysY - 2, width, 2, '#352838'),
    rect(x + 1, keysY, width - 2, 5, '#efe6d2'),
    ...Array.makeBy(keyCount, index =>
      rect(x + 2 + index * 2, keysY + 3, 1, 2, '#c9bfa8'),
    ),
    ...Array.filterMap(
      Array.makeBy(keyCount, index => index),
      index =>
        index % 7 === 2 || index % 7 === 6
          ? Result.failVoid
          : Result.succeed(rect(x + 3 + index * 2, keysY, 1, 3, INK_COLOR)),
    ),
    rect(x + 19, keysY, 3, 5, '#5a4a3e'),
    rect(x + 19, keysY + 4, 1, 1, '#efe6d2'),
    rect(x, keysY + 5, width, bottom - keysY - 7, '#1d1620'),
    rect(x + 1, keysY + 5, width - 2, 1, '#352838'),
    rect(x + 1, bottom - 4, 3, 2, '#140f12'),
    rect(x + width - 4, bottom - 4, 3, 2, '#140f12'),
    rect(x + 12, bottom - 4, 6, 1, GOLD_COLOR),
    // NOTE: the candelabra on top.
    rect(x + width - 10, y - 15, 7, 1, GOLD_COLOR),
    rect(x + width - 7, y - 17, 1, 2, GOLD_COLOR),
    rect(x + width - 10, y - 18, 1, 3, CANDLE_COLOR),
    rect(x + width - 7, y - 19, 1, 2, CANDLE_COLOR),
    rect(x + width - 4, y - 18, 1, 3, CANDLE_COLOR),
    rect(x + width - 10, y - 19, 1, 1, FLAME_COLOR),
    rect(x + width - 7, y - 20, 1, 1, FLAME_COLOR),
    rect(x + width - 4, y - 19, 1, 1, FLAME_COLOR),
  ]
}

// NOTE: the fireplace: a stone chimney breast up the wall, a mantel with a
// skull, a clock, and a candle, and a firebox whose flames the scene draws.
const hearthShapes = ({
  x,
  y,
  width,
  height,
}: Box): ReadonlyArray<Canvas.Shape> => {
  const centerX = x + width / 2
  const bottom = y + height
  const breastX = x - 6
  const breastWidth = width + 12
  const mantelY = 9
  const opening = { x: x + 6, y: 14, width: width - 12, height: bottom - 16 }
  const brickRows = Array.makeBy(4, index => FACE_TOP + 1 + index * 3)
  return [
    rect(breastX, FACE_TOP, breastWidth, y - FACE_TOP, '#4e4552'),
    ...Array.flatMap(brickRows, (rowY, index) => [
      rect(breastX, rowY, breastWidth, 1, '#3e3644'),
      ...Array.makeBy(Math.floor(breastWidth / 8), brick =>
        rect(breastX + brick * 8 + (index % 2) * 4, rowY - 2, 1, 2, '#3e3644'),
      ),
    ]),
    rect(x - 2, mantelY + 3, width + 4, bottom - mantelY - 6, '#6b6170'),
    rect(x - 2, mantelY + 3, width + 4, 1, '#7d7384'),
    rect(x - 2, mantelY + 3, 1, bottom - mantelY - 6, '#7d7384'),
    rect(
      opening.x - 1,
      opening.y + 1,
      opening.width + 2,
      opening.height - 1,
      '#140a08',
    ),
    rect(
      opening.x + 1,
      opening.y,
      opening.width - 2,
      opening.height,
      '#140a08',
    ),
    rect(opening.x + 1, opening.y + 2, opening.width - 2, 7, '#2a120c'),
    ...Array.makeBy(3, index =>
      rect(
        opening.x + 1,
        opening.y + 3 + index * 2,
        opening.width - 2,
        1,
        '#3a1a10',
      ),
    ),
    rect(centerX - 2, mantelY + 3, 4, 3, '#8d8394'),
    rect(x - 10, mantelY, width + 20, 3, '#5a3a22'),
    rect(x - 10, mantelY, width + 20, 1, '#7a5232'),
    rect(x - 9, mantelY + 3, width + 18, 1, '#2a1a10'),
    // NOTE: the mantel's knickknacks.
    rect(x - 7, mantelY - 4, 2, 4, CANDLE_COLOR),
    rect(x - 7, mantelY - 6, 2, 2, FLAME_COLOR),
    rect(x - 8, mantelY - 1, 4, 1, GOLD_COLOR),
    rect(centerX - 3, mantelY - 5, 6, 4, BONE_COLOR),
    rect(centerX - 2, mantelY - 1, 4, 1, BONE_COLOR),
    rect(centerX - 2, mantelY - 4, 1, 1, INK_COLOR),
    rect(centerX + 1, mantelY - 4, 1, 1, INK_COLOR),
    rect(centerX - 1, mantelY - 1, 1, 1, INK_COLOR),
    rect(x + width + 1, mantelY - 6, 6, 6, CASING_COLOR),
    rect(x + width + 2, mantelY - 5, 4, 4, '#e8dcc0'),
    rect(x + width + 4, mantelY - 4, 1, 2, INK_COLOR),
    rect(x + width + 4, mantelY - 3, 2, 1, INK_COLOR),
    rect(x + 6, mantelY - 3, 3, 3, '#3f7a3a'),
    rect(x + 7, mantelY - 4, 1, 1, '#7fbf5a'),
    // NOTE: the andirons and logs the flames sit on.
    rect(opening.x + 2, bottom - 7, 2, 4, '#2a2228'),
    rect(opening.x + opening.width - 4, bottom - 7, 2, 4, '#2a2228'),
    rect(opening.x + 3, bottom - 7, opening.width - 6, 3, '#5a3a22'),
    rect(opening.x + 5, bottom - 8, opening.width - 10, 2, '#6b4a2e'),
    rect(opening.x + 3, bottom - 6, 1, 1, '#c9a06a'),
    rect(opening.x + opening.width - 4, bottom - 6, 1, 1, '#c9a06a'),
    rect(opening.x + 3, bottom - 4, opening.width - 6, 1, '#c84a1a'),
    // NOTE: the hearth slab out on the floor.
    rect(x - 4, bottom - 3, width + 8, 3, '#7d7384'),
    rect(x - 4, bottom - 3, width + 8, 1, '#968ca0'),
    rect(x - 4, bottom - 1, width + 8, 1, '#5e5568'),
  ]
}

const BOOK_COLORS: Array.NonEmptyReadonlyArray<string> = [
  '#7a2338',
  '#2f5d50',
  '#5b3f8c',
  '#b8813f',
  '#3d4f7a',
  '#8a4a2a',
  '#4a6a3a',
]

const SHELF_BACK_COLOR = '#22150c'
const SHELF_WOOD_COLOR = '#3e2716'
const SHELF_EDGE_COLOR = '#5a3a22'

const booksOnShelf = (
  left: number,
  right: number,
  floorY: number,
  room: number,
  shelf: number,
): ReadonlyArray<Canvas.Shape> => {
  const widths = Array.makeBy(Math.floor((right - left) / 2), index =>
    roll(shelf, index + 300) < 0.15
      ? 0
      : 2 + Math.floor(roll(shelf, index + 400) * 2),
  )
  const starts = Array.scan(
    widths,
    left,
    (at, bookWidth) => at + Math.max(bookWidth, 2),
  )
  return Array.filterMap(
    Array.zip(widths, starts),
    ([bookWidth, start], index) => {
      if (bookWidth === 0 || start + bookWidth > right) {
        return Result.failVoid
      }
      const bookHeight = room - Math.floor(roll(shelf, index + 500) * 3)
      return Result.succeed(
        rect(
          start,
          floorY - bookHeight,
          bookWidth,
          bookHeight,
          pick(BOOK_COLORS, roll(shelf, index + 600)),
        ),
      )
    },
  )
}

const bookshelfShapes = ({
  x,
  y,
  width,
  height,
}: Box): ReadonlyArray<Canvas.Shape> => {
  const top = 2
  const bottom = y + height
  const innerLeft = x + 3
  const innerRight = x + width - 3
  const shelves = [
    { floorY: 10, room: 6 },
    { floorY: 17, room: 5 },
    { floorY: 24, room: 5 },
  ]
  const middle = x + Math.floor(width / 2)
  return [
    rect(x, top, width, bottom - top, SHELF_WOOD_COLOR),
    rect(x - 1, top - 1, width + 2, 2, SHELF_EDGE_COLOR),
    rect(innerLeft, top + 2, innerRight - innerLeft, 22, SHELF_BACK_COLOR),
    ...Array.flatMap(shelves, ({ floorY, room }, shelf) => [
      ...booksOnShelf(innerLeft, middle - 1, floorY, room, shelf * 2),
      ...booksOnShelf(middle + 1, innerRight, floorY, room, shelf * 2 + 1),
      rect(innerLeft, floorY, innerRight - innerLeft, 2, SHELF_EDGE_COLOR),
    ]),
    rect(middle - 1, top + 2, 2, 22, SHELF_WOOD_COLOR),
    // NOTE: a skull bookend, a jar with an eye in it, and a candle.
    rect(middle + 8, 5, 5, 4, BONE_COLOR),
    rect(middle + 9, 6, 1, 1, INK_COLOR),
    rect(middle + 11, 6, 1, 1, INK_COLOR),
    rect(middle + 8, 9, 5, 1, SHELF_EDGE_COLOR),
    rect(innerLeft + 2, 13, 5, 4, 'rgba(160, 200, 160, 0.55)'),
    rect(innerLeft + 3, 14, 2, 2, '#f4f1de'),
    rect(innerLeft + 4, 14, 1, 1, '#3d4f7a'),
    rect(innerLeft + 2, 12, 5, 1, '#8a8090'),
    rect(innerRight - 4, 20, 2, 4, CANDLE_COLOR),
    rect(innerRight - 4, 18, 2, 2, FLAME_COLOR),
    rect(x, bottom - 4, width, 4, SHELF_WOOD_COLOR),
    rect(x, bottom - 4, width, 1, SHELF_EDGE_COLOR),
    rect(x + 2, bottom - 2, width - 4, 1, '#2a1a10'),
  ]
}

const ARMCHAIR_PIXELS: ReadonlyArray<string> = [
  '.BBB......',
  'BbbBb.....',
  'BbBBAaaaa.',
  'BbBBAAAAAA',
  'BtBBAAAAAA',
  'BbBBSssss.',
  'BbBBSSSSSf',
  'BtBBSSSSSf',
  'BbBBSSSSSf',
  'BbBBSSSSSf',
  'BbBBSSSSSf',
  'BtBBSSSSSf',
  'BbBBSSSSSf',
  'BbBBSSSSSf',
  'BtBBSSSSSf',
  'BbBBSSSSSf',
  'BbBBAaaaa.',
  'BbBBAAAAAA',
  'BBBBAAAAAA',
  'BBBBAAAAAA',
  '.l......l.',
]

const ARMCHAIR_PALETTE: Palette = {
  B: '#22463c',
  b: '#2f5d50',
  t: '#183229',
  A: '#2f5d50',
  a: '#4a8a72',
  S: '#3f7a68',
  s: '#5a9a80',
  f: GOLD_COLOR,
  l: '#1a120e',
}

const armchairShapes = (box: Box, level: Level): ReadonlyArray<Canvas.Shape> =>
  pixelArt(
    box.x,
    box.y - 1,
    isWestHalf(box, level) ? ARMCHAIR_PIXELS : mirrorRows(ARMCHAIR_PIXELS),
    ARMCHAIR_PALETTE,
  )

// NOTE: the sofa faces the fire, so the room sees its tufted back, with a
// pillow and a rip that spills stuffing.
const couchShapes = ({ x, y, width }: Box): ReadonlyArray<Canvas.Shape> => {
  const cushion = Math.floor((width - 8) / 3)
  return [
    rect(x + 3, y - 2, width - 6, 4, '#a33a52'),
    rect(x + 3, y - 2, width - 6, 1, '#c0506a'),
    rect(x + 4 + cushion, y - 2, 1, 4, '#7a2338'),
    rect(x + 4 + cushion * 2, y - 2, 1, 4, '#7a2338'),
    rect(x + 6, y - 3, 7, 4, '#e8dcc0'),
    rect(x + 6, y - 3, 7, 1, '#f4f1de'),
    rect(x + 1, y + 1, width - 2, 8, '#7a2338'),
    rect(x + 1, y + 1, width - 2, 2, '#9a3048'),
    rect(x + 1, y + 1, width - 2, 1, '#b04060'),
    ...Array.flatMap(
      Array.makeBy(Math.floor((width - 8) / 6), index => index),
      index => [
        rect(x + 6 + index * 6, y + 4, 1, 1, '#5e1a2b'),
        rect(x + 9 + index * 6, y + 6, 1, 1, '#5e1a2b'),
      ],
    ),
    rect(x + 1, y + 8, width - 2, 1, GOLD_COLOR),
    rect(x + 38, y + 4, 4, 2, '#f2e6c8'),
    rect(x + 39, y + 3, 2, 1, '#f2e6c8'),
    rect(x + 37, y + 5, 1, 1, '#5e1a2b'),
    rect(x, y - 2, 4, 11, '#661c2f'),
    rect(x + width - 4, y - 2, 4, 11, '#661c2f'),
    rect(x, y - 2, 4, 2, '#8a2a40'),
    rect(x + width - 4, y - 2, 4, 2, '#8a2a40'),
    rect(x + 2, y + 9, 2, 1, '#2a1810'),
    rect(x + width - 4, y + 9, 2, 1, '#2a1810'),
  ]
}

const teaTableShapes = (
  box: Box,
  level: Level,
): ReadonlyArray<Canvas.Shape> => {
  const { x, y } = box
  const setting = isWestHalf(box, level)
    ? [
        rect(x + 6, y + 4, 5, 4, '#5a7ab0'),
        rect(x + 7, y + 3, 3, 1, '#7a9ad0'),
        rect(x + 11, y + 5, 2, 1, '#5a7ab0'),
        rect(x + 5, y + 5, 1, 2, '#5a7ab0'),
        rect(x + 12, y + 8, 3, 2, '#f2ead8'),
        rect(x + 13, y + 8, 1, 1, '#7fbf5a'),
      ]
    : [
        rect(x + 4, y + 7, 6, 3, '#7a2338'),
        rect(x + 5, y + 7, 4, 2, '#e8dcc0'),
        rect(x + 7, y + 7, 1, 2, '#c9bfa8'),
        rect(x + 12, y + 3, 2, 5, CANDLE_COLOR),
        rect(x + 12, y + 1, 2, 2, FLAME_COLOR),
        rect(x + 11, y + 7, 4, 1, CANDLE_COLOR),
        rect(x + 11, y - 1, 4, 4, 'rgba(255, 210, 63, 0.12)'),
      ]
  return [
    rect(x + 8, y + 13, 4, 5, '#3d2614'),
    rect(x + 4, y + 17, 12, 2, '#3d2614'),
    rect(x + 3, y + 1, 14, 13, '#6b4423'),
    rect(x + 1, y + 3, 18, 9, '#6b4423'),
    rect(x + 3, y + 1, 14, 1, '#8f5f36'),
    rect(x + 1, y + 11, 18, 1, '#4a2e17'),
    rect(x + 3, y + 13, 14, 1, '#4a2e17'),
    rect(x + 5, y + 3, 10, 8, '#e8e0cc'),
    rect(x + 4, y + 5, 12, 4, '#e8e0cc'),
    rect(x + 6, y + 4, 1, 1, '#c9bfa8'),
    rect(x + 13, y + 4, 1, 1, '#c9bfa8'),
    rect(x + 6, y + 9, 1, 1, '#c9bfa8'),
    rect(x + 13, y + 9, 1, 1, '#c9bfa8'),
    ...setting,
  ]
}

const FERN_PIXELS: ReadonlyArray<string> = [
  '.........g..........',
  '....g....gG....g....',
  '.....gG..gG...Gg....',
  '..g...gG.G...Gg..g..',
  '...gG..gGgG.Gg..Gg..',
  '....gGg.gGGgG.gGg...',
  '.gg..gGggGGgGgGg..gg',
  '..gGG.gGgwkgGg.GGg..',
  '....gGGgGGGGGgGGg...',
  '.gGGggGGGGGGGGgggGg.',
  '..gg.gGGgGGgGGg.gg..',
  '...dg.gGg.gGgGg.gd..',
  '..d..g.g...g..g...d.',
  '.....rRRRRRRRRRr....',
  '....rRRRRRRRRRRRr...',
  '.....rrrrrrrrrrr....',
  '.....OOOOOOOOOOO....',
  '.....OOOoOOOOOOO....',
  '.....OOOOOOOOoOO....',
  '......OOOOOOOOO.....',
  '......ooooooooo.....',
  '.......ooooooo......',
]

const FERN_PALETTE: Palette = {
  g: '#2c5a2a',
  G: '#4f8f3e',
  d: '#7a6a3a',
  w: '#f4f1de',
  k: '#c8343c',
  r: '#8a4a2a',
  R: '#c27040',
  O: '#9a5430',
  o: '#6a3820',
}

const fernShapes = ({ x, y }: Box): ReadonlyArray<Canvas.Shape> =>
  pixelArt(x, y - 2, FERN_PIXELS, FERN_PALETTE)

// NOTE: the coffin's lid has slid down, and something inside is peeking out.
const COFFIN_PIXELS: ReadonlyArray<string> = [
  '..aaaaaa..',
  '.aKKKKKKa.',
  'aKKwKKwKKa',
  'aKKKKKKKKa',
  'aLLLLLLLLa',
  'abbbbbbbba',
  'abbbccbbba',
  'abbbccbbba',
  'abccccccba',
  'abbbccbbba',
  'abbbccbbba',
  'abbbccbbba',
  '.abbbbbba.',
  '.abbbbbba.',
  '.ahbbbbha.',
  '.abbbbbba.',
  '..abbbba..',
  '..abbbba..',
  '..ahbbha..',
  '...aaaa...',
]

const COFFIN_PALETTE: Palette = {
  a: '#2e1c14',
  K: '#120a0c',
  w: '#e8f070',
  L: '#6a4532',
  b: '#4a2f22',
  c: '#c9a86a',
  h: GOLD_COLOR,
}

const coffinShapes = ({ x, y }: Box): ReadonlyArray<Canvas.Shape> =>
  pixelArt(x, y, COFFIN_PIXELS, COFFIN_PALETTE)

const trunkShapes = ({
  x,
  y,
  width,
  height,
}: Box): ReadonlyArray<Canvas.Shape> => [
  rect(x, y, width, height - 1, '#6b4423'),
  rect(x, y - 1, width, 4, '#7a5232'),
  rect(x, y - 1, width, 1, '#9a6a42'),
  rect(x, y + 3, width, 1, '#3d2614'),
  rect(x + 4, y - 1, 2, height, '#3d2a1a'),
  rect(x + width - 6, y - 1, 2, height, '#3d2a1a'),
  rect(x, y - 1, 2, 2, '#c9a86a'),
  rect(x + width - 2, y - 1, 2, 2, '#c9a86a'),
  rect(x, y + height - 3, 2, 2, '#c9a86a'),
  rect(x + width - 2, y + height - 3, 2, 2, '#c9a86a'),
  rect(x + width / 2 - 1, y + 2, 2, 3, '#c9a86a'),
  rect(x + 8, y + 5, 4, 3, '#d9c9a3'),
  rect(x + 9, y + 6, 2, 1, '#c8343c'),
]

const crateShapes = ({
  x,
  y,
  width,
  height,
}: Box): ReadonlyArray<Canvas.Shape> => [
  ...Array.flatMap(
    Array.makeBy((width / TILE_SIZE) * (height / TILE_SIZE), index => index),
    index => {
      const crateX = x + (index % (width / TILE_SIZE)) * TILE_SIZE
      const crateY = y + Math.floor(index / (width / TILE_SIZE)) * TILE_SIZE
      return [
        rect(crateX, crateY, TILE_SIZE, TILE_SIZE, '#8a5a2b'),
        rect(crateX, crateY, TILE_SIZE, 1, '#b8813f'),
        rect(crateX, crateY + 4, TILE_SIZE, 2, '#5c3a1a'),
        rect(crateX + TILE_SIZE - 1, crateY + 1, 1, TILE_SIZE - 1, '#5c3a1a'),
      ]
    },
  ),
  // NOTE: the shopkeeper's stock pokes out of the top.
  rect(x + 2, y - 3, 2, 4, '#3f7a3a'),
  rect(x + 2, y - 4, 2, 1, '#c9a06a'),
  rect(x + 5, y - 2, 3, 3, '#c8343c'),
  rect(x + 5, y - 2, 3, 1, '#e05a5a'),
  rect(x + 12, y - 1, 7, 2, '#5a5a66'),
  rect(x + 12, y - 1, 2, 3, '#3d2a1a'),
]

const COVER_DRAWINGS: Readonly<
  Record<CoverKind, (box: Box, level: Level) => ReadonlyArray<Canvas.Shape>>
> = {
  Piano: pianoShapes,
  Hearth: hearthShapes,
  Bookshelf: bookshelfShapes,
  Armchair: armchairShapes,
  Couch: couchShapes,
  TeaTable: teaTableShapes,
  Fern: fernShapes,
  Coffin: coffinShapes,
  Trunk: trunkShapes,
  Crate: crateShapes,
  Oven: ovenShapes,
  PrepTable: prepTableShapes,
  Sink: sinkShapes,
  Pantry: pantryShapes,
  Sacks: sacksShapes,
  Fridge: fridgeShapes,
}

const coverShapes = (
  level: Level,
  symbol: string,
  kind: CoverKind,
): ReadonlyArray<Canvas.Shape> =>
  pipe(
    tilesWithSymbol(level, symbol),
    Array.filter(tile => isBlockCorner(level, symbol, tile)),
    Array.flatMap(tile => {
      const box = blockAt(level, symbol, tile)
      return [coverShadow(box), ...COVER_DRAWINGS[kind](box, level)]
    }),
  )

export const allCoverShapes = (level: Level): ReadonlyArray<Canvas.Shape> =>
  Array.flatMap(Record.toEntries(COVER_SYMBOLS), ([symbol, kind]) =>
    coverShapes(level, symbol, kind),
  )
