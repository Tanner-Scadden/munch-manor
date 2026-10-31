import { Array, Option, Record, Result, String, pipe } from 'effect'

import {
  BULLET_STEP_PX,
  COLLISION_STEP_PX,
  LINE_OF_SIGHT_STEP_PX,
  TILE_SIZE,
  ZOMBIE_SPAWN_MARGIN,
} from './constants'
import type {
  DoorId,
  ExitId,
  LevelId,
  LevelState,
  Vector,
} from './entitySchema'
import { addVectors, clamp, scaleVector, vectorLength } from './geometry'

// MAP

export const ROOM_MAP: ReadonlyArray<string> = [
  '######KK#############NN#########',
  '######KK#############NN#########',
  '#PPP..........FFFF........BBBBB#',
  '#PPP...........................#',
  '#..........A........A..........#',
  '#...TT.....A........A......TT..#',
  '#...TT.....................TT..#',
  '#..............................#',
  'W..............................E',
  'W..............................E',
  '#..............................#',
  '#...O......................VV..#',
  '#...O........CCCCCC........VV..#',
  '#..............................#',
  '#.........UU...................#',
  '#.........................$$...#',
  '#...................XX....$$...#',
  '########SS######################',
]

// NOTE: the kitchen stands north of the parlour, through the boarded double
// door at the K tiles. Its rows sit above the parlour's, so they are world
// rows -15 to -1. The yard east of it, the commas, is outside the house: the
// way to the parlour's north door. Zombies walk the yard, the player never
// does, and nothing out there is drawn.
const KITCHEN_MAP: ReadonlyArray<string> = [
  '############DD######,,,,,,,,,,,,',
  '############DD######,,,,,,,,,,,,',
  '#QQQ..GG..GG..IIIZZ#,,,,,,,,,,,,',
  '#QQQ..GG..GG..IIIZZ#,,,,,,,,,,,,',
  '#..................#,,,,,,,,,,,,',
  '#...~~.............#,,,,,,,,,,,,',
  'Y...~~~..........RR#,,,,,,,,,,,,',
  'Y......LLLLLL......#,,,,,,,,,,,,',
  '#......LLLLLL.~~...#,,,,,,,,,,,,',
  '#.............~~~..#,,,,,,,,,,,,',
  '#..................#,,,,,,,,,,,,',
  '#RR...~~...........#,,,,,,,,,,,,',
  '#....~~~...........#,,,,,,,,,,,,',
  '#..................#,,,,,,,,,,,,',
  '#..................#,,,,,,,,,,,,',
]

export const KITCHEN_TOP_ROW = -KITCHEN_MAP.length

const MANOR_MAP: ReadonlyArray<string> = [...KITCHEN_MAP, ...ROOM_MAP]

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

export const WALL_SYMBOL = '#'
export const SHOP_STALL_SYMBOL = '$'
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
}

export const DOOR_SYMBOLS: Readonly<Record<DoorId, string>> = {
  North: 'N',
  West: 'W',
  East: 'E',
  South: 'S',
  Back: 'D',
  Window: 'Y',
}

export const DOOR_OUTWARD: Readonly<Record<DoorId, Vector>> = {
  North: { x: 0, y: -1 },
  West: { x: -1, y: 0 },
  East: { x: 1, y: 0 },
  South: { x: 0, y: 1 },
  Back: { x: 0, y: -1 },
  Window: { x: -1, y: 0 },
}

// NOTE: every door a map can name. A level's own spawn doors are its
// `doorIds`, the ones on its map that no closed exit still holds shut. The
// parlour's four come first, so a level with the kitchen shut lists them in
// the same order it always did.
export const DOOR_IDS: ReadonlyArray<DoorId> = [
  'North',
  'West',
  'East',
  'South',
  'Back',
  'Window',
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
})

// SPECS

// NOTE: an exit is a boarded doorway drawn on the map with its own symbol.
// While it is closed its tiles are solid and the doors behind it stay shut.
// Opening it makes its tiles floor and adds its doors to the spawn doors.
type ExitSpec = Readonly<{
  id: ExitId
  symbol: string
  doors: ReadonlyArray<DoorId>
}>

// NOTE: a room is a block of whole tiles the camera may show. One behind an
// exit counts only once that exit is open, so the camera never scrolls onto
// a room the player cannot reach.
type RoomSpec = Readonly<{
  id: string
  firstColumn: number
  lastColumn: number
  firstRow: number
  lastRow: number
  maybeExit: Option.Option<ExitId>
}>

export type LevelSpec = Readonly<{
  id: string
  tiles: ReadonlyArray<string>
  topRow: number
  exits: ReadonlyArray<ExitSpec>
  rooms: Array.NonEmptyReadonlyArray<RoomSpec>
}>

const PARLOUR_ROOM: RoomSpec = {
  id: 'Parlour',
  firstColumn: 0,
  lastColumn: 31,
  firstRow: 0,
  lastRow: ROOM_MAP.length - 1,
  maybeExit: Option.none(),
}

const KITCHEN_ROOM: RoomSpec = {
  id: 'Kitchen',
  firstColumn: 0,
  lastColumn: 31,
  firstRow: KITCHEN_TOP_ROW,
  lastRow: -1,
  maybeExit: Option.some('Kitchen'),
}

// NOTE: the parlour on its own, the way every run saw it before the kitchen
// was built. Tests and tools that only need the parlour's shape use it. Its
// boarded double door holds no door shut, since no room stands behind it.
export const PARLOUR_SPEC: LevelSpec = {
  id: 'Parlour',
  tiles: ROOM_MAP,
  topRow: 0,
  exits: [{ id: 'Kitchen', symbol: 'K', doors: [] }],
  rooms: [PARLOUR_ROOM],
}

// NOTE: the manor is the level a run plays: the parlour, and the kitchen
// behind its boarded double door. The kitchen's back door and broken window
// stay shut until the player buys the exit open.
export const MANOR_SPEC: LevelSpec = {
  id: 'Manor',
  tiles: MANOR_MAP,
  topRow: KITCHEN_TOP_ROW,
  exits: [{ id: 'Kitchen', symbol: 'K', doors: ['Back', 'Window'] }],
  rooms: [PARLOUR_ROOM, KITCHEN_ROOM],
}

export const LEVEL_SPECS: Readonly<Record<LevelId, LevelSpec>> = {
  Parlour: PARLOUR_SPEC,
  Manor: MANOR_SPEC,
}

// GRID

export type Tile = Readonly<{ column: number; row: number }>

// NOTE: tile rows are world rows. A map whose first row sits above the
// parlour's top wall, like the manor's kitchen, has a negative topRow, so
// the parlour keeps the same world coordinates in every level it is part of.
type Grid = Readonly<{
  tiles: ReadonlyArray<string>
  columns: number
  rows: number
  topRow: number
}>

export const symbolAt = (
  grid: Grid,
  column: number,
  row: number,
): Option.Option<string> =>
  pipe(
    grid.tiles,
    Array.get(row - grid.topRow),
    Option.flatMap(line => String.at(line, column)),
  )

export const tileIndex = (grid: Grid, column: number, row: number): number =>
  (row - grid.topRow) * grid.columns + column

export const tileOfIndex = (grid: Grid, index: number): Tile => ({
  column: index % grid.columns,
  row: Math.floor(index / grid.columns) + grid.topRow,
})

export const isInsideRoom = (
  grid: Grid,
  column: number,
  row: number,
): boolean =>
  column >= 0 &&
  column < grid.columns &&
  row >= grid.topRow &&
  row < grid.topRow + grid.rows

export const tilesWithSymbol = (
  grid: Grid,
  symbol: string,
): ReadonlyArray<Tile> =>
  Array.flatMap(grid.tiles, (line, index) =>
    Array.filterMap(String.split(line, ''), (lineSymbol, column) =>
      lineSymbol === symbol
        ? Result.succeed({ column, row: index + grid.topRow })
        : Result.failVoid,
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

export const distanceToBox = (position: Vector, box: Box): number =>
  Math.hypot(
    position.x - clamp(position.x, box.left, box.right),
    position.y - clamp(position.y, box.top, box.bottom),
  )

export const circleTouchesBox = (
  position: Vector,
  radius: number,
  box: Box,
): boolean => distanceToBox(position, box) < radius

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
  tiles: ReadonlyArray<Tile>
  isOpen: boolean
}>

export type Room = Readonly<{ id: string; box: Box; isOpen: boolean }>

// NOTE: a level is built once for each set of open exits and kept, so every
// lookup a frame makes is a plain read. `key` names the spec and its open
// exits, and the flow field and the floor canvases rebuild when it changes.
// top is the world y of the first tile row, which is above 0 when the map
// starts above the parlour. bounds is the part the camera and the player may
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
  top: number
  width: number
  height: number
  bottom: number
  tileCount: number
  openExits: ReadonlyArray<ExitId>
  exits: ReadonlyArray<Exit>
  rooms: ReadonlyArray<Room>
  bounds: Box
  doorIds: ReadonlyArray<DoorId>
  doors: Readonly<Record<DoorId, Door>>
  thresholds: Readonly<Record<DoorId, Threshold>>
  doorTileIndices: Readonly<Record<DoorId, ReadonlyArray<number>>>
  solidTiles: ReadonlySet<number>
  outsideTiles: ReadonlySet<number>
  playerSolidTiles: ReadonlySet<number>
  soupTiles: ReadonlySet<number>
  openBlocks: ReadonlySet<number>
  doorTiles: ReadonlySet<number>
}>

const openExitIdsOf = (
  spec: LevelSpec,
  openExits: ReadonlyArray<ExitId>,
): ReadonlyArray<ExitId> =>
  Array.filterMap(spec.exits, ({ id }) =>
    Array.contains(openExits, id) ? Result.succeed(id) : Result.failVoid,
  )

const keyOf = (spec: LevelSpec, openExits: ReadonlyArray<ExitId>): string =>
  `${spec.id}:${Array.join(openExits, '+')}`

const buildLevel = (
  spec: LevelSpec,
  requestedExits: ReadonlyArray<ExitId>,
): Level => {
  const columns = pipe(
    Array.head(spec.tiles),
    Option.match({ onNone: () => 0, onSome: String.length }),
  )
  const grid: Grid = {
    tiles: spec.tiles,
    columns,
    rows: spec.tiles.length,
    topRow: spec.topRow,
  }
  const openExits = openExitIdsOf(spec, requestedExits)
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
    SHOP_STALL_SYMBOL,
    ...Record.keys(COVER_SYMBOLS),
    ...Array.map(closed, ({ symbol }) => symbol),
    ...Array.map(heldDoors, id => DOOR_SYMBOLS[id]),
  ])
  const rooms = Array.map(spec.rooms, (room): Room => ({
    id: room.id,
    box: {
      left: room.firstColumn * TILE_SIZE,
      top: room.firstRow * TILE_SIZE,
      right: (room.lastColumn + 1) * TILE_SIZE,
      bottom: (room.lastRow + 1) * TILE_SIZE,
    },
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

  const top = spec.topRow * TILE_SIZE
  const height = grid.rows * TILE_SIZE

  return {
    key: keyOf(spec, openExits),
    spec,
    tiles: spec.tiles,
    columns,
    rows: grid.rows,
    topRow: spec.topRow,
    top,
    width: columns * TILE_SIZE,
    height,
    bottom: top + height,
    tileCount: columns * grid.rows,
    openExits,
    exits,
    rooms,
    bounds: unionOf(
      Array.map(
        Array.filter(rooms, ({ isOpen }) => isOpen),
        ({ box }) => box,
      ),
      {
        left: 0,
        top,
        right: columns * TILE_SIZE,
        bottom: top + height,
      },
    ),
    doorIds,
    doors,
    thresholds,
    doorTileIndices,
    solidTiles,
    outsideTiles,
    playerSolidTiles,
    soupTiles,
    openBlocks,
    doorTiles,
  }
}

const levelsBySpec = new WeakMap<LevelSpec, Map<string, Level>>()

export const levelFor = (
  spec: LevelSpec,
  openExits: ReadonlyArray<ExitId> = [],
): Level => {
  const key = keyOf(spec, openExitIdsOf(spec, openExits))
  const built = levelsBySpec.get(spec) ?? new Map<string, Level>()
  levelsBySpec.set(spec, built)
  const cached = built.get(key)
  if (cached !== undefined) {
    return cached
  }
  const level = buildLevel(spec, openExits)
  built.set(key, level)
  return level
}

// NOTE: a map with no exits, for tests and tools that need a level of a
// different shape. It is built fresh, not kept.
export const makeLevel = (
  tiles: ReadonlyArray<string>,
  id: string = 'Custom',
): Level =>
  buildLevel(
    {
      id,
      tiles,
      topRow: 0,
      exits: [],
      rooms: [
        {
          id,
          firstColumn: 0,
          lastColumn: Math.max(
            0,
            Option.match(Array.head(tiles), {
              onNone: () => 0,
              onSome: String.length,
            }) - 1,
          ),
          firstRow: 0,
          lastRow: Math.max(0, tiles.length - 1),
          maybeExit: Option.none(),
        },
      ],
    },
    [],
  )

export const PARLOUR: Level = levelFor(PARLOUR_SPEC)

export const MANOR: Level = levelFor(MANOR_SPEC)

export const startingLevel: LevelState = { id: 'Manor', openExits: [] }

// NOTE: the open room a point stands in, or the first room when it stands in
// none, such as in a doorway.
export const roomAt = (level: Level, point: Vector): Room =>
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
  const found = levelFor(LEVEL_SPECS[level.id], level.openExits)
  levelsByState.set(level, found)
  return found
}

// EXITS

export const maybeExit = (level: Level, id: ExitId): Option.Option<Exit> =>
  Array.findFirst(level.exits, exit => exit.id === id)

export const closedExits = (level: Level): ReadonlyArray<Exit> =>
  Array.filter(level.exits, ({ isOpen }) => !isOpen)

const isClosedExit = (level: Level, id: ExitId): boolean =>
  Option.exists(maybeExit(level, id), ({ isOpen }) => !isOpen)

export const openExit = (level: Level, id: ExitId): Level =>
  isClosedExit(level, id)
    ? levelFor(level.spec, Array.append(level.openExits, id))
    : level

export const openExitIn = (state: LevelState, id: ExitId): LevelState =>
  isClosedExit(levelOf({ level: state }), id)
    ? { id: state.id, openExits: Array.append(state.openExits, id) }
    : state

// TILES

export const isWalkableTile = (
  level: Level,
  column: number,
  row: number,
): boolean =>
  isInsideRoom(level, column, row) &&
  !level.solidTiles.has(tileIndex(level, column, row))

const isSolidTile = (level: Level, column: number, row: number): boolean =>
  isInsideRoom(level, column, row) &&
  level.solidTiles.has(tileIndex(level, column, row))

export const isOpenBlock = (
  level: Level,
  column: number,
  row: number,
): boolean =>
  isInsideRoom(level, column, row) &&
  level.openBlocks.has(tileIndex(level, column, row))

export const tileCoordinate = (position: number): number =>
  Math.floor(position / TILE_SIZE)

export const isSolidAt = (level: Level, { x, y }: Vector): boolean =>
  isSolidTile(level, tileCoordinate(x), tileCoordinate(y))

const isOutsideTile = (level: Level, column: number, row: number): boolean =>
  level.outsideTiles.has(tileIndex(level, column, row))

// NOTE: inside the house: on the map and not out in the yard. A zombie in the
// yard is still outside, walking to its door the way one past the map's edge
// does, and nothing out there is drawn.
export const isInsideRoomAt = (level: Level, { x, y }: Vector): boolean => {
  const column = tileCoordinate(x)
  const row = tileCoordinate(y)
  return isInsideRoom(level, column, row) && !isOutsideTile(level, column, row)
}

// NOTE: out in the yard: on the map but outside the house. With the kitchen
// boarded, its tiles count as yard too.
export const isInYardAt = (level: Level, { x, y }: Vector): boolean => {
  const column = tileCoordinate(x)
  const row = tileCoordinate(y)
  return isInsideRoom(level, column, row) && isOutsideTile(level, column, row)
}

export const isOnSoupAt = (level: Level, { x, y }: Vector): boolean => {
  const column = tileCoordinate(x)
  const row = tileCoordinate(y)
  return (
    isInsideRoom(level, column, row) &&
    level.soupTiles.has(tileIndex(level, column, row))
  )
}

export const tileIndexAt = (level: Level, { x, y }: Vector): number =>
  tileIndex(
    level,
    clamp(tileCoordinate(x), 0, level.columns - 1),
    clamp(tileCoordinate(y), level.topRow, level.topRow + level.rows - 1),
  )

// DOORS

export const isDoorTile = (
  level: Level,
  column: number,
  row: number,
): boolean =>
  isInsideRoom(level, column, row) &&
  level.doorTiles.has(tileIndex(level, column, row))

// NOTE: a zombie due at a door stands just past the door's own outer face,
// which for the parlour's doors is the map's edge, and for the kitchen's
// back door the top of the kitchen's wall.
export const doorSpawnPoint = (
  level: Level,
  id: DoorId,
  offset: number,
): Vector => {
  const { edge, outward } = level.doors[id]
  return {
    x: edge.x + outward.x * ZOMBIE_SPAWN_MARGIN - outward.y * offset,
    y: edge.y + outward.y * ZOMBIE_SPAWN_MARGIN + outward.x * offset,
  }
}

const distanceSquared = (first: Vector, second: Vector): number =>
  (first.x - second.x) ** 2 + (first.y - second.y) ** 2

export const nearestDoor = (level: Level, position: Vector): Door =>
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
  )

// COLLISION

const pushOutOfBox = (position: Vector, radius: number, box: Box): Vector => {
  const { left, top, right, bottom } = box
  const deltaX = position.x - clamp(position.x, left, right)
  const deltaY = position.y - clamp(position.y, top, bottom)
  const distance = Math.hypot(deltaX, deltaY)

  if (distance >= radius) {
    return position
  } else if (distance > 0) {
    const push = (radius - distance) / distance
    return { x: position.x + deltaX * push, y: position.y + deltaY * push }
  }

  const toLeft = position.x - left
  const toRight = right - position.x
  const toTop = position.y - top
  const toBottom = bottom - position.y
  const nearest = Math.min(toLeft, toRight, toTop, toBottom)
  if (nearest === toLeft) {
    return { x: left - radius, y: position.y }
  } else if (nearest === toRight) {
    return { x: right + radius, y: position.y }
  } else if (nearest === toTop) {
    return { x: position.x, y: top - radius }
  } else {
    return { x: position.x, y: bottom + radius }
  }
}

// NOTE: who is moving decides what is solid. A zombie walks the yard on its
// way to a door, and the player never leaves the house.
export type Walker = 'Zombie' | 'Player'

const solidSetFor = (level: Level, walker: Walker): ReadonlySet<number> =>
  walker === 'Player' ? level.playerSolidTiles : level.solidTiles

const solidTilesNear = (
  level: Level,
  position: Vector,
  radius: number,
  walker: Walker,
): ReadonlyArray<Tile> => {
  const solid = solidSetFor(level, walker)
  return Array.flatMap(
    Array.range(
      tileCoordinate(position.y - radius),
      tileCoordinate(position.y + radius),
    ),
    row =>
      Array.filterMap(
        Array.range(
          tileCoordinate(position.x - radius),
          tileCoordinate(position.x + radius),
        ),
        column =>
          isInsideRoom(level, column, row) &&
          solid.has(tileIndex(level, column, row))
            ? Result.succeed({ column, row })
            : Result.failVoid,
      ),
  )
}

export const resolveCircle = (
  level: Level,
  position: Vector,
  radius: number,
  blockers: ReadonlyArray<Box> = [],
  walker: Walker = 'Zombie',
): Vector =>
  Array.reduce(
    blockers,
    Array.reduce(
      solidTilesNear(level, position, radius, walker),
      position,
      (resolved, tile) => pushOutOfBox(resolved, radius, tileBox(tile)),
    ),
    (resolved, box) => pushOutOfBox(resolved, radius, box),
  )

export const moveCircle = (
  level: Level,
  position: Vector,
  delta: Vector,
  radius: number,
  blockers: ReadonlyArray<Box> = [],
  walker: Walker = 'Zombie',
): Vector => {
  const steps = Math.max(1, Math.ceil(vectorLength(delta) / COLLISION_STEP_PX))
  const step = scaleVector(delta, 1 / steps)
  return Array.reduce(
    Array.makeBy(steps, () => step),
    position,
    (moved, part) =>
      resolveCircle(level, addVectors(moved, part), radius, blockers, walker),
  )
}

// RAYS

const pointsAlong = (
  from: Vector,
  to: Vector,
  stepPx: number,
): ReadonlyArray<Vector> => {
  const steps = Math.max(
    1,
    Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / stepPx),
  )
  return Array.makeBy(steps + 1, index => ({
    x: from.x + ((to.x - from.x) * index) / steps,
    y: from.y + ((to.y - from.y) * index) / steps,
  }))
}

export const findStrike = (
  level: Level,
  from: Vector,
  to: Vector,
): Option.Option<Vector> => {
  const points = pointsAlong(from, to, BULLET_STEP_PX)
  return pipe(
    points,
    Array.findFirstIndex(point => isSolidAt(level, point)),
    Option.map(index =>
      Option.getOrElse(Array.get(points, Math.max(0, index - 1)), () => from),
    ),
  )
}

// NOTE: where a ray ends: the last point before a wall or before it leaves
// the room through a doorway, or `to` when nothing is in the way.
export const findReach = (level: Level, from: Vector, to: Vector): Vector => {
  const points = pointsAlong(from, to, BULLET_STEP_PX)
  return pipe(
    points,
    Array.findFirstIndex(
      point => isSolidAt(level, point) || !isInsideRoomAt(level, point),
    ),
    Option.flatMap(index => Array.get(points, Math.max(0, index - 1))),
    Option.getOrElse(() => to),
  )
}

const isLaneClear = (level: Level, from: Vector, to: Vector): boolean =>
  !Array.some(pointsAlong(from, to, LINE_OF_SIGHT_STEP_PX), point =>
    isSolidAt(level, point),
  )

export const hasLineOfSight = isLaneClear

export const hasClearPath = (
  level: Level,
  from: Vector,
  to: Vector,
  halfWidth: number,
): boolean => {
  const length = Math.hypot(to.x - from.x, to.y - from.y)
  if (length <= 0) {
    return !isSolidAt(level, from)
  }

  const side = {
    x: (-(to.y - from.y) / length) * halfWidth,
    y: ((to.x - from.x) / length) * halfWidth,
  }
  return (
    isLaneClear(level, from, to) &&
    isLaneClear(level, addVectors(from, side), addVectors(to, side)) &&
    isLaneClear(
      level,
      addVectors(from, scaleVector(side, -1)),
      addVectors(to, scaleVector(side, -1)),
    )
  )
}
