import { Array, Option, Schema, String } from 'effect'

import { boundsOf } from '../../src/art/sprite'
import type * as Draw from '../../src/render/draw'
import { roomShapes } from '../../src/render/room/room'
import { TILE_SIZE } from '../../src/shared/constants'
import {
  type Level,
  levelFor as levelOfSpec,
} from '../../src/world/level/arena'
import { ARRANGEMENTS, manorSpecFor } from '../../src/world/level/plan'
import { symbolAt } from '../../src/world/level/tileGrid'
import type { Bounds } from './catalog'
import { DRAFT_ROOMS, DRAFT_ROOM_SOURCE, draftRoomShapes } from './draftRooms'
import type { Pin, Tile, TileArea } from './notes'

export const StudioRoom = Schema.Literals([
  'Live',
  'Manor',
  'Dining',
  'Parlour',
  'Library',
  'Cellar',
])
export type StudioRoom = typeof StudioRoom.Type

const ROOM_PREFIX = 'room/'

export const roomTargetOf = (room: StudioRoom): string =>
  `${ROOM_PREFIX}${room}`

export const roomOfTarget = (targetId: string): Option.Option<StudioRoom> =>
  Array.findFirst(StudioRoom.literals, room => roomTargetOf(room) === targetId)

export const isRoomTarget = (targetId: string): boolean =>
  String.startsWith(ROOM_PREFIX)(targetId)

export const roomTitleOf = (room: StudioRoom): string =>
  room === 'Live'
    ? 'The manor, live in 3D'
    : room === 'Manor'
      ? 'The manor'
      : DRAFT_ROOMS[room].title

export const roomSourceOf = (room: StudioRoom): string =>
  room === 'Live'
    ? 'the 3D renderer: src/render/iso/; the room art: src/render/room/; the map: src/world/level/arena.ts'
    : room === 'Manor'
      ? 'the map: src/world/level/arena.ts; the art: src/render/room/'
      : DRAFT_ROOM_SOURCE

export type RoomToggle = Readonly<{ label: string; off: string; on: string }>

export const roomToggleOf = (room: StudioRoom): Option.Option<RoomToggle> =>
  room === 'Live'
    ? Option.none()
    : room === 'Manor'
      ? Option.some({ label: 'Kitchen', off: 'Boarded', on: 'Open' })
      : DRAFT_ROOMS[room].maybeTwist

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

export const HOUSES: ReadonlyArray<Readonly<{ house: number; label: string }>> =
  Array.map(ARRANGEMENTS, ({ West, East, Far }, house) => ({
    house,
    label: `${initialOf(West)}${initialOf(East)}${initialOf(Far)}`,
  }))

export type RoomFrame = Readonly<{
  shapes: ReadonlyArray<Draw.Shape>
  bounds: Bounds
}>

const wholeBounds = (bounds: Bounds): Bounds => ({
  left: Math.floor(bounds.left),
  top: Math.floor(bounds.top),
  right: Math.ceil(bounds.right),
  bottom: Math.ceil(bounds.bottom),
})

export type RoomView = Readonly<{
  room: StudioRoom
  isKitchenOpen: boolean
  house: number
  isTwistOn: boolean
}>

export const isToggleOn = (view: RoomView): boolean =>
  view.room === 'Manor' || view.room === 'Live'
    ? view.isKitchenOpen
    : view.isTwistOn

export const roomFrameOf = (view: RoomView): RoomFrame => {
  const shapes =
    view.room === 'Manor' || view.room === 'Live'
      ? roomShapes(manorOf(view.house, view.isKitchenOpen))
      : draftRoomShapes(DRAFT_ROOMS[view.room], view.isTwistOn)
  return { shapes, bounds: wholeBounds(boundsOf(shapes)) }
}

export const tileOfPin = (pin: Pin): Tile => ({
  column: Math.floor(pin.x / TILE_SIZE),
  row: Math.floor(pin.y / TILE_SIZE),
})

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
    room === 'Manor' || room === 'Live'
      ? Option.getOrElse(symbolAt(OPEN_MANOR, column, row), () => ' ')
      : Option.getOrElse(
          Option.flatMap(Array.get(DRAFT_ROOMS[room].map, row), line =>
            String.at(column)(line),
          ),
          () => ' ',
        )

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
