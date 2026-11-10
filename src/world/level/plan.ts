// The house plans: each room's map, where it sits on the plan, and the level
// specs a run plays, put together from them. src/world/level/arena.ts builds
// a Level from a spec.

import { Array, Option, Result, String, pipe } from 'effect'

import { TILE_SIZE } from '../../shared/constants'
import type {
  Arrangement,
  DoorId,
  ExitId,
  LevelState,
  SlotRoomId,
  Vector,
} from '../schema/entitySchema'

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
// door at the K tiles. On the house's plan its rows sit above the parlour's,
// so they are world rows -15 to -1. The yard east of it, the commas, is
// outside the house: the way to the parlour's north door. Zombies walk the
// yard, the player never does, and nothing out there is drawn. `c` on the
// west wall and `t` by the east wall mark its display case and trap crate.
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
  '#c.................#,,,,,,,,,,,,',
  '#RR...~~...........#,,,,,,,,,,,,',
  '#....~~~...........#,,,,,,,,,,,,',
  '#...............t..#,,,,,,,,,,,,',
  '#..................#,,,,,,,,,,,,',
]

export const KITCHEN_TOP_ROW = -KITCHEN_MAP.length

// NOTE: the dining room, where every run starts (docs/ROOM_DRAFTS.md): the
// Munches' party table in two halves with the chandelier's gap between
// them, the sideboard, china cabinets, and candelabras, Rattles on his
// trunk in the south east (`$`), and the chained front door in the south wall. Its four spawn
// doors keep the parlour's names, North top right through the yard, West
// top left, East bottom right, and South bottom left, so the wave tables
// draw what they always drew. The map is the draft's, review marks and all:
// the room's renames below turn them into the engine's letters.
const DINING_MAP: ReadonlyArray<string> = [
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
  '#.......=========^^=========.......#',
  '#.......=========^^=========.......#',
  '<..................................#',
  '<..................................?',
  '#..........i.....@@.....i..........?',
  '#cc.......................$$.....cc#',
  '#.........................$$.......#',
  '?..................................#',
  '?............i........i............E',
  '#HH...............................4E',
  '#HH......tt......................HH#',
  '#####SS#########MMMM################',
]

// NOTE: the parlour fitted to a slot of the house (docs/ROOM_DRAFTS.md):
// ROOM_MAP changed only at its edges. The kitchen hangs off the dining room
// now, so its boards are wall; the side doors are the slot's ports, `(` and
// `)`; `n` and `s` are the slot's two spawn doors; the stall and its crates
// became display case and trap crate spots; rows 13 and 14 of the side walls
// are `?`, for a library next door. The hearth stays, for the gas valve.
const PARLOUR_SLOT_MAP: ReadonlyArray<string> = [
  '#####################nn#########',
  '#####################nn#########',
  '#PPP..........FFFF........BBBBB#',
  '#PPP1.......................2..#',
  '#..........A........A..........#',
  '#...TT.....A........A......TT..#',
  '#...TT.....................TT..#',
  '#..............................#',
  '(..............................)',
  '(..............................)',
  '#..............................#',
  '#...O3.....................VV..#',
  '#...O........CCCCCC........VV..#',
  '?..............................?',
  '?.........UU4..................?',
  '#..............................#',
  '#cc.................tt.....cc..#',
  '########ss######################',
]

// NOTE: the library (docs/ROOM_DRAFTS.md): stacks of double-sided shelves,
// `B` drawn as the stacks here, with two tile aisles, above and below the
// reading desk `d` on the cross aisle, and the globe `g`. The lower stacks
// run into the south wall as bays, with the cases and the trap crate at
// their backs. `%` in rows 13 and 14 of each side wall is the secret shelf;
// only the one facing the room it is entered from swings.
export const LIBRARY_MAP: ReadonlyArray<string> = [
  '##############nn################',
  '##############nn################',
  '#..............................#',
  '#..............................#',
  '#..BB..BB..BB......BB..BB..BB..#',
  '#..BB..BB..BB...g..BB..BB..BB..#',
  '#..BB..BB..BB..1...BB..BB..BB2.#',
  '#..............................#',
  '(..............................)',
  '(..............................)',
  '#...........dddddddd...........#',
  '#..........3dddddddd...........#',
  '#..............................#',
  '%..............................%',
  '%..BB..BB..BB......BB..BB..BB..%',
  '#..BB..BB..BB......BB..BB..BB..#',
  '#..BBccBBttBB......BB4.BBccBB..#',
  '################ss##############',
]

// NOTE: the cellar (docs/ROOM_DRAFTS.md): long wine racks `]` in rows,
// broken by gaps, round a block of barrels `o` with the trap crate on top.
// `n` is the coal chute, `s` the storm doors.
export const CELLAR_MAP: ReadonlyArray<string> = [
  '#####nn#########################',
  '#####nn#########################',
  '#.....4........................#',
  '#..............................#',
  '#..]]]]]]]]..]]]]]]..]]]]]]]]..#',
  '#...........................2..#',
  '#..............................#',
  '#..]]]]]]]]....tt....]]]]]]]]..#',
  '(.............oooo.............)',
  '(.............oooo1............)',
  '#..]]]]]]]]...oooo...]]]]]]]]..#',
  '#.............oooo.............#',
  '#..............................#',
  '?..............................?',
  '?..]]]]]]]]..]]]]]]..]]]]]]]]..?',
  '#..........................3...#',
  '#cc..........................cc#',
  '#######################ss#######',
]

// NOTE: the review marks every drafted map shares: the hidden-item spots,
// the display case and trap crate spots (`c` and `t`, where the World's
// cases and crates stand, src/world/feats/cases.ts and
// src/world/gear/crates.ts), and the start spot are floor, and a secret
// shelf's wall is wall unless the house swings it (secretShelfOf below).
const REVIEW_MARKS: Readonly<Record<string, string>> = {
  c: '.',
  t: '.',
  '1': '.',
  '2': '.',
  '3': '.',
  '4': '.',
  '@': '.',
  '?': '#',
  '%': '#',
}

// NOTE: the start spot drawn on a map, `@`.
const START_SYMBOL = '@'

// NOTE: the gap in the party table under the chandelier, `^`: floor while
// the chandelier hangs, solid while it lies fallen there.
export const CHANDELIER_SYMBOL = '^'

// NOTE: the dining room's own drop, its chandelier: the id the level state
// lists while it lies in the gap (src/world/dining/chandelier.ts).
export const CHANDELIER_DROP = 'Chandelier'

// NOTE: a drafted map's secret shelf, `%`, and the plain wall a library
// next door can swing open, `?`. The one that swings is rewritten to
// SECRET_SYMBOL, the secret exit's own symbol, on both sides of the wall.
const SHELF_MARK = '%'
const SWINGABLE_MARK = '?'
export const SECRET_SYMBOL = '&'

// SPECS

// NOTE: what opens an exit: Boards are bought open with money (keys in a
// later layer), a Shelf swings when a player pulls its book
// (src/world/library/secretShelf.ts) and is never for sale.
export type ExitOpener = 'Boards' | 'Shelf'

// NOTE: an exit is a doorway drawn on the map with its own symbol. While it
// is closed its tiles are solid and the doors behind it stay shut. Opening
// it makes its tiles floor and adds its doors to the spawn doors. `requires`
// lists the exits that must be open before it can be: the far slot's boards
// stand in the east room, and the secret shelf in the library.
type ExitSpec = Readonly<{
  id: ExitId
  symbol: string
  doors: ReadonlyArray<DoorId>
  opener: ExitOpener
  requires: ReadonlyArray<ExitId>
}>

// NOTE: a drop is a piece of the room that can fall into its floor and lie
// there as cover: its tiles are floor until the level state lists its id in
// `dropped`, then solid. The dining room's chandelier is the one there is.
type DropSpec = Readonly<{ id: string; symbol: string }>

// NOTE: a room is its own block of the map, placed on the house's plan by
// the world column and row of its top-left tile, so a room can sit west of,
// east of, above, or below the start. Its block is also what the camera may
// show of it. One behind an exit counts only once that exit is open, so the
// camera never scrolls onto a room the player cannot reach. renames turns
// the room's own letters into the level's where it is placed, so one room's
// map can stand in any slot: a slot room's spawn doors drawn as neutral
// letters become that slot's door symbols.
export type RoomSpec = Readonly<{
  id: string
  tiles: ReadonlyArray<string>
  origin: Readonly<{ column: number; row: number }>
  maybeExit: Option.Option<ExitId>
  renames: Readonly<Record<string, string>>
}>

// NOTE: a level is its rooms on the plan, the exits between them, what can
// drop in them, and the spot in world pixels where a run starts.
export type LevelSpec = Readonly<{
  id: string
  rooms: Array.NonEmptyReadonlyArray<RoomSpec>
  exits: ReadonlyArray<ExitSpec>
  drops: ReadonlyArray<DropSpec>
  start: Vector
}>

// NOTE: the room ids, which each room's hand-placed art looks for.
export const PARLOUR_ROOM_ID = 'Parlour'
export const DINING_ROOM_ID = 'Dining'
export const KITCHEN_ROOM_ID = 'Kitchen'
export const LIBRARY_ROOM_ID = 'Library'
export const CELLAR_ROOM_ID = 'Cellar'

// NOTE: the parlour as it stood before the dining room was built, on its
// own level (PARLOUR_SPEC), for tests and tools that need its shape.
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

// THE SLOTS

// NOTE: the three rooms that stand in the house's slots (SlotRoomId), each
// drafted to the slot footprint (32 by 18 tiles, ports in rows 8 and 9,
// spawn doors `n` and `s`, a shelf or a swingable wall in rows 13 and 14 of
// each side). Each run rolls which stands where (rollArrangement).
// NOTE: each room's own letters turned into the level's: the library's
// stacks are `b`, since `B` is the parlour's bookshelf.
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

// NOTE: every slot's spawn doors' symbols. The west slot's are the maps' own
// `n` and `s`; a room in another slot has them renamed to its slot's.
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

// NOTE: the far slot's boards stand in the east room's east port.
const FAR_EXIT_SYMBOL = '}'

// NOTE: a slot, all slot-relative: where it sits on the plan, the exit that
// opens it and that exit's symbol, its spawn doors, what its room's two
// ports become (the one toward the room it is entered from is floor behind
// the boards, one facing outside is wall, and the east slot's east port is
// the far slot's boards), and the side wall that faces the room it is
// entered from, where a library's shelf swings.
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

// NOTE: the west slot hangs off the dining room's west wall, its bottom
// row level with the dining room's, so the dining room keeps outside wall
// for its West door above it; the east slots hang off the top of its east
// wall, so it keeps outside wall for its East door below (the pinwheel).
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

// NOTE: the slot an exit's boards open, if they open one (the kitchen's and
// the secret shelf's do not).
export const slotOfExit = (exit: ExitId): Option.Option<SlotId> =>
  Array.findFirst(SLOT_IDS, slot => SLOTS[slot].exit === exit)

const opposite = (side: Side): Side => (side === 'West' ? 'East' : 'West')

// NOTE: a map with one symbol in its west or east wall column rewritten.
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

// NOTE: where the secret shelf swings in an arrangement: the library's slot,
// the side wall it swings in, and the room on the other side of that wall
// (the dining room, or the east room for a library in the far slot).
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

// NOTE: a map with its swinging shelf, or its neighbour's swingable wall
// facing it, rewritten to the secret exit's symbol; every other `%` and `?`
// stays wall (REVIEW_MARKS).
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

// NOTE: the middle of a map's block, where a run in it starts.
export const middleOf = (tiles: ReadonlyArray<string>): Vector => ({
  x: (widthOf(tiles) * TILE_SIZE) / 2,
  y: (tiles.length * TILE_SIZE) / 2,
})

// NOTE: the middle of the tiles a room marks with a symbol, in world pixels,
// or the middle of the room when it marks none.
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

// NOTE: the parlour on its own, the way every run saw it before the kitchen
// was built. Tests and tools that only need the parlour's shape use it. Its
// boarded double door holds no door shut, since no room stands behind it.
export const PARLOUR_SPEC: LevelSpec = {
  id: 'Parlour',
  rooms: [PARLOUR_ROOM],
  exits: [
    { id: 'Kitchen', symbol: 'K', doors: [], opener: 'Boards', requires: [] },
  ],
  drops: [],
  start: middleOf(ROOM_MAP),
}

// NOTE: the house for an arrangement of the slot rooms: the dining room,
// the kitchen behind its boarded double door to the north, a slot room
// behind the boards in each side wall and one more behind the east room's,
// and the library's secret shelf. Each exit's spawn doors stay shut until
// it opens. A run starts at the table, on the start spot.
const buildManorSpec = (arrangement: Arrangement): LevelSpec => {
  const maybeShelf = secretShelfOf(arrangement)
  const dining: RoomSpec = {
    id: DINING_ROOM_ID,
    tiles: withShelf(DINING_MAP, 'Dining', maybeShelf),
    origin: { column: 0, row: 0 },
    maybeExit: Option.none(),
    renames: REVIEW_MARKS,
  }
  // NOTE: the east room's own swingable wall faces a library in the far
  // slot, so the slot rooms are built with the shelf known.
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
    drops: [{ id: CHANDELIER_DROP, symbol: CHANDELIER_SYMBOL }],
    start: spotOf(dining, START_SYMBOL),
  }
}

// THE ROLL

const arrangementKeyOf = (arrangement: Arrangement): string =>
  `${arrangement.West}-${arrangement.East}-${arrangement.Far}`

// NOTE: every way the three rooms stand in the three slots, in a fixed
// order, so a roll picks the same one in every engine.
export const ARRANGEMENTS: Array.NonEmptyReadonlyArray<Arrangement> = [
  { West: PARLOUR_ROOM_ID, East: LIBRARY_ROOM_ID, Far: CELLAR_ROOM_ID },
  { West: PARLOUR_ROOM_ID, East: CELLAR_ROOM_ID, Far: LIBRARY_ROOM_ID },
  { West: LIBRARY_ROOM_ID, East: PARLOUR_ROOM_ID, Far: CELLAR_ROOM_ID },
  { West: LIBRARY_ROOM_ID, East: CELLAR_ROOM_ID, Far: PARLOUR_ROOM_ID },
  { West: CELLAR_ROOM_ID, East: PARLOUR_ROOM_ID, Far: LIBRARY_ROOM_ID },
  { West: CELLAR_ROOM_ID, East: LIBRARY_ROOM_ID, Far: PARLOUR_ROOM_ID },
]

// NOTE: the house the tests, tools, and the home screen's World stand in:
// the parlour west, the library east, the cellar beyond it.
export const DEFAULT_ARRANGEMENT: Arrangement = Array.headNonEmpty(ARRANGEMENTS)

// NOTE: the arrangement a roll in [0, 1) picks, one of the six alike.
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

// NOTE: one spec for each arrangement, built once, so a level, its flow
// field, and its room images are kept per arrangement and never rebuilt.
const MANOR_SPECS: ReadonlyMap<string, LevelSpec> = new Map(
  Array.map(ARRANGEMENTS, arrangement => [
    arrangementKeyOf(arrangement),
    buildManorSpec(arrangement),
  ]),
)

export const manorSpecFor = (arrangement: Arrangement): LevelSpec =>
  MANOR_SPECS.get(arrangementKeyOf(arrangement)) ?? buildManorSpec(arrangement)

export const MANOR_SPEC: LevelSpec = manorSpecFor(DEFAULT_ARRANGEMENT)

// NOTE: every level a run or a test can stand in: the parlour alone and
// the manor in each arrangement, for the sprite atlas and the tests.
export const EVERY_LEVEL_SPEC: ReadonlyArray<LevelSpec> = [
  PARLOUR_SPEC,
  ...Array.map(ARRANGEMENTS, arrangement => manorSpecFor(arrangement)),
]

// NOTE: the spec a level state names: the manor as its slots stand, or
// the parlour on its own.
export const specOfState = (state: LevelState): LevelSpec =>
  state.id === 'Manor' ? manorSpecFor(state.arrangement) : PARLOUR_SPEC

// HOUSE SPOTS

// NOTE: the drafted maps' review marks as data, for the cases and the dare
// (layers 12 and on of docs/ESCAPE_PLAN.md) to read: each room's hidden-item
// spots (`1` to `4`, stand there to search what is beside you), its display
// cases (`c`, two tiles against a wall), and its trap crate (`t`), in world
// tiles. The marks are read off the room's own map, before its renames.
export type SpotTile = Readonly<{ column: number; row: number }>

export type RoomSpots = Readonly<{
  room: string
  hiding: ReadonlyArray<Readonly<{ mark: string; tile: SpotTile }>>
  cases: ReadonlyArray<ReadonlyArray<SpotTile>>
  trapCrates: ReadonlyArray<ReadonlyArray<SpotTile>>
}>

const HIDING_MARKS: ReadonlyArray<string> = ['1', '2', '3', '4']
const CASE_MARK = 'c'
const TRAP_CRATE_MARK = 't'

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

// NOTE: a mark's tiles in runs along a row, one run for each piece.
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
  }))
