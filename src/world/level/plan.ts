import { Array, Option, Result, String, pipe } from 'effect'

import { TILE_SIZE } from '#shared/constants.ts'
import type {
  Arrangement,
  DoorId,
  ExitId,
  LevelState,
  SlotRoomId,
  Vector,
} from '#world/schema/entitySchema.ts'

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

const KITCHEN_MAP: ReadonlyArray<string> = [
  '############DD######,,,,,,,,,,,,',
  '############DD######,,,,,,,,,,,,',
  '#QQQ..GG..GG..IIIZZ#,,,,,,,,,,,,',
  '#QQQ..GG..GG..IIIZZ#,,,,,,,,,,,,',
  '#....1.*...........#,,,,,,,,,,,,',
  '#...~~...........2.#,,,,,,,,,,,,',
  'Y...~~~..........RR#,,,,,,,,,,,,',
  'Y......LLLLLL......#,,,,,,,,,,,,',
  '#......LLLLLL.~~...#,,,,,,,,,,,,',
  '#........3....~~~..#,,,,,,,,,,,,',
  '#c4................#,,,,,,,,,,,,',
  '#RR...~~...........#,,,,,,,,,,,,',
  '#....~~~...........#,,,,,,,,,,,,',
  '#...............t..#,,,,,,,,,,,,',
  '#..................#,,,,,,,,,,,,',
]

export const KITCHEN_TOP_ROW = -KITCHEN_MAP.length

export const DINING_MAP: ReadonlyArray<string> = [
  '######KK###################NN#######',
  '######KK###################NN#######',
  'W............HHHHHHHHHH.......cc...#',
  'W.............2....................#',
  '#..................................#',
  '#..................................#',
  '#HHH.......i............i.......HHH#',
  '#HHH1...........................HHH#',
  '#..................................>',
  '#..........................3.......>',
  '#j......=========^^=========.......#',
  '#.......=========^^=========.......#',
  '<..................................#',
  '<..................................?',
  '#..........i.....@@.....i..........?',
  '#cc..............................cc#',
  '#.......VV................VV.......#',
  '?.......VV................VV.......#',
  '?............i........i............E',
  '#HH..................$$...........4E',
  '#HH......tt..........$$..........HH#',
  '#####SS#########MMMM################',
]

export const PARLOUR_SLOT_MAP: ReadonlyArray<string> = [
  '#####################nn#########',
  '#####################nn#########',
  '#PPP..........FFFF........BBBBB#',
  '#PPP1.......................2..#',
  '#......TTCCCCCC..CCCCCCVV......#',
  '#......TT.*............VV......#',
  '#.....A..................A.....#',
  '#.....A..................A.....#',
  '(..............................)',
  '(..............................)',
  '#.....O..................A.....#',
  '#....3O..................A..VV.#',
  '#......VV..............TT...VV.#',
  '?......VVUUCCCC..CCCCCCTT......?',
  '?........4.....................?',
  '#..............................#',
  '#cc.................tt.....cc..#',
  '########ss######################',
]

export const LIBRARY_MAP: ReadonlyArray<string> = [
  '##############nn################',
  '##############nn################',
  '#..............................#',
  '#..BB..BB..BB....BB............#',
  '#..BB..BB..BBkkkkBB.........g..#',
  '#..BB..BB..BBkkkkBB.........1..#',
  '#..BB2.BB..BB....*.............#',
  '#..BB..BB..BB..................#',
  '(..........mm..................)',
  '(..........mm..................)',
  '#..........mm..................#',
  '#..BB..BB..BB*.....dddddddd....#',
  '#..BB..BB..BB.....3dddddddd....#',
  '%..BB..BB..BB..................%',
  '%..BB..BB..BB..................%',
  '#..BB..BB4.BB..................#',
  '#..BBccBBttBB..............cc..#',
  '################ss##############',
]

export const CELLAR_MAP: ReadonlyArray<string> = [
  '#####nn#########################',
  '#####nn#########################',
  '#.....4...XX...................#',
  '#.........XX...................#',
  '#..]]]]]]]...]]]]]]]]..]]]]]]].#',
  '#...........................2..#',
  '#...............*..............#',
  '#..]]]]]]]].............]]]]]..#',
  '(.................oooo.........)',
  '(................*oooo1........)',
  '#..]]]]]]]].......oooo..]]]]]..#',
  '#.................oooo.........#',
  '#..............................#',
  '?..............................?',
  '?..]]]]]]]]..]]]]]]..]]]]]]]]..?',
  '#..........................3...#',
  '#cc.........tt...............cc#',
  '#######################ss#######',
]

const REVIEW_MARKS: Readonly<Record<string, string>> = {
  c: '.',
  t: '.',
  '1': '.',
  '2': '.',
  '3': '.',
  '4': '.',
  '@': '.',
  '*': '.',
  j: '.',
  '?': '#',
  '%': '#',
}

const START_SYMBOL = '@'

export const CHANDELIER_SYMBOL = '^'

export const CHANDELIER_DROP = 'Chandelier'

export const STACK_DROPS = {
  NorthStack: { id: 'NorthStack', symbol: 'k' },
  SouthStack: { id: 'SouthStack', symbol: 'm' },
} as const

const SHELF_MARK = '%'
const SWINGABLE_MARK = '?'
export const SECRET_SYMBOL = '&'

export type ExitOpener = 'Boards' | 'Shelf'

type ExitSpec = Readonly<{
  id: ExitId
  symbol: string
  doors: ReadonlyArray<DoorId>
  opener: ExitOpener
  requires: ReadonlyArray<ExitId>
}>

type DropSpec = Readonly<{ id: string; symbol: string }>

export type RoomSpec = Readonly<{
  id: string
  tiles: ReadonlyArray<string>
  origin: Readonly<{ column: number; row: number }>
  maybeExit: Option.Option<ExitId>
  renames: Readonly<Record<string, string>>
}>

export type LevelSpec = Readonly<{
  id: string
  rooms: Array.NonEmptyReadonlyArray<RoomSpec>
  exits: ReadonlyArray<ExitSpec>
  drops: ReadonlyArray<DropSpec>
  start: Vector
}>

export const PARLOUR_ROOM_ID = 'Parlour'
export const DINING_ROOM_ID = 'Dining'
export const KITCHEN_ROOM_ID = 'Kitchen'
export const LIBRARY_ROOM_ID = 'Library'
export const CELLAR_ROOM_ID = 'Cellar'

const PARLOUR_ROOM: RoomSpec = {
  id: PARLOUR_ROOM_ID,
  tiles: ROOM_MAP,
  origin: { column: 0, row: 0 },
  maybeExit: Option.none(),
  renames: {},
}

const KITCHEN_ROOM: RoomSpec = {
  id: KITCHEN_ROOM_ID,
  tiles: KITCHEN_MAP,
  origin: { column: 0, row: KITCHEN_TOP_ROW },
  maybeExit: Option.some('Kitchen'),
  renames: REVIEW_MARKS,
}

const SLOT_ROOMS: Readonly<
  Record<
    SlotRoomId,
    Readonly<{
      tiles: ReadonlyArray<string>
      renames: Readonly<Record<string, string>>
    }>
  >
> = {
  [PARLOUR_ROOM_ID]: { tiles: PARLOUR_SLOT_MAP, renames: {} },
  [LIBRARY_ROOM_ID]: { tiles: LIBRARY_MAP, renames: { B: 'b' } },
  [CELLAR_ROOM_ID]: { tiles: CELLAR_MAP, renames: {} },
}

export type SlotId = 'West' | 'East' | 'Far'

export type Side = 'West' | 'East'

export const SLOT_DOOR_SYMBOLS = {
  WestTop: 'n',
  WestBottom: 's',
  EastTop: 'u',
  EastBottom: 'v',
  FarTop: 'w',
  FarBottom: 'x',
} as const satisfies Partial<Record<DoorId, string>>

export const WEST_EXIT: ExitId = 'West'
export const EAST_EXIT: ExitId = 'East'
export const FAR_EXIT: ExitId = 'Far'
export const SECRET_EXIT: ExitId = 'Secret'

const FAR_EXIT_SYMBOL = '}'

type Slot = Readonly<{
  origin: Readonly<{ column: number; row: number }>
  exit: ExitId
  exitSymbol: string
  requires: ReadonlyArray<ExitId>
  top: keyof typeof SLOT_DOOR_SYMBOLS
  bottom: keyof typeof SLOT_DOOR_SYMBOLS
  ports: Readonly<Record<'(' | ')', string>>
  inward: Side
}>

export const SLOTS: Readonly<Record<SlotId, Slot>> = {
  West: {
    origin: { column: -32, row: 4 },
    exit: WEST_EXIT,
    exitSymbol: '<',
    requires: [],
    top: 'WestTop',
    bottom: 'WestBottom',
    ports: { '(': '#', ')': '.' },
    inward: 'East',
  },
  East: {
    origin: { column: 36, row: 0 },
    exit: EAST_EXIT,
    exitSymbol: '>',
    requires: [],
    top: 'EastTop',
    bottom: 'EastBottom',
    ports: { '(': '.', ')': FAR_EXIT_SYMBOL },
    inward: 'West',
  },
  Far: {
    origin: { column: 68, row: 0 },
    exit: FAR_EXIT,
    exitSymbol: FAR_EXIT_SYMBOL,
    requires: [EAST_EXIT],
    top: 'FarTop',
    bottom: 'FarBottom',
    ports: { '(': '.', ')': '#' },
    inward: 'West',
  },
}

export const SLOT_IDS: ReadonlyArray<SlotId> = ['West', 'East', 'Far']

export const slotOfExit = (exit: ExitId): Option.Option<SlotId> =>
  Array.findFirst(SLOT_IDS, slot => SLOTS[slot].exit === exit)

const opposite = (side: Side): Side => (side === 'West' ? 'East' : 'West')

const withSideMark = (
  tiles: ReadonlyArray<string>,
  side: Side,
  from: string,
  to: string,
): ReadonlyArray<string> =>
  Array.map(tiles, line => {
    const column = side === 'West' ? 0 : String.length(line) - 1
    return Option.contains(String.at(line, column), from)
      ? `${pipe(line, String.slice(0, column))}${to}${pipe(line, String.slice(column + 1))}`
      : line
  })

type Shelf = Readonly<{
  slot: SlotId
  side: Side
  neighbour: 'Dining' | SlotId
}>

const secretShelfOf = (arrangement: Arrangement): Option.Option<Shelf> =>
  Option.map(
    Array.findFirst(SLOT_IDS, slot => arrangement[slot] === LIBRARY_ROOM_ID),
    slot => ({
      slot,
      side: SLOTS[slot].inward,
      neighbour: slot === 'Far' ? 'East' : 'Dining',
    }),
  )

const withShelf = (
  tiles: ReadonlyArray<string>,
  room: 'Dining' | SlotId,
  maybeShelf: Option.Option<Shelf>,
): ReadonlyArray<string> =>
  Option.match(maybeShelf, {
    onNone: () => tiles,
    onSome: shelf =>
      shelf.slot === room
        ? withSideMark(tiles, shelf.side, SHELF_MARK, SECRET_SYMBOL)
        : shelf.neighbour === room
          ? withSideMark(
              tiles,
              opposite(shelf.side),
              SWINGABLE_MARK,
              SECRET_SYMBOL,
            )
          : tiles,
  })

const slotRoomOf = (
  arrangement: Arrangement,
  slot: SlotId,
  maybeShelf: Option.Option<Shelf>,
): RoomSpec => {
  const { origin, exit, top, bottom, ports } = SLOTS[slot]
  const room = SLOT_ROOMS[arrangement[slot]]
  return {
    id: arrangement[slot],
    tiles: withShelf(room.tiles, slot, maybeShelf),
    origin,
    maybeExit: Option.some(exit),
    renames: {
      ...REVIEW_MARKS,
      ...room.renames,
      ...ports,
      n: SLOT_DOOR_SYMBOLS[top],
      s: SLOT_DOOR_SYMBOLS[bottom],
    },
  }
}

const slotExitOf = (slot: SlotId): ExitSpec => ({
  id: SLOTS[slot].exit,
  symbol: SLOTS[slot].exitSymbol,
  doors: [SLOTS[slot].top, SLOTS[slot].bottom],
  opener: 'Boards',
  requires: SLOTS[slot].requires,
})

const shelfExitOf = (shelf: Shelf): ExitSpec => ({
  id: SECRET_EXIT,
  symbol: SECRET_SYMBOL,
  doors: [],
  opener: 'Shelf',
  requires: [SLOTS[shelf.slot].exit],
})

export const widthOf = (tiles: ReadonlyArray<string>): number =>
  Option.match(Array.head(tiles), { onNone: () => 0, onSome: String.length })

export const middleOf = (tiles: ReadonlyArray<string>): Vector => ({
  x: (widthOf(tiles) * TILE_SIZE) / 2,
  y: (tiles.length * TILE_SIZE) / 2,
})

const spotOf = (room: RoomSpec, symbol: string): Vector => {
  const spots = Array.flatMap(room.tiles, (line, row) =>
    Array.filterMap(String.split(line, ''), (each, column) =>
      each === symbol ? Result.succeed({ column, row }) : Result.failVoid,
    ),
  )
  const left = room.origin.column * TILE_SIZE
  const top = room.origin.row * TILE_SIZE
  return Array.match(spots, {
    onEmpty: () => {
      const middle = middleOf(room.tiles)
      return { x: left + middle.x, y: top + middle.y }
    },
    onNonEmpty: nonEmpty => ({
      x:
        left +
        ((Math.min(...Array.map(nonEmpty, ({ column }) => column)) +
          Math.max(...Array.map(nonEmpty, ({ column }) => column)) +
          1) *
          TILE_SIZE) /
          2,
      y:
        top +
        ((Math.min(...Array.map(nonEmpty, ({ row }) => row)) +
          Math.max(...Array.map(nonEmpty, ({ row }) => row)) +
          1) *
          TILE_SIZE) /
          2,
    }),
  })
}

export const PARLOUR_SPEC: LevelSpec = {
  id: 'Parlour',
  rooms: [PARLOUR_ROOM],
  exits: [
    { id: 'Kitchen', symbol: 'K', doors: [], opener: 'Boards', requires: [] },
  ],
  drops: [],
  start: middleOf(ROOM_MAP),
}

const buildManorSpec = (arrangement: Arrangement): LevelSpec => {
  const maybeShelf = secretShelfOf(arrangement)
  const dining: RoomSpec = {
    id: DINING_ROOM_ID,
    tiles: withShelf(DINING_MAP, 'Dining', maybeShelf),
    origin: { column: 0, row: 0 },
    maybeExit: Option.none(),
    renames: REVIEW_MARKS,
  }
  const slotRooms = Array.map(SLOT_IDS, slot =>
    slotRoomOf(arrangement, slot, maybeShelf),
  )
  return {
    id: `Manor:${arrangementKeyOf(arrangement)}`,
    rooms: [dining, KITCHEN_ROOM, ...slotRooms],
    exits: [
      {
        id: 'Kitchen',
        symbol: 'K',
        doors: ['Back', 'Window'],
        opener: 'Boards',
        requires: [],
      },
      ...Array.map(SLOT_IDS, slotExitOf),
      ...Option.match(maybeShelf, {
        onNone: () => [],
        onSome: shelf => [shelfExitOf(shelf)],
      }),
    ],
    drops: [
      { id: CHANDELIER_DROP, symbol: CHANDELIER_SYMBOL },
      STACK_DROPS.NorthStack,
      STACK_DROPS.SouthStack,
    ],
    start: spotOf(dining, START_SYMBOL),
  }
}

const arrangementKeyOf = (arrangement: Arrangement): string =>
  `${arrangement.West}-${arrangement.East}-${arrangement.Far}`

export const ARRANGEMENTS: Array.NonEmptyReadonlyArray<Arrangement> = [
  { West: PARLOUR_ROOM_ID, East: LIBRARY_ROOM_ID, Far: CELLAR_ROOM_ID },
  { West: PARLOUR_ROOM_ID, East: CELLAR_ROOM_ID, Far: LIBRARY_ROOM_ID },
  { West: LIBRARY_ROOM_ID, East: PARLOUR_ROOM_ID, Far: CELLAR_ROOM_ID },
  { West: LIBRARY_ROOM_ID, East: CELLAR_ROOM_ID, Far: PARLOUR_ROOM_ID },
  { West: CELLAR_ROOM_ID, East: PARLOUR_ROOM_ID, Far: LIBRARY_ROOM_ID },
  { West: CELLAR_ROOM_ID, East: LIBRARY_ROOM_ID, Far: PARLOUR_ROOM_ID },
]

export const DEFAULT_ARRANGEMENT: Arrangement = Array.headNonEmpty(ARRANGEMENTS)

export const arrangementAt = (roll: number): Arrangement =>
  Option.getOrElse(
    Array.get(
      ARRANGEMENTS,
      Math.min(
        ARRANGEMENTS.length - 1,
        Math.max(0, Math.floor(roll * ARRANGEMENTS.length)),
      ),
    ),
    () => DEFAULT_ARRANGEMENT,
  )

const MANOR_SPECS: ReadonlyMap<string, LevelSpec> = new Map(
  Array.map(ARRANGEMENTS, arrangement => [
    arrangementKeyOf(arrangement),
    buildManorSpec(arrangement),
  ]),
)

export const manorSpecFor = (arrangement: Arrangement): LevelSpec =>
  MANOR_SPECS.get(arrangementKeyOf(arrangement)) ?? buildManorSpec(arrangement)

export const MANOR_SPEC: LevelSpec = manorSpecFor(DEFAULT_ARRANGEMENT)

export const EVERY_LEVEL_SPEC: ReadonlyArray<LevelSpec> = [
  PARLOUR_SPEC,
  ...Array.map(ARRANGEMENTS, arrangement => manorSpecFor(arrangement)),
]

export const specOfState = (state: LevelState): LevelSpec =>
  state.id === 'Manor' ? manorSpecFor(state.arrangement) : PARLOUR_SPEC

export type SpotTile = Readonly<{ column: number; row: number }>

export type RoomSpots = Readonly<{
  room: string
  hiding: ReadonlyArray<Readonly<{ mark: string; tile: SpotTile }>>
  cases: ReadonlyArray<ReadonlyArray<SpotTile>>
  trapCrates: ReadonlyArray<ReadonlyArray<SpotTile>>
  cleats: ReadonlyArray<SpotTile>
  tools: ReadonlyArray<SpotTile>
}>

const HIDING_MARKS: ReadonlyArray<string> = ['1', '2', '3', '4']
const CASE_MARK = 'c'
const TRAP_CRATE_MARK = 't'
const CLEAT_MARK = 'j'
const TOOL_MARK = '*'

const marksOf = (
  room: RoomSpec,
  isMark: (symbol: string) => boolean,
): ReadonlyArray<Readonly<{ mark: string; tile: SpotTile }>> =>
  Array.flatMap(room.tiles, (line, row) =>
    Array.filterMap(String.split(line, ''), (mark, column) =>
      isMark(mark)
        ? Result.succeed({
            mark,
            tile: {
              column: room.origin.column + column,
              row: room.origin.row + row,
            },
          })
        : Result.failVoid,
    ),
  )

const NO_PIECES: ReadonlyArray<ReadonlyArray<SpotTile>> = []

const piecesOf = (
  room: RoomSpec,
  symbol: string,
): ReadonlyArray<ReadonlyArray<SpotTile>> =>
  Array.reduce(
    Array.map(
      marksOf(room, mark => mark === symbol),
      ({ tile }) => tile,
    ),
    NO_PIECES,
    (pieces, tile) =>
      Option.match(Array.last(pieces), {
        onNone: () => [[tile]],
        onSome: piece =>
          Option.exists(
            Array.last(piece),
            last => last.row === tile.row && last.column === tile.column - 1,
          )
            ? [...Array.dropRight(pieces, 1), [...piece, tile]]
            : [...pieces, [tile]],
      }),
  )

export const roomSpotsOf = (spec: LevelSpec): ReadonlyArray<RoomSpots> =>
  Array.map(spec.rooms, room => ({
    room: room.id,
    hiding: marksOf(room, mark => Array.contains(HIDING_MARKS, mark)),
    cases: piecesOf(room, CASE_MARK),
    trapCrates: piecesOf(room, TRAP_CRATE_MARK),
    cleats: Array.map(
      marksOf(room, mark => mark === CLEAT_MARK),
      ({ tile }) => tile,
    ),
    tools: Array.map(
      marksOf(room, mark => mark === TOOL_MARK),
      ({ tile }) => tile,
    ),
  }))
