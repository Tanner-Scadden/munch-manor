import {
  Array,
  Function,
  Option,
  type Record,
  Result,
  String,
  pipe,
} from 'effect'

import { TILE_SIZE } from '../../shared/constants'
import type { DoorId, Vector } from '../schema/entitySchema'
import { clamp } from '../step/geometry'
import { SLOT_DOOR_SYMBOLS } from './plan'

// SYMBOLS

export type CoverKind =
  | 'Piano'
  | 'Hearth'
  | 'Bookshelf'
  | 'Armchair'
  | 'Couch'
  | 'TeaTable'
  | 'Fern'
  | 'Coffin'
  | 'Trunk'
  | 'Crate'
  | 'Oven'
  | 'PrepTable'
  | 'Sink'
  | 'Pantry'
  | 'Sacks'
  | 'Fridge'
  | 'PartyTable'
  | 'Hutch'
  | 'Candelabra'
  | 'BookStack'
  | 'Desk'
  | 'Globe'
  | 'WineRack'
  | 'Barrels'

export const WALL_SYMBOL = '#'
// NOTE: Rattles' spot in the start room (docs/ESCAPE_PLAN.md, layer 7): his
// stall went with the shop, and he sits on an old trunk by the front door,
// solid, and hollers his hints from it.
export const RATTLES_SYMBOL = '$'
export const OUTSIDE_SYMBOL = ','
export const SOUP_SYMBOL = '~'

export const COVER_SYMBOLS: Readonly<Record<string, CoverKind>> = {
  P: 'Piano',
  F: 'Hearth',
  B: 'Bookshelf',
  A: 'Armchair',
  C: 'Couch',
  T: 'TeaTable',
  V: 'Fern',
  O: 'Coffin',
  U: 'Trunk',
  X: 'Crate',
  G: 'Oven',
  L: 'PrepTable',
  I: 'Sink',
  Q: 'Pantry',
  R: 'Sacks',
  Z: 'Fridge',
  '=': 'PartyTable',
  H: 'Hutch',
  i: 'Candelabra',
  b: 'BookStack',
  d: 'Desk',
  g: 'Globe',
  ']': 'WineRack',
  o: 'Barrels',
}

export const DOOR_SYMBOLS: Readonly<Record<DoorId, string>> = {
  North: 'N',
  West: 'W',
  East: 'E',
  South: 'S',
  Back: 'D',
  Window: 'Y',
  ...SLOT_DOOR_SYMBOLS,
  Front: 'M',
}

export const DOOR_OUTWARD: Readonly<Record<DoorId, Vector>> = {
  North: { x: 0, y: -1 },
  West: { x: -1, y: 0 },
  East: { x: 1, y: 0 },
  South: { x: 0, y: 1 },
  Back: { x: 0, y: -1 },
  Window: { x: -1, y: 0 },
  WestTop: { x: 0, y: -1 },
  WestBottom: { x: 0, y: 1 },
  EastTop: { x: 0, y: -1 },
  EastBottom: { x: 0, y: 1 },
  FarTop: { x: 0, y: -1 },
  FarBottom: { x: 0, y: 1 },
  Front: { x: 0, y: 1 },
}

// NOTE: every door zombies may come through. A level's own spawn doors are
// its `doorIds`, the ones on its map that no closed exit still holds shut.
// The start room's four come first, so a level with every exit shut lists
// them in the same order it always did. The slots' two each (`n` and `s` on
// a slot room's map) come last, west, east, then far. The front door is not here: it is the way
// out of the house, and no zombie ever spawns at it.
export const DOOR_IDS: ReadonlyArray<DoorId> = [
  'North',
  'West',
  'East',
  'South',
  'Back',
  'Window',
  'WestTop',
  'WestBottom',
  'EastTop',
  'EastBottom',
  'FarTop',
  'FarBottom',
]

export const byDoor = <A>(
  make: (id: DoorId) => A,
): Readonly<Record<DoorId, A>> => ({
  North: make('North'),
  West: make('West'),
  East: make('East'),
  South: make('South'),
  Back: make('Back'),
  Window: make('Window'),
  WestTop: make('WestTop'),
  WestBottom: make('WestBottom'),
  EastTop: make('EastTop'),
  EastBottom: make('EastBottom'),
  FarTop: make('FarTop'),
  FarBottom: make('FarBottom'),
  Front: make('Front'),
})

// GRID

export type Tile = Readonly<{ column: number; row: number }>

// NOTE: tile columns and rows are world columns and rows. A level's map is
// the block of the plan its rooms cover, so a room above the parlour, like
// the manor's kitchen, gives it a negative topRow, and one west of it a
// negative leftColumn. The parlour keeps the same world coordinates in every
// level it is part of.
export type Grid = Readonly<{
  tiles: ReadonlyArray<string>
  columns: number
  rows: number
  topRow: number
  leftColumn: number
}>

export const symbolAt: {
  (column: number, row: number): (grid: Grid) => Option.Option<string>
  (grid: Grid, column: number, row: number): Option.Option<string>
} = Function.dual(
  3,
  (grid: Grid, column: number, row: number): Option.Option<string> =>
    column < grid.leftColumn
      ? Option.none()
      : pipe(
          grid.tiles,
          Array.get(row - grid.topRow),
          Option.flatMap(line => String.at(line, column - grid.leftColumn)),
        ),
)

export const tileIndex: {
  (column: number, row: number): (grid: Grid) => number
  (grid: Grid, column: number, row: number): number
} = Function.dual(
  3,
  (grid: Grid, column: number, row: number): number =>
    (row - grid.topRow) * grid.columns + column - grid.leftColumn,
)

export const tileOfIndex: {
  (index: number): (grid: Grid) => Tile
  (grid: Grid, index: number): Tile
} = Function.dual(2, (grid: Grid, index: number): Tile => ({
  column: (index % grid.columns) + grid.leftColumn,
  row: Math.floor(index / grid.columns) + grid.topRow,
}))

export const isInsideRoom: {
  (column: number, row: number): (grid: Grid) => boolean
  (grid: Grid, column: number, row: number): boolean
} = Function.dual(
  3,
  (grid: Grid, column: number, row: number): boolean =>
    column >= grid.leftColumn &&
    column < grid.leftColumn + grid.columns &&
    row >= grid.topRow &&
    row < grid.topRow + grid.rows,
)

export const tilesWithSymbol: {
  (symbol: string): (grid: Grid) => ReadonlyArray<Tile>
  (grid: Grid, symbol: string): ReadonlyArray<Tile>
} = Function.dual(2, (grid: Grid, symbol: string): ReadonlyArray<Tile> =>
  Array.flatMap(grid.tiles, (line, index) =>
    Array.filterMap(String.split(line, ''), (lineSymbol, column) =>
      lineSymbol === symbol
        ? Result.succeed({
            column: column + grid.leftColumn,
            row: index + grid.topRow,
          })
        : Result.failVoid,
    ),
  ),
)

export const tileCenter = ({ column, row }: Tile): Vector => ({
  x: column * TILE_SIZE + TILE_SIZE / 2,
  y: row * TILE_SIZE + TILE_SIZE / 2,
})

export type Box = Readonly<{
  left: number
  top: number
  right: number
  bottom: number
}>

export const tileBox = ({ column, row }: Tile): Box => ({
  left: column * TILE_SIZE,
  top: row * TILE_SIZE,
  right: (column + 1) * TILE_SIZE,
  bottom: (row + 1) * TILE_SIZE,
})

export const boxCenter = ({ left, top, right, bottom }: Box): Vector => ({
  x: (left + right) / 2,
  y: (top + bottom) / 2,
})

export const distanceToBox: {
  (box: Box): (position: Vector) => number
  (position: Vector, box: Box): number
} = Function.dual(2, (position: Vector, box: Box): number =>
  Math.hypot(
    position.x - clamp(position.x, box.left, box.right),
    position.y - clamp(position.y, box.top, box.bottom),
  ),
)

export const circleTouchesBox: {
  (radius: number, box: Box): (position: Vector) => boolean
  (position: Vector, radius: number, box: Box): boolean
} = Function.dual(
  3,
  (position: Vector, radius: number, box: Box): boolean =>
    distanceToBox(position, box) < radius,
)
