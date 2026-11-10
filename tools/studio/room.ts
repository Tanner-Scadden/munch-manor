// The Rooms tab's level: the manor with the kitchen shut or open, its baked
// image, and the box it covers, shared by the view and the note's picture.
import { Array, Option } from 'effect'
import type { Canvas } from 'foldkit'

import { roomShapes } from '../../src/render/room/room'
import { TILE_SIZE } from '../../src/shared/constants'
import {
  type Level,
  MANOR,
  openExit,
  symbolAt,
} from '../../src/world/level/arena'
import { type Bounds, boundsOf } from './catalog'
import type { Pin, Tile, TileArea } from './notes'

export const ROOM_TARGET = 'room/Manor'

export const ROOM_TITLE = 'The manor'

export const ROOM_SOURCE =
  'the map: src/world/level/arena.ts; the art: src/render/room/'

const OPEN_MANOR = openExit(MANOR, 'Kitchen')

const levelFor = (isKitchenOpen: boolean): Level =>
  isKitchenOpen ? OPEN_MANOR : MANOR

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

export const roomFrameOf = (isKitchenOpen: boolean): RoomFrame => {
  const shapes = roomShapes(levelFor(isKitchenOpen))
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

// NOTE: the map's letters under an area, a row of text for each row of
// tiles, read off the manor with the kitchen open (boards or not, the map
// letters are the same).
export const mapRowsOf = (area: TileArea): ReadonlyArray<string> =>
  Array.map(Array.range(area.top, area.bottom), row =>
    Array.join(
      Array.map(Array.range(area.left, area.right), column =>
        Option.getOrElse(symbolAt(OPEN_MANOR, column, row), () => ' '),
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
