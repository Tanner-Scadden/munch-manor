import { describe, expect, test } from 'vitest'

import { isFrontWallAt } from '../space'

// The house's walls in 3D (src/render/iso/space.ts): a wall with floor just
// north of it is built low for good, so it never hides the room behind it
// and never moves as the player walks by.

const TILES: ReadonlyArray<string> = [
  ',,,,,,',
  '######',
  '#....#',
  '#....#',
  '######',
  '######',
  '#....#',
  '######',
]

const isFront = (row: number, column: number): boolean =>
  isFrontWallAt({ tiles: TILES, row, column })

describe('the walls', () => {
  test('keep the back wall and the side walls tall', () => {
    expect(isFront(1, 2)).toBe(false)
    expect(isFront(2, 0)).toBe(false)
    expect(isFront(3, 5)).toBe(false)
  })

  test('build a front wall low, both tiles of a thick one', () => {
    expect(isFront(4, 2)).toBe(true)
    expect(isFront(5, 2)).toBe(true)
    expect(isFront(7, 3)).toBe(true)
  })

  test('keep a corner tall: wall all the way up', () => {
    expect(isFront(4, 0)).toBe(false)
  })
})
