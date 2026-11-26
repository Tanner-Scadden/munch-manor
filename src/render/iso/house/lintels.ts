import { Array } from 'effect'

import { WALL_ROW, wallHeightAt } from '#render/iso/space.ts'
import { doorwaysOf, isPassage } from '#render/room/doorways.ts'
import type { Level } from '#world/level/arena.ts'

export const LINTEL_FLOOR = 7 * WALL_ROW

type LintelTile = Readonly<{
  row: number
  column: number
  height: number
  art: Readonly<{ row: number; column: number }>
}>

const builtLintels = new WeakMap<Level, ReadonlyArray<LintelTile>>()

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
