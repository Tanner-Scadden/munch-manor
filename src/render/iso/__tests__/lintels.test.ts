import { Array, Option, String } from 'effect'
import { expect, test } from 'vitest'

import { MANOR, openExit } from '../../../world/level/arena'
import { WALL_SYMBOL } from '../../../world/level/tileGrid'
import { LINTEL_FLOOR, lintelTilesOf } from '../lintels'

// The lintels over the doorways in the tall top walls (src/render/iso/
// lintels.ts): over a doorway's back row only, as tall as the wall beside
// it, its top wearing a wall tile's art.

const symbolOf = (row: number, column: number): string =>
  Option.getOrElse(String.charAt(MANOR.tiles[row] ?? '', column), () => '')

test("the dining room's yard door gets a lintel over its back row", () => {
  const lintels = lintelTilesOf(MANOR)
  // NOTE: the yard door is columns 27 and 28, rows 0 and 1 of the world.
  expect(
    Array.map(lintels, ({ row, column }) => ({
      row: row + MANOR.topRow,
      column: column + MANOR.leftColumn,
    })),
  ).toEqual([
    { row: 0, column: 27 },
    { row: 0, column: 28 },
  ])
  Array.forEach(lintels, ({ height, art }) => {
    expect(height).toBeGreaterThan(LINTEL_FLOOR)
    expect(symbolOf(art.row, art.column)).toBe(WALL_SYMBOL)
  })
})

test('the low wall between the kitchen and the dining room gets none', () => {
  const kitchen = openExit(MANOR, 'Kitchen')
  const columns = Array.map(
    lintelTilesOf(kitchen),
    ({ column }) => column + kitchen.leftColumn,
  )
  expect(columns).not.toContain(6)
  expect(columns).not.toContain(7)
  expect(columns).toContain(27)
})
