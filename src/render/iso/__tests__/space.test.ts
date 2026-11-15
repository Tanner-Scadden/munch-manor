import { Array } from 'effect'
import { describe, expect, test } from 'vitest'

import { canvasStepOf, isFrontWallAt } from '../space'

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

// NOTE: two rooms side by side, each side wall with a doorway two rows tall
// in it: the side wall under a doorway stays tall, so the two rooms' walls
// meet at one height with no low stub.
const SIDE_DOORS: ReadonlyArray<string> = [
  ',,,,,,,,',
  '########',
  '#..##..#',
  '...##...',
  '...##...',
  '#..##..#',
  '#.....##',
  '#.....##',
  '#..##..#',
  '########',
]

describe('a side wall with a doorway in it', () => {
  test("stands tall under the doorway, both rooms' walls alike", () => {
    Array.forEach([0, 3, 4, 7], column => {
      expect(isFrontWallAt({ tiles: SIDE_DOORS, row: 5, column })).toBe(false)
    })
    expect(isFrontWallAt({ tiles: SIDE_DOORS, row: 8, column: 3 })).toBe(false)
    expect(isFrontWallAt({ tiles: SIDE_DOORS, row: 8, column: 4 })).toBe(false)
  })

  test("the room's own front wall under its floor stays low", () => {
    expect(isFrontWallAt({ tiles: SIDE_DOORS, row: 9, column: 1 })).toBe(true)
    expect(isFrontWallAt({ tiles: SIDE_DOORS, row: 9, column: 5 })).toBe(true)
  })
})

// NOTE: the world drawn at about one canvas pixel per CSS pixel, each game
// pixel still a whole number of canvas pixels (src/render/iso/space.ts).
describe('the canvas step', () => {
  test.each([
    { devicePerGamePixel: 6, ratio: 3, step: 3 },
    { devicePerGamePixel: 9, ratio: 3, step: 3 },
    { devicePerGamePixel: 4, ratio: 3, step: 2 },
    { devicePerGamePixel: 5, ratio: 3, step: 1 },
    { devicePerGamePixel: 4, ratio: 2, step: 2 },
    { devicePerGamePixel: 3, ratio: 2, step: 1 },
    { devicePerGamePixel: 3, ratio: 2.625, step: 1 },
    { devicePerGamePixel: 4, ratio: 2.625, step: 2 },
    { devicePerGamePixel: 2, ratio: 1, step: 1 },
  ])(
    'a game pixel of $devicePerGamePixel at $ratio x steps by $step',
    ({ devicePerGamePixel, ratio, step }) => {
      expect(canvasStepOf({ devicePerGamePixel, ratio })).toBe(step)
    },
  )
})
