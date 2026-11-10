import { Array, Function, Option, Record, Result, String, pipe } from 'effect'

import {
  BULLET_STEP_PX,
  LINE_OF_SIGHT_STEP_PX,
  TILE_SIZE,
  ZOMBIE_SPAWN_MARGIN,
} from '../../shared/constants'
import type {
  Arrangement,
  DoorId,
  ExitId,
  LevelState,
  Vector,
} from '../schema/entitySchema'
import { addVectors, clamp, scaleVector } from '../step/geometry'
import {
  DEFAULT_ARRANGEMENT,
  type ExitOpener,
  type LevelSpec,
  MANOR_SPEC,
  PARLOUR_SPEC,
  type RoomSpec,
  SLOT_DOOR_SYMBOLS,
  middleOf,
  specOfState,
  widthOf,
} from './plan'

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
// stall went with the shop, and he sits on an old trunk there, solid, and
// hollers his hints from it.
export const RATTLES_SYMBOL = '$'
const OUTSIDE_SYMBOL = ','
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
type Grid = Readonly<{
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

const indicesWhere = (
  grid: Grid,
  isMarked: (column: number, row: number) => boolean,
): ReadonlySet<number> =>
  new Set(
    Array.filter(
      Array.makeBy(grid.columns * grid.rows, index => index),
      index => {
        const { column, row } = tileOfIndex(grid, index)
        return isMarked(column, row)
      },
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

const boundingBox = (tiles: ReadonlyArray<Tile>): Box =>
  Array.reduce(
    Array.map(tiles, tileBox),
    {
      left: Infinity,
      top: Infinity,
      right: -Infinity,
      bottom: -Infinity,
    },
    (bounds, box) => ({
      left: Math.min(bounds.left, box.left),
      top: Math.min(bounds.top, box.top),
      right: Math.max(bounds.right, box.right),
      bottom: Math.max(bounds.bottom, box.bottom),
    }),
  )

const unionOf = (boxes: ReadonlyArray<Box>, fallback: Box): Box =>
  Array.match(boxes, {
    onEmpty: () => fallback,
    onNonEmpty: nonEmpty =>
      Array.reduce(nonEmpty, Array.headNonEmpty(nonEmpty), (bounds, box) => ({
        left: Math.min(bounds.left, box.left),
        top: Math.min(bounds.top, box.top),
        right: Math.max(bounds.right, box.right),
        bottom: Math.max(bounds.bottom, box.bottom),
      })),
  })

const faceCoordinate = (
  outward: number,
  low: number,
  high: number,
  center: number,
): number => {
  if (outward < 0) {
    return low
  } else if (outward > 0) {
    return high
  } else {
    return center
  }
}

const outerFaceOf = (box: Box, center: Vector, outward: Vector): Vector => ({
  x: faceCoordinate(outward.x, box.left, box.right, center.x),
  y: faceCoordinate(outward.y, box.top, box.bottom, center.y),
})

const averagePoint = (points: ReadonlyArray<Vector>): Vector =>
  scaleVector(
    Array.reduce(points, { x: 0, y: 0 }, addVectors),
    1 / Math.max(1, points.length),
  )

// LEVEL

// NOTE: edge is the middle of the door's outer face, where a zombie due at
// the door stands before it walks in.
export type Door = Readonly<{
  id: DoorId
  center: Vector
  outward: Vector
  edge: Vector
}>

type Threshold = Readonly<{
  tiles: ReadonlyArray<Tile>
  indices: ReadonlyArray<number>
  box: Box
}>

export type Exit = Readonly<{
  id: ExitId
  symbol: string
  doors: ReadonlyArray<DoorId>
  opener: ExitOpener
  requires: ReadonlyArray<ExitId>
  tiles: ReadonlyArray<Tile>
  isOpen: boolean
}>

export type Room = Readonly<{ id: string; box: Box; isOpen: boolean }>

// NOTE: a level is built once for each set of open exits and kept, so every
// lookup a frame makes is a plain read. `key` names the spec and its open
// exits, and the flow field and the floor canvases rebuild when it changes.
// left and top are the world x and y of the map's first column and row,
// below 0 when a room sits west of or above the parlour. bounds is the part the camera and the player may
// reach: the rooms whose exits are open. outsideTiles are the yard, walkable
// for zombies on their way to a door and solid for the player, who also
// treats every solid tile as solid (playerSolidTiles).
export type Level = Readonly<{
  key: string
  spec: LevelSpec
  tiles: ReadonlyArray<string>
  columns: number
  rows: number
  topRow: number
  leftColumn: number
  top: number
  left: number
  width: number
  height: number
  bottom: number
  tileCount: number
  openExits: ReadonlyArray<ExitId>
  dropped: ReadonlyArray<string>
  exits: ReadonlyArray<Exit>
  rooms: ReadonlyArray<Room>
  bounds: Box
  doorIds: ReadonlyArray<DoorId>
  doors: Readonly<Record<DoorId, Door>>
  thresholds: Readonly<Record<DoorId, Threshold>>
  doorTileIndices: Readonly<Record<DoorId, ReadonlyArray<number>>>
  tileFlags: Uint8Array
  hasSoup: boolean
  start: Vector
}>

// NOTE: what a tile is, as bits of one byte per tile in `Level.tileFlags`,
// indexed by `tileIndex`. Built once with the level, so every tile query in
// a frame is one array read.
export const TILE_SOLID = 1
export const TILE_PLAYER_SOLID = 2
export const TILE_OUTSIDE = 4
export const TILE_OPEN_BLOCK = 8
const TILE_SOUP = 16
export const TILE_DOOR = 32

export const hasTileFlag: {
  (index: number, flag: number): (level: Level) => boolean
  (level: Level, index: number, flag: number): boolean
} = Function.dual(
  3,
  (level: Level, index: number, flag: number): boolean =>
    ((level.tileFlags[index] ?? 0) & flag) !== 0,
)

const packTileFlags = (
  tileCount: number,
  marked: ReadonlyArray<readonly [ReadonlySet<number>, number]>,
): Uint8Array => {
  const flags = new Uint8Array(tileCount)
  for (const [indices, flag] of marked) {
    for (const index of indices) {
      flags[index] = (flags[index] ?? 0) | flag
    }
  }
  return flags
}

const openExitIdsOf = (
  spec: LevelSpec,
  openExits: ReadonlyArray<ExitId>,
): ReadonlyArray<ExitId> =>
  Array.filterMap(spec.exits, ({ id }) =>
    Array.contains(openExits, id) ? Result.succeed(id) : Result.failVoid,
  )

const droppedIdsOf = (
  spec: LevelSpec,
  dropped: ReadonlyArray<string>,
): ReadonlyArray<string> =>
  Array.filterMap(spec.drops, ({ id }) =>
    Array.contains(dropped, id) ? Result.succeed(id) : Result.failVoid,
  )

const keyOf = (
  spec: LevelSpec,
  openExits: ReadonlyArray<ExitId>,
  dropped: ReadonlyArray<string>,
): string =>
  `${spec.id}:${Array.join(openExits, '+')}:${Array.join(dropped, '+')}`

// NOTE: the room covering a tile of the plan, the last listed when two
// overlap, and its symbol there.
const roomSymbolAt = (
  rooms: ReadonlyArray<RoomSpec>,
  column: number,
  row: number,
): Option.Option<string> =>
  pipe(
    Array.findLast(
      rooms,
      ({ tiles, origin }) =>
        column >= origin.column &&
        column < origin.column + widthOf(tiles) &&
        row >= origin.row &&
        row < origin.row + tiles.length,
    ),
    Option.flatMap(({ tiles, origin, renames }) =>
      pipe(
        Array.get(tiles, row - origin.row),
        Option.flatMap(line => String.at(line, column - origin.column)),
        Option.map(symbol =>
          Option.getOrElse(Record.get(renames, symbol), () => symbol),
        ),
      ),
    ),
  )

// NOTE: the rooms laid on the plan as one map: the block they cover, with
// any gap between them left as ground outside the house.
const gridOf = (rooms: Array.NonEmptyReadonlyArray<RoomSpec>): Grid => {
  const leftColumn = Math.min(
    ...Array.map(rooms, ({ origin }) => origin.column),
  )
  const topRow = Math.min(...Array.map(rooms, ({ origin }) => origin.row))
  const columns =
    Math.max(
      ...Array.map(
        rooms,
        ({ origin, tiles }) => origin.column + widthOf(tiles),
      ),
    ) - leftColumn
  const rows =
    Math.max(
      ...Array.map(rooms, ({ origin, tiles }) => origin.row + tiles.length),
    ) - topRow
  return {
    tiles: Array.makeBy(rows, index =>
      Array.join(
        Array.makeBy(columns, column =>
          Option.getOrElse(
            roomSymbolAt(rooms, column + leftColumn, index + topRow),
            () => OUTSIDE_SYMBOL,
          ),
        ),
        '',
      ),
    ),
    columns,
    rows,
    topRow,
    leftColumn,
  }
}

const builtGrids = new WeakMap<LevelSpec, Grid>()

const gridOfSpec = (spec: LevelSpec): Grid => {
  const cached = builtGrids.get(spec)
  if (cached !== undefined) {
    return cached
  }
  const grid = gridOf(spec.rooms)
  builtGrids.set(spec, grid)
  return grid
}

const roomBoxOf = ({ tiles, origin }: RoomSpec): Box => ({
  left: origin.column * TILE_SIZE,
  top: origin.row * TILE_SIZE,
  right: (origin.column + widthOf(tiles)) * TILE_SIZE,
  bottom: (origin.row + tiles.length) * TILE_SIZE,
})

const buildLevel = (
  spec: LevelSpec,
  requestedExits: ReadonlyArray<ExitId>,
  requestedDrops: ReadonlyArray<string>,
): Level => {
  const grid = gridOfSpec(spec)
  const { columns } = grid
  const openExits = openExitIdsOf(spec, requestedExits)
  const dropped = droppedIdsOf(spec, requestedDrops)
  const exits: ReadonlyArray<Exit> = Array.map(spec.exits, exit => ({
    ...exit,
    tiles: tilesWithSymbol(grid, exit.symbol),
    isOpen: Array.contains(openExits, exit.id),
  }))
  const closed = Array.filter(exits, ({ isOpen }) => !isOpen)
  const heldDoors = Array.flatMap(closed, ({ doors }) => doors)
  const doorIds = Array.filter(
    DOOR_IDS,
    id =>
      !Array.contains(heldDoors, id) &&
      Array.isReadonlyArrayNonEmpty(tilesWithSymbol(grid, DOOR_SYMBOLS[id])),
  )

  const solidSymbols: ReadonlySet<string> = new Set([
    WALL_SYMBOL,
    RATTLES_SYMBOL,
    ...Record.keys(COVER_SYMBOLS),
    ...Array.map(closed, ({ symbol }) => symbol),
    ...Array.map(heldDoors, id => DOOR_SYMBOLS[id]),
    // NOTE: the front door stays locked: nothing walks through it yet.
    DOOR_SYMBOLS.Front,
    // NOTE: a drop lying in its spot is cover, like the furniture.
    ...Array.filterMap(spec.drops, ({ id, symbol }) =>
      Array.contains(dropped, id) ? Result.succeed(symbol) : Result.failVoid,
    ),
  ])
  const rooms = Array.map(spec.rooms, (room): Room => ({
    id: room.id,
    box: roomBoxOf(room),
    isOpen: Option.match(room.maybeExit, {
      onNone: () => true,
      onSome: exit => Array.contains(openExits, exit),
    }),
  }))
  const isInRoom =
    (column: number, row: number) =>
    ({ box }: Room): boolean => {
      const { x, y } = tileCenter({ column, row })
      return x > box.left && x < box.right && y > box.top && y < box.bottom
    }
  // NOTE: a room behind a closed exit is not there yet. Its tiles are open
  // ground outside the house, the way the space past the map's edge is, so a
  // zombie walking around the parlour never bumps into the kitchen's walls.
  const isShutAway = (column: number, row: number): boolean =>
    Array.some(rooms, room => !room.isOpen && isInRoom(column, row)(room)) &&
    !Array.some(rooms, room => room.isOpen && isInRoom(column, row)(room))
  const solidTiles = indicesWhere(
    grid,
    (column, row) =>
      !isShutAway(column, row) &&
      Option.exists(symbolAt(grid, column, row), symbol =>
        solidSymbols.has(symbol),
      ),
  )
  const symbolTiles = (symbol: string): ReadonlySet<number> =>
    indicesWhere(grid, (column, row) =>
      Option.contains(symbolAt(grid, column, row), symbol),
    )
  const outsideTiles = indicesWhere(
    grid,
    (column, row) =>
      isShutAway(column, row) ||
      Option.contains(symbolAt(grid, column, row), OUTSIDE_SYMBOL),
  )
  const soupTiles = symbolTiles(SOUP_SYMBOL)
  const playerSolidTiles: ReadonlySet<number> = new Set([
    ...solidTiles,
    ...outsideTiles,
  ])
  const isWalkable = (column: number, row: number): boolean =>
    isInsideRoom(grid, column, row) &&
    !solidTiles.has(tileIndex(grid, column, row))
  const openBlocks = indicesWhere(
    grid,
    (column, row) =>
      isWalkable(column, row) &&
      isWalkable(column + 1, row) &&
      isWalkable(column, row + 1) &&
      isWalkable(column + 1, row + 1),
  )

  const doorSymbols = Array.map(doorIds, id => DOOR_SYMBOLS[id])
  const doorTiles = indicesWhere(grid, (column, row) =>
    Option.exists(symbolAt(grid, column, row), symbol =>
      Array.contains(doorSymbols, symbol),
    ),
  )

  const doors = byDoor((id): Door => {
    const tiles = tilesWithSymbol(grid, DOOR_SYMBOLS[id])
    const center = averagePoint(Array.map(tiles, tileCenter))
    const outward = DOOR_OUTWARD[id]
    return {
      id,
      center,
      outward,
      edge: Array.isReadonlyArrayNonEmpty(tiles)
        ? outerFaceOf(boundingBox(tiles), center, outward)
        : center,
    }
  })

  const thresholds = byDoor((id): Threshold => {
    const outward = DOOR_OUTWARD[id]
    const tiles = Array.filter(
      tilesWithSymbol(grid, DOOR_SYMBOLS[id]),
      ({ column, row }) => {
        const innerColumn = column - outward.x
        const innerRow = row - outward.y
        return (
          isWalkable(innerColumn, innerRow) &&
          !doorTiles.has(tileIndex(grid, innerColumn, innerRow))
        )
      },
    )
    return {
      tiles,
      indices: Array.map(tiles, ({ column, row }) =>
        tileIndex(grid, column, row),
      ),
      box: boundingBox(tiles),
    }
  })

  const doorTileIndices = byDoor(id =>
    Array.map(tilesWithSymbol(grid, DOOR_SYMBOLS[id]), ({ column, row }) =>
      tileIndex(grid, column, row),
    ),
  )

  const top = grid.topRow * TILE_SIZE
  const left = grid.leftColumn * TILE_SIZE
  const height = grid.rows * TILE_SIZE

  return {
    key: keyOf(spec, openExits, dropped),
    spec,
    tiles: grid.tiles,
    columns,
    rows: grid.rows,
    topRow: grid.topRow,
    leftColumn: grid.leftColumn,
    top,
    left,
    width: columns * TILE_SIZE,
    height,
    bottom: top + height,
    tileCount: columns * grid.rows,
    openExits,
    dropped,
    exits,
    rooms,
    bounds: unionOf(
      Array.map(
        Array.filter(rooms, ({ isOpen }) => isOpen),
        ({ box }) => box,
      ),
      {
        left,
        top,
        right: left + columns * TILE_SIZE,
        bottom: top + height,
      },
    ),
    doorIds,
    doors,
    thresholds,
    doorTileIndices,
    tileFlags: packTileFlags(columns * grid.rows, [
      [solidTiles, TILE_SOLID],
      [outsideTiles, TILE_OUTSIDE],
      [playerSolidTiles, TILE_PLAYER_SOLID],
      [soupTiles, TILE_SOUP],
      [openBlocks, TILE_OPEN_BLOCK],
      [doorTiles, TILE_DOOR],
    ]),
    hasSoup: soupTiles.size > 0,
    start: spec.start,
  }
}

const levelsBySpec = new WeakMap<LevelSpec, Map<string, Level>>()

// NOTE: a level with these exits open and these drops lying in their spots.
export const levelFor: {
  (
    openExits?: ReadonlyArray<ExitId>,
    dropped?: ReadonlyArray<string>,
  ): (spec: LevelSpec) => Level
  (
    spec: LevelSpec,
    openExits?: ReadonlyArray<ExitId>,
    dropped?: ReadonlyArray<string>,
  ): Level
} = Function.dual(
  // NOTE: data-first starts with the spec; data-last with the open exits or nothing.
  (args: IArguments): boolean =>
    args[0] !== undefined && !Array.isArray(args[0]),
  (
    spec: LevelSpec,
    openExits: ReadonlyArray<ExitId> = [],
    dropped: ReadonlyArray<string> = [],
  ): Level => {
    const key = keyOf(
      spec,
      openExitIdsOf(spec, openExits),
      droppedIdsOf(spec, dropped),
    )
    const built = levelsBySpec.get(spec) ?? new Map<string, Level>()
    levelsBySpec.set(spec, built)
    const cached = built.get(key)
    if (cached !== undefined) {
      return cached
    }
    const level = buildLevel(spec, openExits, dropped)
    built.set(key, level)
    return level
  },
)

// NOTE: a map with no exits, for tests and tools that need a level of a
// different shape. It is built fresh, not kept.
export const makeLevel: {
  (id?: string): (tiles: ReadonlyArray<string>) => Level
  (tiles: ReadonlyArray<string>, id?: string): Level
} = Function.dual(
  // NOTE: data-first starts with the tiles; data-last with the id or nothing.
  (args: IArguments): boolean => Array.isArray(args[0]),
  (tiles: ReadonlyArray<string>, id: string = 'Custom'): Level =>
    buildLevel(
      {
        id,
        rooms: [
          {
            id,
            tiles,
            origin: { column: 0, row: 0 },
            maybeExit: Option.none(),
            renames: {},
          },
        ],
        exits: [],
        drops: [],
        start: middleOf(tiles),
      },
      [],
      [],
    ),
)

export const PARLOUR: Level = levelFor(PARLOUR_SPEC)

export const MANOR: Level = levelFor(MANOR_SPEC)

// NOTE: the manor with its slots as a roll stands them, no exit open.
export const startingLevelFor = (arrangement: Arrangement): LevelState => ({
  id: 'Manor',
  arrangement,
  openExits: [],
  dropped: [],
})

// NOTE: the house the home screen's World and the tests stand in, before a
// run rolls its own (freshLevel in src/world/schema/worldSchema.ts).
export const startingLevel: LevelState = startingLevelFor(DEFAULT_ARRANGEMENT)

// NOTE: the level every run starts on, with no exit open yet. Every
// arrangement's start is the same: the dining room and the kitchen are
// fixed, and the slot rooms stand behind shut boards. What is baked once for
// the start, such as Rattles' sprites, reads it.
export const START_LEVEL: Level = levelFor(
  specOfState(startingLevel),
  startingLevel.openExits,
)

// NOTE: Rattles' trunk where the level a run starts on marks it; his
// sprites are baked once for that spot. Opening an exit adds rooms around
// it without moving it.
const rattlesBox = (): Box => {
  const tiles = tilesWithSymbol(START_LEVEL, RATTLES_SYMBOL)
  const columns = Array.map(tiles, ({ column }) => column)
  const rows = Array.map(tiles, ({ row }) => row)
  return {
    left: Math.min(...columns) * TILE_SIZE,
    top: Math.min(...rows) * TILE_SIZE,
    right: (Math.max(...columns) + 1) * TILE_SIZE,
    bottom: (Math.max(...rows) + 1) * TILE_SIZE,
  }
}

export const RATTLES_BOX: Box = rattlesBox()

// NOTE: the open room a point stands in, or the first room when it stands in
// none, such as in a doorway.
export const roomAt: {
  (point: Vector): (level: Level) => Room
  (level: Level, point: Vector): Room
} = Function.dual(2, (level: Level, point: Vector): Room =>
  pipe(
    level.rooms,
    Array.findFirst(
      ({ box, isOpen }) =>
        isOpen &&
        point.x >= box.left &&
        point.x < box.right &&
        point.y >= box.top &&
        point.y < box.bottom,
    ),
    Option.orElse(() => Array.head(level.rooms)),
    Option.getOrElse((): Room => ({
      id: level.spec.id,
      box: level.bounds,
      isOpen: true,
    })),
  ),
)

const levelsByState = new WeakMap<LevelState, Level>()

// NOTE: the Model holds only which level and which exits are open. The
// built level is looked up by that record, so a frame that has not opened
// anything reads the same Level without building a key.
export const levelOf = ({ level }: Readonly<{ level: LevelState }>): Level => {
  const cached = levelsByState.get(level)
  if (cached !== undefined) {
    return cached
  }
  const found = levelFor(specOfState(level), level.openExits, level.dropped)
  levelsByState.set(level, found)
  return found
}

// EXITS

export const maybeExit: {
  (id: ExitId): (level: Level) => Option.Option<Exit>
  (level: Level, id: ExitId): Option.Option<Exit>
} = Function.dual(2, (level: Level, id: ExitId): Option.Option<Exit> =>
  Array.findFirst(level.exits, exit => exit.id === id),
)

export const closedExits = (level: Level): ReadonlyArray<Exit> =>
  Array.filter(level.exits, ({ isOpen }) => !isOpen)

const isClosedExit = (level: Level, id: ExitId): boolean =>
  Option.exists(maybeExit(level, id), ({ isOpen }) => !isOpen)

export const openExit: {
  (id: ExitId): (level: Level) => Level
  (level: Level, id: ExitId): Level
} = Function.dual(2, (level: Level, id: ExitId): Level =>
  isClosedExit(level, id)
    ? levelFor(level.spec, Array.append(level.openExits, id), level.dropped)
    : level,
)

export const openExitIn: {
  (id: ExitId): (state: LevelState) => LevelState
  (state: LevelState, id: ExitId): LevelState
} = Function.dual(2, (state: LevelState, id: ExitId): LevelState =>
  isClosedExit(levelOf({ level: state }), id)
    ? {
        id: state.id,
        arrangement: state.arrangement,
        openExits: Array.append(state.openExits, id),
        dropped: state.dropped,
      }
    : state,
)

// TILES

export const isWalkableTile: {
  (column: number, row: number): (level: Level) => boolean
  (level: Level, column: number, row: number): boolean
} = Function.dual(
  3,
  (level: Level, column: number, row: number): boolean =>
    isInsideRoom(level, column, row) &&
    !hasTileFlag(level, tileIndex(level, column, row), TILE_SOLID),
)

const isSolidTile = (level: Level, column: number, row: number): boolean =>
  isInsideRoom(level, column, row) &&
  hasTileFlag(level, tileIndex(level, column, row), TILE_SOLID)

export const isOpenBlock: {
  (column: number, row: number): (level: Level) => boolean
  (level: Level, column: number, row: number): boolean
} = Function.dual(
  3,
  (level: Level, column: number, row: number): boolean =>
    isInsideRoom(level, column, row) &&
    hasTileFlag(level, tileIndex(level, column, row), TILE_OPEN_BLOCK),
)

export const tileCoordinate = (position: number): number =>
  Math.floor(position / TILE_SIZE)

export const isSolidAt: {
  (arg1: Vector): (level: Level) => boolean
  (level: Level, arg1: Vector): boolean
} = Function.dual(2, (level: Level, { x, y }: Vector): boolean =>
  isSolidTile(level, tileCoordinate(x), tileCoordinate(y)),
)

const isOutsideTile = (level: Level, column: number, row: number): boolean =>
  hasTileFlag(level, tileIndex(level, column, row), TILE_OUTSIDE)

// NOTE: inside the house: on the map and not out in the yard. A zombie in the
// yard is still outside, walking to its door the way one past the map's edge
// does, and nothing out there is drawn.
export const isInsideRoomAt: {
  (arg1: Vector): (level: Level) => boolean
  (level: Level, arg1: Vector): boolean
} = Function.dual(2, (level: Level, { x, y }: Vector): boolean =>
  isInsideRoomPoint(level, x, y),
)

// NOTE: out in the yard: on the map but outside the house. With the kitchen
// boarded, its tiles count as yard too.
export const isInYardAt: {
  (arg1: Vector): (level: Level) => boolean
  (level: Level, arg1: Vector): boolean
} = Function.dual(2, (level: Level, { x, y }: Vector): boolean => {
  const column = tileCoordinate(x)
  const row = tileCoordinate(y)
  return isInsideRoom(level, column, row) && isOutsideTile(level, column, row)
})

export const isOnSoupAt: {
  (arg1: Vector): (level: Level) => boolean
  (level: Level, arg1: Vector): boolean
} = Function.dual(2, (level: Level, { x, y }: Vector): boolean => {
  const column = tileCoordinate(x)
  const row = tileCoordinate(y)
  return (
    isInsideRoom(level, column, row) &&
    hasTileFlag(level, tileIndex(level, column, row), TILE_SOUP)
  )
})

export const tileIndexAt: {
  (arg1: Vector): (level: Level) => number
  (level: Level, arg1: Vector): number
} = Function.dual(2, (level: Level, { x, y }: Vector): number =>
  tileIndex(
    level,
    clamp(
      tileCoordinate(x),
      level.leftColumn,
      level.leftColumn + level.columns - 1,
    ),
    clamp(tileCoordinate(y), level.topRow, level.topRow + level.rows - 1),
  ),
)

// DOORS

export const isDoorTile: {
  (column: number, row: number): (level: Level) => boolean
  (level: Level, column: number, row: number): boolean
} = Function.dual(
  3,
  (level: Level, column: number, row: number): boolean =>
    isInsideRoom(level, column, row) &&
    hasTileFlag(level, tileIndex(level, column, row), TILE_DOOR),
)

// NOTE: a zombie due at a door stands just past the door's own outer face,
// which for the parlour's doors is the map's edge, and for the kitchen's
// back door the top of the kitchen's wall.
export const doorSpawnPoint: {
  (id: DoorId, offset: number): (level: Level) => Vector
  (level: Level, id: DoorId, offset: number): Vector
} = Function.dual(3, (level: Level, id: DoorId, offset: number): Vector => {
  const { edge, outward } = level.doors[id]
  return {
    x: edge.x + outward.x * ZOMBIE_SPAWN_MARGIN - outward.y * offset,
    y: edge.y + outward.y * ZOMBIE_SPAWN_MARGIN + outward.x * offset,
  }
})

const distanceSquared = (first: Vector, second: Vector): number =>
  (first.x - second.x) ** 2 + (first.y - second.y) ** 2

export const nearestDoor: {
  (position: Vector): (level: Level) => Door
  (level: Level, position: Vector): Door
} = Function.dual(2, (level: Level, position: Vector): Door =>
  Array.reduce(
    Array.map(level.doorIds, id => level.doors[id]),
    level.doors[
      Option.getOrElse(Array.head(level.doorIds), (): DoorId => 'North')
    ],
    (nearest, door) =>
      distanceSquared(door.center, position) <
      distanceSquared(nearest.center, position)
        ? door
        : nearest,
  ),
)

// RAYS

// NOTE: a ray is sampled at `steps + 1` evenly spaced points, the first on
// `from` and the last on `to`. Rays walk the samples as plain numbers.
const stepsAlong = (from: Vector, to: Vector, stepPx: number): number =>
  Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / stepPx))

const isSolidPoint = (level: Level, x: number, y: number): boolean =>
  isSolidTile(level, tileCoordinate(x), tileCoordinate(y))

const isInsideRoomPoint = (level: Level, x: number, y: number): boolean => {
  const column = tileCoordinate(x)
  const row = tileCoordinate(y)
  return isInsideRoom(level, column, row) && !isOutsideTile(level, column, row)
}

export const findStrike: {
  (from: Vector, to: Vector): (level: Level) => Option.Option<Vector>
  (level: Level, from: Vector, to: Vector): Option.Option<Vector>
} = Function.dual(
  3,
  (level: Level, from: Vector, to: Vector): Option.Option<Vector> => {
    const steps = stepsAlong(from, to, BULLET_STEP_PX)
    const dx = to.x - from.x
    const dy = to.y - from.y
    for (let index = 0; index <= steps; index++) {
      if (
        isSolidPoint(
          level,
          from.x + (dx * index) / steps,
          from.y + (dy * index) / steps,
        )
      ) {
        const before = Math.max(0, index - 1)
        return Option.some({
          x: from.x + (dx * before) / steps,
          y: from.y + (dy * before) / steps,
        })
      }
    }
    return Option.none()
  },
)

// NOTE: where a ray ends: the last point before a wall or before it leaves
// the room through a doorway, or `to` when nothing is in the way.
export const findReach: {
  (from: Vector, to: Vector): (level: Level) => Vector
  (level: Level, from: Vector, to: Vector): Vector
} = Function.dual(3, (level: Level, from: Vector, to: Vector): Vector => {
  const steps = stepsAlong(from, to, BULLET_STEP_PX)
  const dx = to.x - from.x
  const dy = to.y - from.y
  for (let index = 0; index <= steps; index++) {
    const x = from.x + (dx * index) / steps
    const y = from.y + (dy * index) / steps
    if (isSolidPoint(level, x, y) || !isInsideRoomPoint(level, x, y)) {
      const before = Math.max(0, index - 1)
      return {
        x: from.x + (dx * before) / steps,
        y: from.y + (dy * before) / steps,
      }
    }
  }
  return to
})

const isLaneClear = (
  level: Level,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): boolean => {
  const steps = Math.max(
    1,
    Math.ceil(Math.hypot(toX - fromX, toY - fromY) / LINE_OF_SIGHT_STEP_PX),
  )
  const dx = toX - fromX
  const dy = toY - fromY
  for (let index = 0; index <= steps; index++) {
    if (
      isSolidPoint(
        level,
        fromX + (dx * index) / steps,
        fromY + (dy * index) / steps,
      )
    ) {
      return false
    }
  }
  return true
}

export const hasLineOfSight: {
  (from: Vector, to: Vector): (level: Level) => boolean
  (level: Level, from: Vector, to: Vector): boolean
} = Function.dual(3, (level: Level, from: Vector, to: Vector): boolean =>
  isLaneClear(level, from.x, from.y, to.x, to.y),
)

export const hasClearPath: {
  (from: Vector, to: Vector, halfWidth: number): (level: Level) => boolean
  (level: Level, from: Vector, to: Vector, halfWidth: number): boolean
} = Function.dual(
  4,
  (level: Level, from: Vector, to: Vector, halfWidth: number): boolean => {
    const length = Math.hypot(to.x - from.x, to.y - from.y)
    if (length <= 0) {
      return !isSolidAt(level, from)
    }

    const sideX = (-(to.y - from.y) / length) * halfWidth
    const sideY = ((to.x - from.x) / length) * halfWidth
    return (
      isLaneClear(level, from.x, from.y, to.x, to.y) &&
      isLaneClear(
        level,
        from.x + sideX,
        from.y + sideY,
        to.x + sideX,
        to.y + sideY,
      ) &&
      isLaneClear(
        level,
        from.x - sideX,
        from.y - sideY,
        to.x - sideX,
        to.y - sideY,
      )
    )
  },
)
