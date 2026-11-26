import { Array, Function, Option, Record, Result, String, pipe } from 'effect'

import { TILE_SIZE } from '#shared/constants.ts'
import type {
  Arrangement,
  DoorId,
  ExitId,
  LevelState,
  Vector,
} from '#world/schema/entitySchema.ts'
import { addVectors, scaleVector } from '#world/step/geometry.ts'

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
} from './plan.ts'
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
} from './tileGrid.ts'

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
  solidSums: Int32Array
  hasSoup: boolean
  start: Vector
}>

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
    DOOR_SYMBOLS.Front,
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

export const makeLevel: {
  (id?: string): (tiles: ReadonlyArray<string>) => Level
  (tiles: ReadonlyArray<string>, id?: string): Level
} = Function.dual(
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

export const startingLevelFor = (arrangement: Arrangement): LevelState => ({
  id: 'Manor',
  arrangement,
  openExits: [],
  dropped: [],
})

export const startingLevel: LevelState = startingLevelFor(DEFAULT_ARRANGEMENT)

export const START_LEVEL: Level = levelFor(
  specOfState(startingLevel),
  startingLevel.openExits,
)

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

export const levelOf = ({ level }: Readonly<{ level: LevelState }>): Level => {
  const cached = levelsByState.get(level)
  if (cached !== undefined) {
    return cached
  }
  const found = levelFor(specOfState(level), level.openExits, level.dropped)
  levelsByState.set(level, found)
  return found
}

export const standingLevelOf = (level: Level): Level =>
  Array.isReadonlyArrayNonEmpty(level.dropped)
    ? levelFor(level.spec, level.openExits)
    : level

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
