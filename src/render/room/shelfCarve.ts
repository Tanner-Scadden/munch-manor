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

const DEPTH = 3
const FRAME_Z = 1
const BOOK_Z = DEPTH - 1

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

export const isShelfGlint = (color: string): boolean =>
  color === SHELF_BOOK_COLORS.glint
