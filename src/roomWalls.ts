import { Array, Option, Record, Result, pipe } from 'effect'
import type { Canvas } from 'foldkit'

import {
  DOOR_SYMBOLS,
  type Exit,
  type Level,
  WALL_SYMBOL,
  closedExits,
  isInsideRoom,
  isWalkableTile,
  symbolAt,
  tilesWithSymbol,
} from './arena'
import { TILE_SIZE } from './constants'
import { pixelArt, rect } from './drawing'
import { backDoorShapes, windowShapes } from './kitchenView'
import type { DoorId } from './model'
import {
  BASEBOARD_COLOR,
  BASEBOARD_Y,
  BONE_COLOR,
  BROKEN_LEAF_COLOR,
  BROKEN_LEAF_DARK_COLOR,
  type Box,
  CANDLE_COLOR,
  CASING_COLOR,
  CASING_DARK_COLOR,
  CASING_LIGHT_COLOR,
  CHAIR_RAIL_COLOR,
  CHAIR_RAIL_Y,
  DOOR_DARK_COLOR,
  DOOR_DIM_COLOR,
  EXIT_BOARD_COLOR,
  EXIT_BOARD_EDGE_COLOR,
  EXIT_GAP_COLOR,
  FACE_TOP,
  FLAME_COLOR,
  FLAME_TIP_COLOR,
  GOLD_COLOR,
  GOLD_DARK_COLOR,
  INK_COLOR,
  MOLDING_SHADOW_COLOR,
  NAIL_COLOR,
  PLANK_COLOR,
  PLANK_DARK_COLOR,
  PLANK_LIGHT_COLOR,
  SIDE_SHADOW_COLOR,
  SPLINTER_COLOR,
  WAINSCOT_COLOR,
  WAINSCOT_LIGHT_COLOR,
  WAINSCOT_PANEL_COLOR,
  WALLPAPER_COLOR,
  WALLPAPER_FLEUR_COLOR,
  WALLPAPER_STRIPE_COLOR,
  WALL_CAP_EDGE_COLOR,
  WALL_COLOR,
  WALL_EDGE_COLOR,
  WALL_EDGE_PX,
  WALL_SHADOW_COLOR,
  WALL_TRIM_COLOR,
  ZOMBIE_SKIN_COLOR,
  boundingBox,
  boxOfKind,
  roll,
} from './roomPalette'
import { type Palette, pixelRuns } from './sprite'

// WALLS

// NOTE: a closed exit is wall with a boarded door in it, so the wall runs
// on across it.
const closedExitSymbols = (level: Level): ReadonlyArray<string> =>
  Array.map(closedExits(level), ({ symbol }) => symbol)

const isWall = (level: Level, column: number, row: number): boolean =>
  Option.exists(
    symbolAt(level, column, row),
    symbol =>
      symbol === WALL_SYMBOL ||
      Array.contains(closedExitSymbols(level), symbol),
  )

const MARK = 'M'
const BLANK = '.'

// NOTE: the grid's lines are the map's lines, so a run's y counts from the
// map's first row. runTop turns it back into a world y.
const markedGrid = (
  level: Level,
  isMarked: (column: number, row: number) => boolean,
): ReadonlyArray<string> =>
  Array.map(level.tiles, (line, index) =>
    pipe(
      Array.makeBy(line.length, column =>
        isMarked(column, index + level.topRow) ? MARK : BLANK,
      ),
      Array.join(''),
    ),
  )

const runTop = (level: Level, runY: number): number =>
  (runY + level.topRow) * TILE_SIZE

type Inset = Readonly<{
  dx: number
  dy: number
  width: (runWidth: number) => number
  height: (runHeight: number) => number
}>

const runShapes = (
  level: Level,
  grid: ReadonlyArray<string>,
  fill: string,
  inset: Inset,
): ReadonlyArray<Canvas.Shape> =>
  Array.map(pixelRuns(grid, { [MARK]: fill }), run =>
    rect(
      run.x * TILE_SIZE + inset.dx,
      runTop(level, run.y) + inset.dy,
      inset.width(run.width * TILE_SIZE),
      inset.height(run.height * TILE_SIZE),
      fill,
    ),
  )

const FULL_TILE: Inset = {
  dx: 0,
  dy: 0,
  width: width => width,
  height: height => height,
}

const isWallFacing =
  (level: Level, stepColumn: number, stepRow: number) =>
  (column: number, row: number): boolean =>
    isWall(level, column, row) &&
    isWalkableTile(level, column + stepColumn, row + stepRow)

// NOTE: the north wall shows its face, papered and paneled, above any tile
// that is not wall: the floor, the doorways, and the furniture against it.
const isNorthFace =
  (level: Level) =>
  (column: number, row: number): boolean =>
    isWall(level, column, row) &&
    isInsideRoom(level, column, row + 1) &&
    !isWall(level, column, row + 1) &&
    !Option.exists(symbolAt(level, column, row + 1), symbol =>
      Array.contains(Record.values(DOOR_SYMBOLS), symbol),
    )

type Span = Readonly<{ x: number; y: number; width: number }>

const northFaceSpans = (level: Level): ReadonlyArray<Span> =>
  Array.map(
    pixelRuns(markedGrid(level, isNorthFace(level)), {
      [MARK]: WALLPAPER_COLOR,
    }),
    run => ({
      x: run.x * TILE_SIZE,
      y: runTop(level, run.y + 1),
      width: run.width * TILE_SIZE,
    }),
  )

const WAINSCOT_PANEL_PX = 12

const faceShapes = ({ x, y, width }: Span): ReadonlyArray<Canvas.Shape> => {
  const top = y - TILE_SIZE * 2 + FACE_TOP
  const railY = y - TILE_SIZE * 2 + CHAIR_RAIL_Y
  const baseY = y - TILE_SIZE * 2 + BASEBOARD_Y
  const columns = Array.makeBy(width, index => x + index)
  return [
    rect(x, top, width, y - top, WALLPAPER_COLOR),
    ...Array.filterMap(columns, column =>
      column % 6 === 0
        ? Result.succeed(
            rect(column, top + 2, 1, railY - top - 2, WALLPAPER_STRIPE_COLOR),
          )
        : Result.failVoid,
    ),
    ...Array.flatMap(columns, column =>
      column % 6 === 3
        ? [
            rect(column, top + 3, 1, 1, WALLPAPER_FLEUR_COLOR),
            rect(column - 1, top + 4, 3, 1, WALLPAPER_FLEUR_COLOR),
            rect(column, top + 5, 1, 1, WALLPAPER_FLEUR_COLOR),
            rect(column, top + 8, 1, 1, WALLPAPER_FLEUR_COLOR),
          ]
        : [],
    ),
    rect(x, top, width, 1, WALL_TRIM_COLOR),
    rect(x, top + 1, width, 1, MOLDING_SHADOW_COLOR),
    rect(x, railY, width, y - railY, WAINSCOT_COLOR),
    ...Array.flatMap(
      Array.makeBy(Math.floor(width / WAINSCOT_PANEL_PX), index => index),
      index => [
        rect(
          x + 2 + index * WAINSCOT_PANEL_PX,
          railY + 2,
          WAINSCOT_PANEL_PX - 4,
          3,
          WAINSCOT_PANEL_COLOR,
        ),
        rect(
          x + 2 + index * WAINSCOT_PANEL_PX,
          railY + 2,
          WAINSCOT_PANEL_PX - 4,
          1,
          WAINSCOT_LIGHT_COLOR,
        ),
      ],
    ),
    rect(x, railY, width, 1, CHAIR_RAIL_COLOR),
    rect(x, baseY, width, y - baseY, BASEBOARD_COLOR),
  ]
}

export const wallShapes = (level: Level): ReadonlyArray<Canvas.Shape> => {
  const spans = northFaceSpans(level)
  return [
    ...runShapes(
      level,
      markedGrid(level, (column, row) => isWall(level, column, row)),
      WALL_COLOR,
      FULL_TILE,
    ),
    ...Array.flatMap(spans, faceShapes),
    ...Array.map(spans, ({ x, y, width }) =>
      rect(x, y - TILE_SIZE * 2 + FACE_TOP - 1, width, 1, WALL_CAP_EDGE_COLOR),
    ),
    ...runShapes(
      level,
      markedGrid(level, isWallFacing(level, 1, 0)),
      WALL_EDGE_COLOR,
      {
        dx: TILE_SIZE - WALL_EDGE_PX,
        dy: 0,
        width: () => WALL_EDGE_PX,
        height: height => height,
      },
    ),
    ...runShapes(
      level,
      markedGrid(level, isWallFacing(level, -1, 0)),
      WALL_EDGE_COLOR,
      {
        dx: 0,
        dy: 0,
        width: () => WALL_EDGE_PX,
        height: height => height,
      },
    ),
    ...runShapes(
      level,
      markedGrid(level, isWallFacing(level, 0, -1)),
      WALL_TRIM_COLOR,
      {
        dx: 0,
        dy: 0,
        width: width => width,
        height: () => WALL_EDGE_PX,
      },
    ),
  ]
}

export const wallShadowShapes = (level: Level): ReadonlyArray<Canvas.Shape> => [
  ...Array.map(northFaceSpans(level), ({ x, y, width }) =>
    rect(x, y, width, 2, WALL_SHADOW_COLOR),
  ),
  ...runShapes(
    level,
    markedGrid(level, isWallFacing(level, 1, 0)),
    SIDE_SHADOW_COLOR,
    {
      dx: TILE_SIZE,
      dy: 0,
      width: () => 2,
      height: height => height,
    },
  ),
  ...runShapes(
    level,
    markedGrid(level, isWallFacing(level, -1, 0)),
    SIDE_SHADOW_COLOR,
    {
      dx: -2,
      dy: 0,
      width: () => 2,
      height: height => height,
    },
  ),
]

// WALL DECOR

const sconce = (x: number): ReadonlyArray<Canvas.Shape> => [
  rect(x - 4, 4, 10, 11, 'rgba(255, 200, 90, 0.08)'),
  rect(x - 2, 5, 6, 8, 'rgba(255, 200, 90, 0.1)'),
  rect(x, 6, 2, 2, FLAME_COLOR),
  rect(x, 5, 1, 1, FLAME_TIP_COLOR),
  rect(x, 8, 2, 3, CANDLE_COLOR),
  rect(x + 1, 11, 1, 1, CANDLE_COLOR),
  rect(x - 1, 11, 4, 1, GOLD_COLOR),
  rect(x, 12, 2, 2, GOLD_DARK_COLOR),
]

const PORTRAIT_PIXELS: ReadonlyArray<string> = [
  'FFFFFFFFFFFFFF',
  'FffffffffffffF',
  'Ff..hhhhhh..fF',
  'Ff.hhhhhhhh.fF',
  'Ff.hSSSSSSh.fF',
  'Ff.hSwSSwSh.fF',
  'Ff..SkSSkS..fF',
  'Ff..SSmmSS..fF',
  'Ff...SSSS...fF',
  'Ff.ddddddddd.F',
  'FffffffffffffF',
  'FFFFFFFFFFFFFF',
]

const PORTRAIT_PALETTE: Palette = {
  F: GOLD_COLOR,
  f: GOLD_DARK_COLOR,
  '.': '#24302a',
  h: '#6a4a7a',
  S: ZOMBIE_SKIN_COLOR,
  w: '#f4f1de',
  k: '#c8343c',
  m: '#4a1010',
  d: '#4a2a6a',
}

const SKULL_OVAL_PIXELS: ReadonlyArray<string> = [
  '..FFFF..',
  '.FddddF.',
  'FdbbbbdF',
  'FbkbbkbF',
  'FbbbbbbF',
  'Fdb.bbdF',
  '.FdbbdF.',
  '..FFFF..',
]

const SKULL_OVAL_PALETTE: Palette = {
  F: GOLD_COLOR,
  d: '#1c1622',
  b: BONE_COLOR,
  k: INK_COLOR,
  '.': '#1c1622',
}

const BOARDED_WINDOW: ReadonlyArray<Canvas.Shape> = [
  rect(236, 5, 17, 13, CASING_COLOR),
  rect(238, 7, 13, 9, '#1c2a44'),
  rect(239, 8, 3, 1, '#5a7ab0'),
  rect(247, 12, 2, 3, '#2a3c5c'),
  rect(244, 7, 1, 9, CASING_DARK_COLOR),
  rect(238, 11, 13, 1, CASING_DARK_COLOR),
  rect(235, 17, 19, 2, CASING_LIGHT_COLOR),
  rect(234, 8, 21, 3, PLANK_COLOR),
  rect(234, 8, 21, 1, PLANK_LIGHT_COLOR),
  rect(234, 13, 21, 3, PLANK_COLOR),
  rect(234, 15, 21, 1, PLANK_DARK_COLOR),
  rect(235, 9, 1, 1, NAIL_COLOR),
  rect(253, 9, 1, 1, NAIL_COLOR),
  rect(235, 14, 1, 1, NAIL_COLOR),
  rect(253, 14, 1, 1, NAIL_COLOR),
  // NOTE: green fingers curl over the top board from outside.
  rect(240, 7, 1, 2, ZOMBIE_SKIN_COLOR),
  rect(242, 7, 1, 2, ZOMBIE_SKIN_COLOR),
  rect(244, 7, 1, 2, ZOMBIE_SKIN_COLOR),
  rect(240, 7, 1, 1, '#5a8a3a'),
]

const KITCHEN_SIGN_PIXELS: ReadonlyArray<string> = [
  'bbbbbbbbbbbb',
  'bccccccccccb',
  'bcmcmcmcckcb',
  'bcmcmcmcckkb',
  'bcmmmmmcckkb',
  'bcccmccccckb',
  'bcccmccccchb',
  'bcccmccccchb',
  'bccccccccccb',
  'bbbbbbbbbbbb',
]

const KITCHEN_SIGN_PALETTE: Palette = {
  b: PLANK_DARK_COLOR,
  c: '#e8dcc0',
  m: '#6a6a78',
  k: '#9a9aaa',
  h: '#5a3a22',
}

const kitchenExitShapes = (exit: Box): ReadonlyArray<Canvas.Shape> => {
  const x = exit.x
  const right = exit.x + exit.width
  const middle = x + exit.width / 2
  const top = FACE_TOP + 2
  const bottom = exit.y + exit.height
  const diagonal = Array.makeBy(10, index =>
    rect(x + 1 + index * 2, bottom - 4 - index, 2, 3, PLANK_COLOR),
  )
  return [
    rect(x - 2, top - 1, exit.width + 4, bottom - top + 1, CASING_COLOR),
    rect(x - 2, top - 1, exit.width + 4, 1, CASING_LIGHT_COLOR),
    rect(x + 1, top + 1, exit.width - 2, bottom - top - 1, '#3a281c'),
    rect(middle, top + 1, 1, bottom - top - 1, EXIT_GAP_COLOR),
    rect(x + 3, top + 3, 5, 4, '#33231a'),
    rect(middle + 3, top + 3, 5, 4, '#33231a'),
    rect(x + 3, top + 9, 5, 4, '#33231a'),
    rect(middle + 3, top + 9, 5, 4, '#33231a'),
    rect(middle - 2, top + 7, 1, 2, GOLD_COLOR),
    rect(middle + 2, top + 7, 1, 2, GOLD_COLOR),
    rect(x - 3, top + 2, exit.width + 6, 3, PLANK_COLOR),
    rect(x - 3, top + 2, exit.width + 6, 1, PLANK_LIGHT_COLOR),
    ...diagonal,
    rect(x - 3, bottom - 6, exit.width + 6, 3, PLANK_COLOR),
    rect(x - 3, bottom - 4, exit.width + 6, 1, PLANK_DARK_COLOR),
    rect(x - 2, top + 3, 1, 1, NAIL_COLOR),
    rect(right + 1, top + 3, 1, 1, NAIL_COLOR),
    rect(x - 2, bottom - 5, 1, 1, NAIL_COLOR),
    rect(right + 1, bottom - 5, 1, 1, NAIL_COLOR),
    // NOTE: a sign with a fork and a knife says what is through here.
    ...pixelArt(middle - 6, top + 3, KITCHEN_SIGN_PIXELS, KITCHEN_SIGN_PALETTE),
    // NOTE: warm light leaks under the boards.
    rect(x + 1, bottom, exit.width - 2, 1, 'rgba(255, 200, 120, 0.18)'),
  ]
}

// EXITS

const EXIT_BOARD_PX = 3
const EXIT_BOARD_STEP_PX = 5

// NOTE: a closed exit is a doorway nailed shut: the dark gap with boards
// across it the long way. An open exit draws nothing, so the floor shows.
const boardedShapes = (box: Box): ReadonlyArray<Canvas.Shape> => {
  const isAcross = box.width >= box.height
  const span = isAcross ? box.height : box.width
  const boards = Math.max(1, Math.floor(span / EXIT_BOARD_STEP_PX))
  return [
    rect(box.x, box.y, box.width, box.height, EXIT_GAP_COLOR),
    ...Array.flatMap(
      Array.makeBy(boards, index => index),
      index => {
        const offset = 1 + index * EXIT_BOARD_STEP_PX
        return isAcross
          ? [
              rect(
                box.x,
                box.y + offset,
                box.width,
                EXIT_BOARD_PX,
                EXIT_BOARD_COLOR,
              ),
              rect(
                box.x,
                box.y + offset + EXIT_BOARD_PX - 1,
                box.width,
                1,
                EXIT_BOARD_EDGE_COLOR,
              ),
            ]
          : [
              rect(
                box.x + offset,
                box.y,
                EXIT_BOARD_PX,
                box.height,
                EXIT_BOARD_COLOR,
              ),
              rect(
                box.x + offset + EXIT_BOARD_PX - 1,
                box.y,
                1,
                box.height,
                EXIT_BOARD_EDGE_COLOR,
              ),
            ]
      },
    ),
  ]
}

// NOTE: an exit in the top wall shows its face, so it gets a boarded double
// door with a sign. One anywhere else is the plain boarded gap.
const exitShapes = (exit: Exit): ReadonlyArray<Canvas.Shape> => {
  if (!Array.isReadonlyArrayNonEmpty(exit.tiles)) {
    return []
  }
  const box = boundingBox(exit.tiles)
  return box.y === 0 && box.height === TILE_SIZE * 2
    ? kitchenExitShapes(box)
    : boardedShapes(box)
}

export const closedExitShapes = (level: Level): ReadonlyArray<Canvas.Shape> =>
  Array.flatMap(closedExits(level), exitShapes)

// NOTE: the portrait, the skull, and the window are placed by hand on the
// parlour's north wall, in the gaps between its doors and furniture.
export const PARLOUR_WALL_DECOR: ReadonlyArray<Canvas.Shape> = [
  ...pixelArt(86, 5, PORTRAIT_PIXELS, PORTRAIT_PALETTE),
  ...pixelArt(47, 6, SKULL_OVAL_PIXELS, SKULL_OVAL_PALETTE),
  ...BOARDED_WINDOW,
]

export const sconceShapes = (level: Level): ReadonlyArray<Canvas.Shape> =>
  Option.match(boxOfKind(level, 'Hearth'), {
    onNone: () => [],
    onSome: hearth => [
      ...sconce(hearth.x - 18),
      ...sconce(hearth.x + hearth.width + 16),
    ],
  })

// DOORS

export const doorBox = (level: Level, id: DoorId): Box =>
  boundingBox(tilesWithSymbol(level, DOOR_SYMBOLS[id]))

const splinters = (
  x: number,
  y: number,
  spreadX: number,
  spreadY: number,
  seed: number,
): ReadonlyArray<Canvas.Shape> =>
  Array.makeBy(7, index => {
    const isLong = roll(seed, index) < 0.5
    return rect(
      x + Math.floor(roll(seed, index + 20) * spreadX),
      y + Math.floor(roll(seed, index + 40) * spreadY),
      isLong ? 2 : 1,
      isLong ? 1 : 2,
      index % 3 === 0 ? CASING_COLOR : SPLINTER_COLOR,
    )
  })

const northDoorShapes = ({ x, width }: Box): ReadonlyArray<Canvas.Shape> => {
  const right = x + width
  return [
    rect(x, 0, width, TILE_SIZE * 2, DOOR_DARK_COLOR),
    rect(x, 15, width, 5, DOOR_DIM_COLOR),
    rect(x - 3, FACE_TOP, 3, TILE_SIZE * 2 - FACE_TOP, CASING_COLOR),
    rect(
      x - 1,
      FACE_TOP + 2,
      1,
      TILE_SIZE * 2 - FACE_TOP - 2,
      CASING_LIGHT_COLOR,
    ),
    rect(right, FACE_TOP, 3, TILE_SIZE * 2 - FACE_TOP, CASING_COLOR),
    rect(
      right,
      FACE_TOP + 2,
      1,
      TILE_SIZE * 2 - FACE_TOP - 2,
      CASING_DARK_COLOR,
    ),
    rect(x - 4, FACE_TOP - 1, width + 8, 3, CASING_COLOR),
    rect(x - 4, FACE_TOP - 1, width + 8, 1, CASING_LIGHT_COLOR),
    rect(x + 6, FACE_TOP, 1, 2, CASING_DARK_COLOR),
    rect(x + 7, FACE_TOP + 1, 2, 1, CASING_DARK_COLOR),
    // NOTE: what is left of the door hangs off its top hinge.
    rect(x, 5, 6, 11, BROKEN_LEAF_COLOR),
    rect(x + 6, 6, 2, 7, BROKEN_LEAF_COLOR),
    rect(x + 8, 7, 1, 3, BROKEN_LEAF_COLOR),
    rect(x + 2, 5, 1, 10, BROKEN_LEAF_DARK_COLOR),
    rect(x + 5, 6, 1, 9, BROKEN_LEAF_DARK_COLOR),
    rect(x, 6, 1, 2, NAIL_COLOR),
    rect(right - 3, 8, 3, 6, BROKEN_LEAF_COLOR),
    rect(right - 4, 9, 1, 3, BROKEN_LEAF_COLOR),
    rect(right + 1, 9, 1, 3, CASING_DARK_COLOR),
    rect(right + 1, 13, 1, 2, CASING_DARK_COLOR),
    ...splinters(x - 2, TILE_SIZE * 2 + 1, width + 4, 6, 1),
  ]
}

const sideDoorShapes = (
  { x, y, width, height }: Box,
  facesEast: boolean,
): ReadonlyArray<Canvas.Shape> => {
  const inner = facesEast ? x + width : x
  const fromHinge = (offset: number, size: number): number =>
    facesEast ? x + offset : x + width - offset - size
  return [
    rect(x, y, width, height, DOOR_DARK_COLOR),
    rect(fromHinge(6, 4), y, 4, height, DOOR_DIM_COLOR),
    rect(x, y - 3, width, 3, CASING_COLOR),
    rect(x, y - 1, width, 1, CASING_LIGHT_COLOR),
    rect(x, y + height, width, 3, CASING_COLOR),
    rect(x, y + height, width, 1, CASING_DARK_COLOR),
    // NOTE: splintered stumps of the two leaves still hang on the posts.
    rect(fromHinge(3, 2), y, 2, 6, BROKEN_LEAF_COLOR),
    rect(fromHinge(5, 2), y, 2, 4, BROKEN_LEAF_COLOR),
    rect(fromHinge(7, 1), y, 1, 2, BROKEN_LEAF_COLOR),
    rect(fromHinge(3, 2), y + height - 6, 2, 6, BROKEN_LEAF_COLOR),
    rect(fromHinge(5, 2), y + height - 4, 2, 4, BROKEN_LEAF_COLOR),
    rect(fromHinge(7, 1), y + height - 2, 1, 2, BROKEN_LEAF_COLOR),
    ...splinters(
      facesEast ? inner + 1 : inner - 9,
      y - 2,
      8,
      height + 4,
      facesEast ? 2 : 3,
    ),
  ]
}

const southDoorShapes = ({ x, y, width }: Box): ReadonlyArray<Canvas.Shape> => {
  const right = x + width
  return [
    rect(x, y, width, TILE_SIZE, DOOR_DARK_COLOR),
    rect(x, y, width, 3, DOOR_DIM_COLOR),
    rect(x - 3, y, 3, TILE_SIZE, CASING_COLOR),
    rect(x - 1, y, 1, TILE_SIZE, CASING_LIGHT_COLOR),
    rect(right, y, 3, TILE_SIZE, CASING_COLOR),
    rect(right, y, 1, TILE_SIZE, CASING_DARK_COLOR),
    rect(x, y + 3, 6, 2, BROKEN_LEAF_COLOR),
    rect(x, y + 5, 4, 2, BROKEN_LEAF_COLOR),
    rect(right - 5, y + 3, 5, 2, BROKEN_LEAF_COLOR),
    rect(right - 3, y + 5, 3, 2, BROKEN_LEAF_COLOR),
    ...splinters(x - 2, y - 7, width + 4, 6, 4),
  ]
}

const DOOR_DRAWINGS: Readonly<
  Record<DoorId, (box: Box) => ReadonlyArray<Canvas.Shape>>
> = {
  North: northDoorShapes,
  West: box => sideDoorShapes(box, true),
  East: box => sideDoorShapes(box, false),
  South: southDoorShapes,
  Back: backDoorShapes,
  Window: windowShapes,
}

export const doorwayShapes = (level: Level): ReadonlyArray<Canvas.Shape> =>
  Array.flatMap(level.doorIds, id => DOOR_DRAWINGS[id](doorBox(level, id)))
