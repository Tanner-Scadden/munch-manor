import { Array, Function, Option, pipe } from 'effect'

import { TILE_SIZE } from '../shared/constants'
import { type Level, TILE_DOOR, hasTileFlag } from '../world/level/arena'
import { type Tile, tileIndex } from '../world/level/tileGrid'
import { isWalkableTile } from '../world/level/tileQueries'

// NOTE: the doorways in the house's top walls. The 3D house builds a lintel
// over each one's back row (src/render/iso/lintels.ts), and whatever still
// stands in one is behind that lintel, so its health bar waits until it
// steps into the room.

// NOTE: a doorway in a top wall: the row it opens onto the room from, and
// its first and last columns.
export type Opening = Readonly<{ row: number; first: number; last: number }>

export const isPassage: {
  (column: number, row: number): (level: Level) => boolean
  (level: Level, column: number, row: number): boolean
} = Function.dual(
  3,
  (level: Level, column: number, row: number): boolean =>
    hasTileFlag(level, tileIndex(level, column, row), TILE_DOOR) ||
    Array.some(
      level.exits,
      exit =>
        exit.isOpen &&
        Array.some(
          exit.tiles,
          (tile: Tile) => tile.column === column && tile.row === row,
        ),
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
        Array.makeBy(level.columns, column => column + level.leftColumn),
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

const builtOpenings = new WeakMap<Level, ReadonlyArray<Opening>>()

// NOTE: every doorway in a top wall, built once for each level.
export const doorwaysOf = (level: Level): ReadonlyArray<Opening> => {
  const cached = builtOpenings.get(level)
  if (cached !== undefined) {
    return cached
  }
  const openings = openingsOf(level)
  builtOpenings.set(level, openings)
  return openings
}

// NOTE: a top wall is two tiles deep, and what stands in its doorway may be
// as wide as Uncle Chunk, so the span reaches two tiles past the opening on
// each side. Feet far above the wall's floor line stand in the room on the
// other side of it, such as the kitchen above the dining room, not in it.
const WALL_DEPTH_PX = TILE_SIZE * 2
const BESIDE_PX = TILE_SIZE * 2
const BEYOND_PX = WALL_DEPTH_PX + TILE_SIZE

// NOTE: feet above a doorway's floor line and inside its span stand in the
// doorway, behind the wall.
export const isBehindWall =
  (level: Level) =>
  (x: number, footY: number): boolean =>
    Array.some(doorwaysOf(level), ({ row, first, last }) => {
      const floorY = (row + 1) * TILE_SIZE
      return (
        footY < floorY &&
        footY > floorY - BEYOND_PX &&
        x >= first * TILE_SIZE - BESIDE_PX &&
        x < (last + 1) * TILE_SIZE + BESIDE_PX
      )
    })
