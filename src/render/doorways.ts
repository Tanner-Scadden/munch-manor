import { Array, Function, Option, pipe } from 'effect'

import { TILE_SIZE } from '../shared/constants'
import { type Level, TILE_DOOR, hasTileFlag } from '../world/level/arena'
import { type Tile, tileIndex } from '../world/level/tileGrid'
import { isWalkableTile } from '../world/level/tileQueries'

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

export const doorwaysOf = (level: Level): ReadonlyArray<Opening> => {
  const cached = builtOpenings.get(level)
  if (cached !== undefined) {
    return cached
  }
  const openings = openingsOf(level)
  builtOpenings.set(level, openings)
  return openings
}

const WALL_DEPTH_PX = TILE_SIZE * 2
const BESIDE_PX = TILE_SIZE * 2
const BEYOND_PX = WALL_DEPTH_PX + TILE_SIZE

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
