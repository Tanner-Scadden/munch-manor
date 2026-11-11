// The Rooms tab's rooms: the manor with the kitchen shut or open, and the
// escape's drafted rooms (./draftRooms.ts) with their twist either way; each
// one's baked image and the box it covers, shared by the view and the note's
// picture.
import { Array, Option, Schema, String } from 'effect'
import type { Canvas } from 'foldkit'

import { boundsOf } from '../../src/art/sprite'
import { roomShapes } from '../../src/render/room/room'
import { TILE_SIZE } from '../../src/shared/constants'
import {
  type Level,
  levelFor as levelOfSpec,
  symbolAt,
} from '../../src/world/level/arena'
import { ARRANGEMENTS, manorSpecFor } from '../../src/world/level/plan'
import type { Bounds } from './catalog'
import { DRAFT_ROOMS, DRAFT_ROOM_SOURCE, draftRoomShapes } from './draftRooms'
import type { Pin, Tile, TileArea } from './notes'

export const StudioRoom = Schema.Literals([
  'Manor',
  'Dining',
  'Library',
  'Cellar',
])
export type StudioRoom = typeof StudioRoom.Type

const ROOM_PREFIX = 'room/'

// NOTE: a room note's target names its room, so the inbox and the notes
// find the room again.
export const roomTargetOf = (room: StudioRoom): string =>
  `${ROOM_PREFIX}${room}`

export const roomOfTarget = (targetId: string): Option.Option<StudioRoom> =>
  Array.findFirst(StudioRoom.literals, room => roomTargetOf(room) === targetId)

export const isRoomTarget = (targetId: string): boolean =>
  String.startsWith(ROOM_PREFIX)(targetId)

export const roomTitleOf = (room: StudioRoom): string =>
  room === 'Manor' ? 'The manor' : DRAFT_ROOMS[room].title

export const roomSourceOf = (room: StudioRoom): string =>
  room === 'Manor'
    ? 'the map: src/world/level/arena.ts; the art: src/render/room/'
    : DRAFT_ROOM_SOURCE

// NOTE: the toggle a room shows in the sidebar: the manor's kitchen, or a
// drafted room's twist; none for a room without one.
export type RoomToggle = Readonly<{ label: string; off: string; on: string }>

export const roomToggleOf = (room: StudioRoom): Option.Option<RoomToggle> =>
  room === 'Manor'
    ? Option.some({ label: 'Kitchen', off: 'Boarded', on: 'Open' })
    : DRAFT_ROOMS[room].maybeTwist

// NOTE: the manor in one of its rolled arrangements, its kitchen shut or
// open. Notes read the map letters off the first, the default house.
const manorOf = (house: number, isKitchenOpen: boolean): Level =>
  levelOfSpec(
    manorSpecFor(
      Option.getOrElse(Array.get(ARRANGEMENTS, house), () =>
        Array.headNonEmpty(ARRANGEMENTS),
      ),
    ),
    isKitchenOpen ? ['Kitchen'] : [],
  )

const OPEN_MANOR = manorOf(0, true)

const initialOf = (room: string): string => String.slice(0, 1)(room)

// NOTE: the House picker's choices: the slot rooms west, east, and far by
// their first letters.
export const HOUSES: ReadonlyArray<Readonly<{ house: number; label: string }>> =
  Array.map(ARRANGEMENTS, ({ West, East, Far }, house) => ({
    house,
    label: `${initialOf(West)}${initialOf(East)}${initialOf(Far)}`,
  }))

export type RoomFrame = Readonly<{
  shapes: ReadonlyArray<Canvas.Shape>
  bounds: Bounds
}>

const wholeBounds = (bounds: Bounds): Bounds => ({
  left: Math.floor(bounds.left),
  top: Math.floor(bounds.top),
  right: Math.ceil(bounds.right),
  bottom: Math.ceil(bounds.bottom),
})

// NOTE: what the Rooms tab shows: which room, and its toggle.
export type RoomView = Readonly<{
  room: StudioRoom
  isKitchenOpen: boolean
  house: number
  isTwistOn: boolean
}>

export const isToggleOn = (view: RoomView): boolean =>
  view.room === 'Manor' ? view.isKitchenOpen : view.isTwistOn

export const roomFrameOf = (view: RoomView): RoomFrame => {
  const shapes =
    view.room === 'Manor'
      ? roomShapes(manorOf(view.house, view.isKitchenOpen))
      : draftRoomShapes(DRAFT_ROOMS[view.room], view.isTwistOn)
  return { shapes, bounds: wholeBounds(boundsOf(shapes)) }
}

export const tileOfPin = (pin: Pin): Tile => ({
  column: Math.floor(pin.x / TILE_SIZE),
  row: Math.floor(pin.y / TILE_SIZE),
})

// NOTE: the tiles between where a drag began and where it is now.
export const areaBetween =
  (from: Tile) =>
  (to: Tile): TileArea => ({
    left: Math.min(from.column, to.column),
    top: Math.min(from.row, to.row),
    right: Math.max(from.column, to.column),
    bottom: Math.max(from.row, to.row),
  })

export const areaOfTile = (tile: Tile): TileArea => areaBetween(tile)(tile)

export const areaWidth = (area: TileArea): number => area.right - area.left + 1

export const areaHeight = (area: TileArea): number => area.bottom - area.top + 1

const mapLetterAt =
  (room: StudioRoom) =>
  (column: number, row: number): string =>
    room === 'Manor'
      ? Option.getOrElse(symbolAt(OPEN_MANOR, column, row), () => ' ')
      : Option.getOrElse(
          Option.flatMap(Array.get(DRAFT_ROOMS[room].map, row), line =>
            String.at(column)(line),
          ),
          () => ' ',
        )

// NOTE: the map's letters under an area, a row of text for each row of
// tiles: the manor's read with the kitchen open (boards or not, the map
// letters are the same), a drafted room's as drafted.
export const mapRowsOf =
  (room: StudioRoom) =>
  (area: TileArea): ReadonlyArray<string> =>
    Array.map(Array.range(area.top, area.bottom), row =>
      Array.join(
        Array.map(Array.range(area.left, area.right), column =>
          mapLetterAt(room)(column, row),
        ),
        '',
      ),
    )

// NOTE: the room's picture for a note: the area and this many world pixels
// around it, in the canvas's own pixels; the whole room with no area.
const CROP_MARGIN = 40

export type Crop = Readonly<{
  x: number
  y: number
  width: number
  height: number
}>

export const cropAround =
  ({ bounds, zoom }: Readonly<{ bounds: Bounds; zoom: number }>) =>
  (area: TileArea): Crop => {
    const left = Math.max(bounds.left, area.left * TILE_SIZE - CROP_MARGIN)
    const top = Math.max(bounds.top, area.top * TILE_SIZE - CROP_MARGIN)
    const right = Math.min(
      bounds.right,
      (area.right + 1) * TILE_SIZE + CROP_MARGIN,
    )
    const bottom = Math.min(
      bounds.bottom,
      (area.bottom + 1) * TILE_SIZE + CROP_MARGIN,
    )
    return {
      x: (left - bounds.left) * zoom,
      y: (top - bounds.top) * zoom,
      width: (right - left) * zoom,
      height: (bottom - top) * zoom,
    }
  }
