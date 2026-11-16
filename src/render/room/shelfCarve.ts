// The library's secret shelf carved while it is shut: the case
// (src/render/room/libraryArt.ts) set in the side wall as blocks, as tall
// as the wall and as long as the shelf, its frame a pixel prouder than its
// books, and its red book three pixels out of the wall with a glint on its
// top, so the book a player walks into (src/world/library/secretShelf.ts)
// is the one they see. Built once for each wall, its grid laid as the wall
// is seen from the room (src/render/iso/carvedMesh.ts `uprightMeshOf`): its
// columns along the wall left to right, its rows down from the wall's top,
// and its depth into the wall, 0 the proudest.

import { Array, String } from 'effect'

import {
  type CarvedModel,
  type Voxel,
  blocksModelOf,
  pixelViewOfShapes,
} from '../../art/carve'
import {
  SHELF_BOOK_COLORS,
  SHELF_CASE_HEIGHT,
  SHELF_CASE_LENGTH,
  SHELF_FRAME_COLORS,
  type ShelfWall,
  shelfCaseShapes,
} from './libraryArt'

// NOTE: how deep the carve is: the red book's three, the frame's two, and
// the books' one, out of the wall's face.
const DEPTH = 3
const FRAME_Z = 1
const BOOK_Z = DEPTH - 1

// NOTE: the book's top row on the case, and its two columns from the
// case's left as the room sees it. Seen from the library, the west wall's
// left is south and the east wall's north, and the book is 7 pixels from
// the shelf's north end either way (`BOOK_DOWN_PX`), so it is the third
// and fourth column from the case's north end. Its southern column takes
// the glint, nearest the lens.
const BOOK_TOP = 1

const ODD_BOOK_X: Readonly<Record<ShelfWall, number>> = {
  West: SHELF_CASE_LENGTH - 8,
  East: 6,
}

const SOUTH_COLUMN: Readonly<Record<ShelfWall, number>> = {
  West: ODD_BOOK_X.West,
  East: ODD_BOOK_X.East + 1,
}

type Block = Voxel & Readonly<{ color: string }>

const colorsOf = (wall: ShelfWall): ReadonlyArray<ReadonlyArray<string>> => {
  const view = pixelViewOfShapes({
    shapes: shelfCaseShapes(ODD_BOOK_X[wall]),
    box: {
      left: 0,
      top: 0,
      width: SHELF_CASE_LENGTH,
      height: SHELF_CASE_HEIGHT,
    },
  })
  return Array.map(view.rows, line =>
    Array.map(Array.fromIterable(line), symbol => view.palette[symbol] ?? ''),
  )
}

// NOTE: the odd book's color at a depth: lit where it faces the lens, its
// southern column, with the glint on its top front.
const oddColorAt = (wall: ShelfWall, { x, y, z }: Voxel): string =>
  z === 0 && x === SOUTH_COLUMN[wall]
    ? y === BOOK_TOP
      ? SHELF_BOOK_COLORS.glint
      : SHELF_BOOK_COLORS.light
    : SHELF_BOOK_COLORS.odd

const blocksOf = (wall: ShelfWall): ReadonlyArray<Block> =>
  Array.flatMap(colorsOf(wall), (line, y) =>
    Array.flatMap(line, (color, x) => {
      if (String.isEmpty(color)) {
        return []
      }
      const near =
        color === SHELF_BOOK_COLORS.odd
          ? 0
          : SHELF_FRAME_COLORS.has(color)
            ? FRAME_Z
            : BOOK_Z
      return Array.map(Array.range(near, BOOK_Z), z => ({
        x,
        y,
        z,
        color:
          color === SHELF_BOOK_COLORS.odd
            ? oddColorAt(wall, { x, y, z })
            : color,
      }))
    }),
  )

export const SHELF_CARVES: Readonly<Record<ShelfWall, CarvedModel>> = {
  West: blocksModelOf(blocksOf('West')),
  East: blocksModelOf(blocksOf('East')),
}

// NOTE: the colors that glow of themselves on the carve: the glint.
export const isShelfGlint = (color: string): boolean =>
  color === SHELF_BOOK_COLORS.glint
