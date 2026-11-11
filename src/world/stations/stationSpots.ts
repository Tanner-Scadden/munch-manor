import { Array, Function, Option, pipe } from 'effect'

import { TILE_SIZE } from '../../shared/constants'
import {
  type Box,
  type Level,
  boxCenter,
  maybeExit,
  tileBox,
} from '../level/arena'
import {
  CELLAR_ROOM_ID,
  DINING_ROOM_ID,
  KITCHEN_ROOM_ID,
  LIBRARY_ROOM_ID,
  type LevelSpec,
  PARLOUR_ROOM_ID,
  type RoomSpots,
  SECRET_EXIT,
  type SpotTile,
  roomSpotsOf,
} from '../level/plan'
import { secretShelfOf } from '../library/secretShelf'
import type { StationId } from '../schema/worldSchema'

// Where each work station stands on a level, read off the rooms' maps: the
// cleat's `j` in the dining room's wall, and each other room's `*` marks in
// reading order (src/world/level/plan.ts): the parlour's gramophone, the
// library's north and south stacks, the cellar's bulb chain then its
// barrels, the kitchen's soup pot. The revolving shelf is the library's
// secret shelf, its two tiles in the wall. A spec keeps its boxes, so a
// frame only reads them.

type MarkedSpot = Readonly<{
  room: string
  pick: (spots: RoomSpots) => ReadonlyArray<SpotTile>
  index: number
}>

const MARKED_SPOTS: Readonly<Record<Exclude<StationId, 'Shelf'>, MarkedSpot>> =
  {
    Cleat: { room: DINING_ROOM_ID, pick: ({ cleats }) => cleats, index: 0 },
    Gramophone: {
      room: PARLOUR_ROOM_ID,
      pick: ({ tools }) => tools,
      index: 0,
    },
    NorthStack: {
      room: LIBRARY_ROOM_ID,
      pick: ({ tools }) => tools,
      index: 0,
    },
    SouthStack: {
      room: LIBRARY_ROOM_ID,
      pick: ({ tools }) => tools,
      index: 1,
    },
    Bulb: { room: CELLAR_ROOM_ID, pick: ({ tools }) => tools, index: 0 },
    Barrels: { room: CELLAR_ROOM_ID, pick: ({ tools }) => tools, index: 1 },
    SoupPot: { room: KITCHEN_ROOM_ID, pick: ({ tools }) => tools, index: 0 },
  }

const markedBox = (
  spec: LevelSpec,
  { room, pick, index }: MarkedSpot,
): Option.Option<Box> =>
  pipe(
    Array.findFirst(roomSpotsOf(spec), spots => spots.room === room),
    Option.flatMap(spots => Array.get(pick(spots), index)),
    Option.map(tileBox),
  )

const markedBoxes = new WeakMap<
  LevelSpec,
  Readonly<Record<Exclude<StationId, 'Shelf'>, Option.Option<Box>>>
>()

const markedBoxesOf = (
  spec: LevelSpec,
): Readonly<Record<Exclude<StationId, 'Shelf'>, Option.Option<Box>>> => {
  const cached = markedBoxes.get(spec)
  if (cached !== undefined) {
    return cached
  }
  const boxes = {
    Cleat: markedBox(spec, MARKED_SPOTS.Cleat),
    Gramophone: markedBox(spec, MARKED_SPOTS.Gramophone),
    NorthStack: markedBox(spec, MARKED_SPOTS.NorthStack),
    SouthStack: markedBox(spec, MARKED_SPOTS.SouthStack),
    Bulb: markedBox(spec, MARKED_SPOTS.Bulb),
    Barrels: markedBox(spec, MARKED_SPOTS.Barrels),
    SoupPot: markedBox(spec, MARKED_SPOTS.SoupPot),
  }
  markedBoxes.set(spec, boxes)
  return boxes
}

// NOTE: the secret shelf's two tiles in the library's wall.
const shelfBox = (level: Level): Option.Option<Box> =>
  Option.map(secretShelfOf(level), ({ tile }) => ({
    left: tile.column * TILE_SIZE,
    top: tile.row * TILE_SIZE,
    right: (tile.column + 1) * TILE_SIZE,
    bottom: (tile.row + 2) * TILE_SIZE,
  }))

export const stationBoxOf: {
  (id: StationId): (level: Level) => Option.Option<Box>
  (level: Level, id: StationId): Option.Option<Box>
} = Function.dual(2, (level: Level, id: StationId): Option.Option<Box> =>
  id === 'Shelf' ? shelfBox(level) : markedBoxesOf(level.spec)[id],
)

// NOTE: a station stands where the crew can reach it: in an open room, and
// the shelf once it has swung open.
export const isStationOpen: {
  (id: StationId): (level: Level) => boolean
  (level: Level, id: StationId): boolean
} = Function.dual(2, (level: Level, id: StationId): boolean =>
  id === 'Shelf'
    ? Option.exists(maybeExit(level, SECRET_EXIT), ({ isOpen }) => isOpen)
    : Option.exists(stationBoxOf(level, id), box => {
        const { x, y } = boxCenter(box)
        return Array.some(
          level.rooms,
          room =>
            room.isOpen &&
            x >= room.box.left &&
            x < room.box.right &&
            y >= room.box.top &&
            y < room.box.bottom,
        )
      }),
)

// NOTE: where a station's tool acts from: the middle of its box.
export const stationCenterOf: {
  (
    id: StationId,
  ): (level: Level) => Option.Option<Readonly<{ x: number; y: number }>>
  (
    level: Level,
    id: StationId,
  ): Option.Option<Readonly<{ x: number; y: number }>>
} = Function.dual(2, (level: Level, id: StationId) =>
  Option.map(stationBoxOf(level, id), boxCenter),
)
