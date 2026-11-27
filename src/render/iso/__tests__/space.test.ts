import { Array } from 'effect'
import { describe, expect, test } from 'vitest'

import { canvasStepOf, isFrontWallAt, scaledStepOf } from '#render/iso/space.ts'

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

  test('build a front wall low', () => {
    expect(isFront(4, 2)).toBe(true)
    expect(isFront(7, 3)).toBe(true)
  })

  test("stand a thick front wall's south tile tall where it is the back wall of the room south of it", () => {
    expect(isFront(5, 2)).toBe(false)
  })

  test('keep a corner tall: wall all the way up', () => {
    expect(isFront(4, 0)).toBe(false)
  })
})

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

describe('the canvas step', () => {
  test.each([
    { devicePerGamePixel: 6, ratio: 3, step: 3 },
    { devicePerGamePixel: 9, ratio: 3, step: 3 },
    { devicePerGamePixel: 4, ratio: 3, step: 2 },
    { devicePerGamePixel: 5, ratio: 3, step: 5 },
    { devicePerGamePixel: 7, ratio: 2, step: 7 },
    { devicePerGamePixel: 4, ratio: 2, step: 2 },
    { devicePerGamePixel: 3, ratio: 2, step: 3 },
    { devicePerGamePixel: 3, ratio: 2.625, step: 3 },
    { devicePerGamePixel: 4, ratio: 2.625, step: 2 },
    { devicePerGamePixel: 2, ratio: 1, step: 1 },
    { devicePerGamePixel: 3, ratio: 1.5, step: 1 },
  ])(
    'a game pixel of $devicePerGamePixel at $ratio x steps by $step',
    ({ devicePerGamePixel, ratio, step }) => {
      expect(canvasStepOf({ devicePerGamePixel, ratio })).toBe(step)
    },
  )

  const ratios = Array.map(Array.range(8, 32), eighths => eighths / 8)
  const wholes = Array.range(1, 16)
  const pairs = Array.flatMap(ratios, ratio =>
    Array.map(wholes, devicePerGamePixel => ({ ratio, devicePerGamePixel })),
  )

  test('every ratio and game pixel gets a whole step that divides it', () => {
    Array.forEach(pairs, input => {
      const step = canvasStepOf(input)
      expect(Number.isInteger(input.devicePerGamePixel / step)).toBe(true)
      expect(step).toBeGreaterThanOrEqual(1)
    })
  })

  test('at a ratio of 2 or more the step is never 1', () => {
    const steps = Array.map(
      Array.filter(
        pairs,
        ({ ratio, devicePerGamePixel }) =>
          ratio >= 2 && devicePerGamePixel >= 2,
      ),
      canvasStepOf,
    )
    expect(Array.filter(steps, step => step === 1)).toEqual([])
  })

  test('a scaled tier is never finer than Full, and 2 canvas pixels a game pixel where the game pixel is even', () => {
    Array.forEach(pairs, input => {
      const full = canvasStepOf(input)
      const step = scaledStepOf({ ...input, perGamePixel: 2 })
      expect(Number.isInteger(input.devicePerGamePixel / step)).toBe(true)
      expect(step).toBeGreaterThanOrEqual(full)
    })
    const even = Array.filter(
      pairs,
      ({ devicePerGamePixel }) => devicePerGamePixel % 2 === 0,
    )
    expect(
      Array.filter(
        even,
        input =>
          input.devicePerGamePixel /
            scaledStepOf({ ...input, perGamePixel: 2 }) >
          Math.max(2, input.devicePerGamePixel / canvasStepOf(input)),
      ),
    ).toEqual([])
  })

  test.each([
    { devicePerGamePixel: 6, ratio: 2, step: 3 },
    { devicePerGamePixel: 8, ratio: 2, step: 4 },
    { devicePerGamePixel: 4, ratio: 1, step: 2 },
    { devicePerGamePixel: 3, ratio: 1, step: 1 },
    { devicePerGamePixel: 9, ratio: 3, step: 3 },
  ])(
    'the 2x scale steps a game pixel of $devicePerGamePixel at $ratio x by $step',
    ({ devicePerGamePixel, ratio, step }) => {
      expect(scaledStepOf({ devicePerGamePixel, ratio, perGamePixel: 2 })).toBe(
        step,
      )
    },
  )
})
