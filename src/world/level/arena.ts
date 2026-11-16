import { Array, Function, Option, Record, Result, String, pipe } from 'effect'

import { TILE_SIZE } from '../../shared/constants'
import type {
  Arrangement,
  DoorId,
  ExitId,
  LevelState,
  Vector,
} from '../schema/entitySchema'
import { addVectors, scaleVector } from '../step/geometry'
import {
  DEFAULT_ARRANGEMENT,
  type ExitOpener,
  type LevelSpec,
  MANOR_SPEC,
  PARLOUR_SPEC,
  type RoomSpec,
  middleOf,
  specOfState,
  widthOf,
} from './plan'
import {
  type Box,
  COVER_SYMBOLS,
  DOOR_IDS,
  DOOR_OUTWARD,
  DOOR_SYMBOLS,
  type Grid,
  OUTSIDE_SYMBOL,
  RATTLES_SYMBOL,
  SOUP_SYMBOL,
  type Tile,
  WALL_SYMBOL,
  byDoor,
  isInsideRoom,
  tileBox,
  tileCenter,
  tileIndex,
  tilesWithSymbol,
} from './tileGrid'

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
  // NOTE: how many solid tiles lie above and left of each tile corner, one
  // row and column wider than the map, so a box of tiles says in four reads
  // whether any is solid (`isAnySolidIn` in tileQueries.ts).
  solidSums: Int32Array
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
export const TILE_SOUP = 16
export const TILE_DOOR = 32

export const hasTileFlag: {
  (index: number, flag: number): (level: Level) => boolean
  (level: Level, index: number, flag: number): boolean
} = Function.dual(
  3,
  (level: Level, index: number, flag: number): boolean =>
    ((level.tileFlags[index] ?? 0) & flag) !== 0,
)

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

// NOTE: each tile of a spec's map, by index: its symbol ('' past a row's
// end), and the rooms whose box holds its center, as bits by the room's
// place in `spec.rooms`. Kept per spec, which never changes, so building
// another level of it reads them instead of searching the map again.
type TileTable = Readonly<{
  symbols: ReadonlyArray<string>
  roomMasks: Uint32Array
}>

const tileTables = new WeakMap<LevelSpec, TileTable>()

const tileTableOf = (spec: LevelSpec, grid: Grid): TileTable => {
  const kept = tileTables.get(spec)
  if (kept !== undefined) {
    return kept
  }
  const boxes = Array.map(spec.rooms, roomBoxOf)
  const tileCount = grid.columns * grid.rows
  const symbols: Array<string> = []
  const roomMasks = new Uint32Array(tileCount)
  for (let index = 0; index < tileCount; index++) {
    const column = (index % grid.columns) + grid.leftColumn
    const row = Math.floor(index / grid.columns) + grid.topRow
    const line = grid.tiles[row - grid.topRow] ?? ''
    symbols.push(line[column - grid.leftColumn] ?? '')
    const x = column * TILE_SIZE + TILE_SIZE / 2
    const y = row * TILE_SIZE + TILE_SIZE / 2
    let mask = 0
    // NOTE: a level has a handful of rooms (five in the manor), well under
    // the 32 bits of a mask.
    for (let room = 0; room < boxes.length; room++) {
      const box = boxes[room]
      if (
        box !== undefined &&
        x > box.left &&
        x < box.right &&
        y > box.top &&
        y < box.bottom
      ) {
        mask |= 1 << room
      }
    }
    roomMasks[index] = mask
  }
  const table = { symbols, roomMasks }
  tileTables.set(spec, table)
  return table
}

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
  // NOTE: one pass over the map's tiles marks each with its flags, reading
  // each tile's symbol and the rooms round it off the spec's table, so a
  // new level (an exit opened, the chandelier dropped mid-wave) is built in
  // a fraction of a frame.
  const { symbols, roomMasks } = tileTableOf(spec, grid)
  const openRooms = Array.reduce(rooms, 0, (mask, room, index) =>
    room.isOpen ? mask | (1 << index) : mask,
  )
  const doorSymbols: ReadonlySet<string> = new Set(
    Array.map(doorIds, id => DOOR_SYMBOLS[id]),
  )
  const tileCount = columns * grid.rows
  const tileFlags = new Uint8Array(tileCount)
  let hasSoup = false
  for (let index = 0; index < tileCount; index++) {
    const symbol = symbols[index] ?? ''
    const inRooms = roomMasks[index] ?? 0
    // NOTE: a room behind a closed exit is not there yet. Its tiles are open
    // ground outside the house, the way the space past the map's edge is,
    // so a zombie walking around the parlour never bumps into the kitchen's
    // walls.
    const isShutAway =
      (inRooms & ~openRooms) !== 0 && (inRooms & openRooms) === 0
    const isSolid = !isShutAway && solidSymbols.has(symbol)
    const isOutside = isShutAway || symbol === OUTSIDE_SYMBOL
    const isSoup = symbol === SOUP_SYMBOL
    hasSoup = hasSoup || isSoup
    tileFlags[index] =
      (isSolid ? TILE_SOLID : 0) |
      (isOutside ? TILE_OUTSIDE : 0) |
      (isSolid || isOutside ? TILE_PLAYER_SOLID : 0) |
      (isSoup ? TILE_SOUP : 0) |
      (doorSymbols.has(symbol) ? TILE_DOOR : 0)
  }
  const isFlagged = (column: number, row: number, flag: number): boolean =>
    ((tileFlags[tileIndex(grid, column, row)] ?? 0) & flag) !== 0
  const isWalkable = (column: number, row: number): boolean =>
    isInsideRoom(grid, column, row) && !isFlagged(column, row, TILE_SOLID)
  // NOTE: a tile opens a block when it and the tiles east, south, and
  // south-east of it are all on the map and none is solid.
  const isOpenAt = (index: number): boolean =>
    ((tileFlags[index] ?? TILE_SOLID) & TILE_SOLID) === 0
  for (let row = 0; row < grid.rows - 1; row++) {
    for (let column = 0; column < columns - 1; column++) {
      const index = row * columns + column
      if (
        isOpenAt(index) &&
        isOpenAt(index + 1) &&
        isOpenAt(index + columns) &&
        isOpenAt(index + columns + 1)
      ) {
        tileFlags[index] = (tileFlags[index] ?? 0) | TILE_OPEN_BLOCK
      }
    }
  }

  const solidSums = new Int32Array((columns + 1) * (grid.rows + 1))
  for (let row = 0; row < grid.rows; row++) {
    let inRow = 0
    for (let column = 0; column < columns; column++) {
      inRow +=
        ((tileFlags[row * columns + column] ?? 0) & TILE_SOLID) !== 0 ? 1 : 0
      solidSums[(row + 1) * (columns + 1) + column + 1] =
        (solidSums[row * (columns + 1) + column + 1] ?? 0) + inRow
    }
  }

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
          !isFlagged(innerColumn, innerRow, TILE_DOOR)
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
    tileFlags,
    solidSums,
    hasSoup,
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

// NOTE: the same level with nothing dropped, the one cached record for its
// open exits: what stands of the house is drawn from it, so a chandelier
// falling keeps the drawn house instead of building it again.
export const standingLevelOf = (level: Level): Level =>
  Array.isReadonlyArrayNonEmpty(level.dropped)
    ? levelFor(level.spec, level.openExits)
    : level

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
