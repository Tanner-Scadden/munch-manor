import { describe, expect, test } from 'vitest'

import { buildGrid, queryAround, queryBox, queryBuffer } from './grid'
import type { Vector } from './worldSchema'

// NOTE: a tiny seeded generator so the cases are the same on every run.
const randoms = (seed: number) => {
  let state = seed
  return (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
}

const scatter = (
  seed: number,
  count: number,
  spread: number,
): Array<Vector> => {
  const next = randoms(seed)
  return Array.from({ length: count }, () => ({
    x: (next() - 0.25) * spread,
    y: (next() - 0.25) * spread,
  }))
}

type Box = readonly [number, number, number, number]

const isInBox = (point: Vector, box: Box): boolean =>
  point.x >= box[0] &&
  point.x <= box[2] &&
  point.y >= box[1] &&
  point.y <= box[3]

const isAscending = (values: ReadonlyArray<number>): boolean =>
  values.every((value, at) => at === 0 || value > (values[at - 1] ?? 0))

describe('grid', () => {
  const cases = [
    { name: 'a crowd in a room', count: 150, spread: 320, cellPx: 24 },
    { name: 'a few, far apart', count: 12, spread: 4000, cellPx: 24 },
    { name: 'one cell', count: 40, spread: 10, cellPx: 24 },
    {
      name: 'tiny cells over a wide spread',
      count: 90,
      spread: 900,
      cellPx: 1,
    },
  ]

  for (const { name, count, spread, cellPx } of cases) {
    test(`a query finds the brute-force set in index order: ${name}`, () => {
      const points = scatter(count + spread, count, spread)
      const isIncluded = (index: number): boolean => index % 3 !== 1
      const grid = buildGrid(
        points.map((point, index) => ({ ...point, index })),
        ({ index }) => isIncluded(index),
        cellPx,
      )
      const out = queryBuffer(grid)
      const next = randoms(count)
      for (let probe = 0; probe < 200; probe++) {
        // boxes that sit inside, straddle an edge, or lie wholly outside
        const x = (next() - 0.5) * spread * 1.6
        const y = (next() - 0.5) * spread * 1.6
        const box: Box = [x, y, x + next() * 60, y + next() * 60]
        const found = Array.from(out.subarray(0, queryBox(grid, out, ...box)))
        expect(isAscending(found)).toBe(true)
        expect(found.every(isIncluded)).toBe(true)
        const wanted = points.flatMap((point, index) =>
          isIncluded(index) && isInBox(point, box) ? [index] : [],
        )
        // whole cells come back, so the caller's exact test trims them
        expect(found).toEqual(expect.arrayContaining(wanted))
        expect(
          found.filter(index => {
            const point = points[index]
            return point !== undefined && isInBox(point, box)
          }),
        ).toEqual(wanted)
      }
    })
  }

  test('a point at the edge or on a cell line is found from every side', () => {
    const points: Array<Vector> = [
      { x: 0, y: 0 },
      { x: 24, y: 24 },
      { x: 48, y: 0 },
      { x: 48, y: 48 },
      { x: -5, y: 100 },
    ]
    const grid = buildGrid(points, () => true, 24)
    const out = queryBuffer(grid)
    for (const [index, point] of points.entries()) {
      const count = queryAround(grid, out, point, 0)
      expect(Array.from(out.subarray(0, count))).toContain(index)
    }
    const count = queryAround(grid, out, { x: 24, y: 24 }, 30)
    expect(Array.from(out.subarray(0, count))).toEqual([0, 1, 2, 3])
  })

  test('nothing included builds an empty grid that answers nothing', () => {
    const grid = buildGrid(scatter(1, 10, 100), () => false, 24)
    expect(queryAround(grid, queryBuffer(grid), { x: 5, y: 5 }, 50)).toBe(0)
    const none = buildGrid([], () => true, 24)
    expect(queryAround(none, queryBuffer(none), { x: 0, y: 0 }, 50)).toBe(0)
  })

  test('a query far outside the grid is safe', () => {
    const points = scatter(3, 30, 200)
    const grid = buildGrid(points, () => true, 24)
    const out = queryBuffer(grid)
    expect(
      queryAround(grid, out, { x: 1e9, y: -1e9 }, 100),
    ).toBeLessThanOrEqual(points.length)
  })
})
