// The house plans: each room's map, where it sits on the plan, and the level
// specs a run plays, put together from them. src/world/level/arena.ts builds
// a Level from a spec.

import { Array, Option, Result, String } from 'effect'

import { TILE_SIZE } from '../../shared/constants'
import type { DoorId, ExitId, LevelId, Vector } from '../schema/entitySchema'

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
// yard, the player never does, and nothing out there is drawn.
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

// NOTE: the parlour fitted to the house's west slot (docs/ROOM_DRAFTS.md):
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

// NOTE: the review marks every drafted map shares: the hidden-item spots,
// the display case and trap crate spots (`c` and `t`, where the World's
// cases and crates stand, src/world/feats/cases.ts and
// src/world/gear/crates.ts), and the start spot are floor, and the secret
// shelf's wall is wall until the library's layer swings it.
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

// NOTE: the west slot's place on the plan: hung off the dining room's west
// wall, its bottom row level with the dining room's, so the dining room
// keeps outside wall for its West door above it (the pinwheel).
const WEST_SLOT_ORIGIN = { column: -32, row: 4 }

// SPECS

// NOTE: an exit is a boarded doorway drawn on the map with its own symbol.
// While it is closed its tiles are solid and the doors behind it stay shut.
// Opening it makes its tiles floor and adds its doors to the spawn doors.
type ExitSpec = Readonly<{
  id: ExitId
  symbol: string
  doors: ReadonlyArray<DoorId>
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

// NOTE: the parlour as it stood before the dining room was built, on its
// own level (PARLOUR_SPEC), for tests and tools that need its shape.
const PARLOUR_ROOM: RoomSpec = {
  id: PARLOUR_ROOM_ID,
  tiles: ROOM_MAP,
  origin: { column: 0, row: 0 },
  maybeExit: Option.none(),
  renames: {},
}

const DINING_ROOM: RoomSpec = {
  id: DINING_ROOM_ID,
  tiles: DINING_MAP,
  origin: { column: 0, row: 0 },
  maybeExit: Option.none(),
  // NOTE: the east exit leads nowhere until the east slot is built (the
  // library and the cellar's layer), so it is wall for now.
  renames: { ...REVIEW_MARKS, '>': '#' },
}

const KITCHEN_ROOM: RoomSpec = {
  id: KITCHEN_ROOM_ID,
  tiles: KITCHEN_MAP,
  origin: { column: 0, row: KITCHEN_TOP_ROW },
  maybeExit: Option.some('Kitchen'),
  renames: {},
}

// NOTE: the west slot's exit, `<` in the dining room's west wall. The
// parlour's own port behind it is floor, so the exit is one wall thick, and
// its port that faces outside is wall.
export const WEST_EXIT: ExitId = 'West'

const PARLOUR_WEST_ROOM: RoomSpec = {
  id: PARLOUR_ROOM_ID,
  tiles: PARLOUR_SLOT_MAP,
  origin: WEST_SLOT_ORIGIN,
  maybeExit: Option.some(WEST_EXIT),
  // NOTE: the west slot's spawn doors are the map's own `n` and `s`
  // (WestTop and WestBottom); a room in another slot renames them to that
  // slot's.
  renames: { ...REVIEW_MARKS, '(': '#', ')': '.' },
}

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
  exits: [{ id: 'Kitchen', symbol: 'K', doors: [] }],
  drops: [],
  start: middleOf(ROOM_MAP),
}

// NOTE: the manor is the level a run plays: the dining room, the kitchen
// behind its boarded double door to the north, and the parlour behind the
// boards in its west wall. Each exit's spawn doors stay shut until the
// player buys it open. A run starts at the table, on the start spot.
export const MANOR_SPEC: LevelSpec = {
  id: 'Manor',
  rooms: [DINING_ROOM, KITCHEN_ROOM, PARLOUR_WEST_ROOM],
  exits: [
    { id: 'Kitchen', symbol: 'K', doors: ['Back', 'Window'] },
    { id: WEST_EXIT, symbol: '<', doors: ['WestTop', 'WestBottom'] },
  ],
  drops: [{ id: CHANDELIER_DROP, symbol: CHANDELIER_SYMBOL }],
  start: spotOf(DINING_ROOM, START_SYMBOL),
}

export const LEVEL_SPECS: Readonly<Record<LevelId, LevelSpec>> = {
  Parlour: PARLOUR_SPEC,
  Manor: MANOR_SPEC,
}
