import { Array, Option, String } from 'effect'
import { expect, test } from 'vitest'

import { LINTEL_FLOOR, lintelTilesOf } from '#render/iso/house/lintels.ts'
import { MANOR, openExit } from '#world/level/arena.ts'
import { WALL_SYMBOL } from '#world/level/tileGrid.ts'

const symbolOf = (row: number, column: number): string =>
  Option.getOrElse(String.charAt(MANOR.tiles[row] ?? '', column), () => '')

test("the dining room's yard door gets a lintel over its back row", () => {
  const lintels = lintelTilesOf(MANOR)
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
