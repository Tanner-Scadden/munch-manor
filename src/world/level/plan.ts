// The house plans: each room's map, where it sits on the plan, and the level
// specs a run plays, put together from them. src/world/level/arena.ts builds
// a Level from a spec.

import { Array, Option, String } from 'effect'

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

// SPECS

// NOTE: an exit is a boarded doorway drawn on the map with its own symbol.
// While it is closed its tiles are solid and the doors behind it stay shut.
// Opening it makes its tiles floor and adds its doors to the spawn doors.
type ExitSpec = Readonly<{
  id: ExitId
  symbol: string
  doors: ReadonlyArray<DoorId>
}>

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

// NOTE: a level is its rooms on the plan, the exits between them, and the
// spot in world pixels where a run starts.
export type LevelSpec = Readonly<{
  id: string
  rooms: Array.NonEmptyReadonlyArray<RoomSpec>
  exits: ReadonlyArray<ExitSpec>
  start: Vector
}>

// NOTE: the parlour's room id, which its hand-placed art looks for.
export const PARLOUR_ROOM_ID = 'Parlour'

const PARLOUR_ROOM: RoomSpec = {
  id: PARLOUR_ROOM_ID,
  tiles: ROOM_MAP,
  origin: { column: 0, row: 0 },
  maybeExit: Option.none(),
  renames: {},
}

const KITCHEN_ROOM: RoomSpec = {
  id: 'Kitchen',
  tiles: KITCHEN_MAP,
  origin: { column: 0, row: KITCHEN_TOP_ROW },
  maybeExit: Option.some('Kitchen'),
  renames: {},
}

export const widthOf = (tiles: ReadonlyArray<string>): number =>
  Option.match(Array.head(tiles), { onNone: () => 0, onSome: String.length })

// NOTE: the middle of a map's block, where a run in it starts.
export const middleOf = (tiles: ReadonlyArray<string>): Vector => ({
  x: (widthOf(tiles) * TILE_SIZE) / 2,
  y: (tiles.length * TILE_SIZE) / 2,
})

// NOTE: the parlour on its own, the way every run saw it before the kitchen
// was built. Tests and tools that only need the parlour's shape use it. Its
// boarded double door holds no door shut, since no room stands behind it.
export const PARLOUR_SPEC: LevelSpec = {
  id: 'Parlour',
  rooms: [PARLOUR_ROOM],
  exits: [{ id: 'Kitchen', symbol: 'K', doors: [] }],
  start: middleOf(ROOM_MAP),
}

// NOTE: the manor is the level a run plays: the parlour, and the kitchen
// behind its boarded double door. The kitchen's back door and broken window
// stay shut until the player buys the exit open. A run starts in the middle
// of the parlour.
export const MANOR_SPEC: LevelSpec = {
  id: 'Manor',
  rooms: [PARLOUR_ROOM, KITCHEN_ROOM],
  exits: [{ id: 'Kitchen', symbol: 'K', doors: ['Back', 'Window'] }],
  start: middleOf(ROOM_MAP),
}

export const LEVEL_SPECS: Readonly<Record<LevelId, LevelSpec>> = {
  Parlour: PARLOUR_SPEC,
  Manor: MANOR_SPEC,
}
