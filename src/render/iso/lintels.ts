// The lintels over the doorways in the house's tall top walls: which tiles
// a lintel spans, how tall it stands, and whose art its top wears. Plain
// data off the level, so the 3D house builds them (house.ts) and tests read
// them without a renderer.

import { Array } from 'effect'

import type { Level } from '../../world/level/arena'
import { doorwaysOf, isPassage } from '../occluders'
import { wallHeightAt } from './space'

// NOTE: how high a lintel starts, in world units: a tall wall is 1.4, and
// the tallest zombie walks under it.
export const LINTEL_FLOOR = 0.95

type LintelTile = Readonly<{
  // NOTE: the tile, in rows and columns of `level.tiles`.
  row: number
  column: number
  // NOTE: the top of the wall beside it, which the lintel's top meets.
  height: number
  // NOTE: the wall tile whose art its top wears.
  art: Readonly<{ row: number; column: number }>
}>

const builtLintels = new WeakMap<Level, ReadonlyArray<LintelTile>>()

// NOTE: a lintel spans a doorway's back row, the top wall's far tile, so
// the wallpaper runs on over the opening and the lintel's face shows over
// it, while the near row stays open and the doorway's own art shows through
// it. (Spanning both rows hid the doorway: the steep lens sees a wall's
// top far more than its face.) Its top wears the wall's art as far east of
// it as the doorway is wide, the side clear of the portraits. A doorway in
// a low wall (the kitchen's, seen over from the dining room) gets none.
export const lintelTilesOf = (level: Level): ReadonlyArray<LintelTile> => {
  const cached = builtLintels.get(level)
  if (cached !== undefined) {
    return cached
  }
  const lintels = Array.flatMap(doorwaysOf(level), ({ row, first, last }) => {
    const back = row - 1
    const local = back - level.topRow
    const height = wallHeightAt({
      tiles: level.tiles,
      row: local,
      column: first - 1 - level.leftColumn,
    })
    if (height <= LINTEL_FLOOR || !isPassage(level, first, back)) {
      return []
    }
    const width = last - first + 1
    return Array.makeBy(width, step => ({
      row: local,
      column: first + step - level.leftColumn,
      height,
      art: { row: local, column: first + step + width - level.leftColumn },
    }))
  })
  builtLintels.set(level, lintels)
  return lintels
}
