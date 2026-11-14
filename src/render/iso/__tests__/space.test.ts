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
