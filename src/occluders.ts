import { Array, Option, Result, pipe } from 'effect'
import { Canvas } from 'foldkit'

import { type Level, type Tile, isWalkableTile, tileIndex } from './arena'
import { TILE_SIZE } from './constants'
import { roomShapes } from './room'
import { FACE_TOP } from './roomPalette'

// NOTE: the room is one image on the floor canvas, under everything, but the
// wall face over a doorway in a top wall stands up off the floor. Something
// still in that doorway is behind the face, so its lintel and the wall
// beside it must cover it. Each such doorway gets an occluder: pieces of the
// same room image around the opening, drawn in the depth sort at the floor
// line, so anything whose feet are above the line draws first and is
// covered, and anything in the room draws over it. The opening below the
// lintel is left out, so what stands in the doorway shows through it.

export type Occluder = Readonly<{
  floorY: number
  left: number
  right: number
  shapes: ReadonlyArray<Canvas.Shape>
}>

// NOTE: the wall face over a top wall is two tiles tall, and the lintel
// runs from the face's top to two pixels below it.
const FACE_HEIGHT = TILE_SIZE * 2
const LINTEL_BOTTOM = FACE_TOP + 2
// NOTE: how far past the opening the wall covers, wide enough for the widest
// zombie standing in it, Uncle Chunk.
const BESIDE_PX = TILE_SIZE * 2

type Opening = Readonly<{ row: number; first: number; last: number }>

const isPassage = (level: Level, column: number, row: number): boolean =>
  level.doorTiles.has(tileIndex(level, column, row)) ||
  Array.some(
    level.exits,
    exit =>
      exit.isOpen &&
      Array.some(
        exit.tiles,
        (tile: Tile) => tile.column === column && tile.row === row,
      ),
  )

// NOTE: a doorway in a top wall is a passage tile, a door or an open exit,
// right above walkable floor that is not a passage too.
const isOpeningTile = (level: Level, column: number, row: number): boolean =>
  isWalkableTile(level, column, row) &&
  isPassage(level, column, row) &&
  isWalkableTile(level, column, row + 1) &&
  !isPassage(level, column, row + 1)

const NO_OPENINGS: ReadonlyArray<Opening> = []

const openingsOf = (level: Level): ReadonlyArray<Opening> =>
  Array.flatMap(
    Array.makeBy(level.rows, index => index + level.topRow),
    row =>
      Array.reduce(
        Array.makeBy(level.columns, column => column),
        NO_OPENINGS,
        (openings, column) => {
          if (!isOpeningTile(level, column, row)) {
            return openings
          }
          return pipe(
            Array.last(openings),
            Option.filter(last => last.last === column - 1),
            Option.match({
              onNone: () =>
                Array.append(openings, { row, first: column, last: column }),
              onSome: last =>
                Array.append(Array.dropRight(openings, 1), {
                  ...last,
                  last: column,
                }),
            }),
          )
        },
      ),
  )

type Piece = Readonly<{ x: number; y: number; width: number; height: number }>

const cropOf = (room: Canvas.Image, piece: Piece): Canvas.Shape =>
  Canvas.Image({
    src: room.src,
    x: piece.x,
    y: piece.y,
    width: piece.width,
    height: piece.height,
    crop: {
      x: (room.crop?.x ?? 0) + piece.x - room.x,
      y: (room.crop?.y ?? 0) + piece.y - room.y,
      width: piece.width,
      height: piece.height,
    },
    rendering: 'Pixelated',
  })

const occluderOf =
  (level: Level, room: Canvas.Image) =>
  ({ row, first, last }: Opening): Occluder => {
    const floorY = (row + 1) * TILE_SIZE
    const top = Math.max(level.top, floorY - FACE_HEIGHT)
    const openingLeft = first * TILE_SIZE
    const openingRight = (last + 1) * TILE_SIZE
    const left = Math.max(0, openingLeft - BESIDE_PX)
    const right = Math.min(level.width, openingRight + BESIDE_PX)
    const pieces: ReadonlyArray<Piece> = [
      { x: left, y: top, width: openingLeft - left, height: floorY - top },
      {
        x: openingLeft,
        y: top,
        width: openingRight - openingLeft,
        height: floorY - FACE_HEIGHT + LINTEL_BOTTOM - top,
      },
      {
        x: openingRight,
        y: top,
        width: right - openingRight,
        height: floorY - top,
      },
    ]
    return {
      floorY,
      left,
      right,
      shapes: Array.filterMap(pieces, piece =>
        piece.width > 0 && piece.height > 0
          ? Result.succeed(cropOf(room, piece))
          : Result.failVoid,
      ),
    }
  }

const builtOccluders = new WeakMap<Level, ReadonlyArray<Occluder>>()

// NOTE: built once for each level and kept, like the room image they crop.
export const occludersOf = (level: Level): ReadonlyArray<Occluder> => {
  const cached = builtOccluders.get(level)
  if (cached !== undefined) {
    return cached
  }
  const room = roomShapes(level)
  const only = room.length === 1 ? room[0] : undefined
  const occluders =
    only?._tag === 'Image'
      ? Array.map(openingsOf(level), occluderOf(level, only))
      : []
  builtOccluders.set(level, occluders)
  return occluders
}

// NOTE: feet above an occluder's floor line and inside its span stand in its
// doorway, behind the wall. Feet far above it stand in the room on the other
// side of that wall, such as the kitchen above the parlour, not behind it.
const BEYOND_PX = FACE_HEIGHT + TILE_SIZE

export const isBehindWall =
  (level: Level) =>
  (x: number, footY: number): boolean =>
    Array.some(
      occludersOf(level),
      ({ floorY, left, right }) =>
        footY < floorY && footY > floorY - BEYOND_PX && x >= left && x < right,
    )
