import { Array } from 'effect'
import { expect, test } from 'vitest'

import { rectsOf } from '../../test/viewReading'
import { pixelDiscSpans, pixelRingSpans } from '../pixelCircle'

// Circles on the game's pixel grid (src/render/pixelCircle.ts): every ring
// a closed loop of whole pixels, never loose dots, every disc solid, and
// both even on every side, so a tell ring sits square on its zombie.

type Pixel = readonly [x: number, y: number]

const pixelsOf = (
  shapes: Parameters<typeof rectsOf>[0],
): ReadonlyArray<Pixel> =>
  Array.flatMap(rectsOf(shapes, { x: 0, y: 0 }), ({ x, y, width, height }) => {
    expect(
      Array.every([x, y, width, height], value => Number.isInteger(value)),
    ).toBe(true)
    expect(height).toBe(1)
    return Array.makeBy(width, along => [x + along, y] as const)
  })

const keyOf = ([x, y]: Pixel): string => `${x},${y}`

const isConnected = (pixels: ReadonlyArray<Pixel>): boolean => {
  const left = new Set(Array.map(pixels, keyOf))
  const queue: Array<Pixel> = Array.take(pixels, 1).slice()
  Array.forEach(queue, pixel => left.delete(keyOf(pixel)))
  for (let index = 0; index < queue.length; index += 1) {
    const [x, y] = queue[index] ?? [0, 0]
    for (const dx of [-1, 0, 1]) {
      for (const dy of [-1, 0, 1]) {
        if (left.delete(`${x + dx},${y + dy}`)) {
          queue.push([x + dx, y + dy])
        }
      }
    }
  }
  return left.size === 0
}

const isEven = (pixels: ReadonlyArray<Pixel>): boolean => {
  const all = new Set(Array.map(pixels, keyOf))
  return Array.every(
    pixels,
    ([x, y]) =>
      all.has(`${-x},${y}`) && all.has(`${x},${-y}`) && all.has(`${y},${x}`),
  )
}

// NOTE: past the widest ring baked, the boss's slam.
const RADII = Array.range(1, 64)

test('a ring is one closed loop of whole pixels, even on every side', () => {
  Array.forEach([1, 2, 3], thickness => {
    Array.forEach(RADII, radius => {
      const pixels = pixelsOf(pixelRingSpans(0, 0, radius, thickness, '#fff'))
      expect(new Set(Array.map(pixels, keyOf)).size).toBe(pixels.length)
      expect(isConnected(pixels)).toBe(true)
      expect(isEven(pixels)).toBe(true)
      expect(Array.some(pixels, ([x, y]) => x === 0 && y === 0)).toBe(
        radius < thickness,
      )
      expect(Math.max(...Array.map(pixels, ([x]) => x))).toBe(radius)
    })
  })
})

test('a disc is solid, as wide as its radius both ways', () => {
  Array.forEach(RADII, radius => {
    const pixels = pixelsOf(pixelDiscSpans(0, 0, radius, '#fff'))
    const all = new Set(Array.map(pixels, keyOf))
    expect(isEven(pixels)).toBe(true)
    Array.forEach(Array.range(-radius, radius), x => {
      expect(all.has(`${x},0`)).toBe(true)
      expect(all.has(`0,${x}`)).toBe(true)
    })
    expect(all.has(`${radius + 1},0`)).toBe(false)
  })
})

test('a ring lies on whole pixels wherever its middle falls', () => {
  const pixels = pixelsOf(pixelRingSpans(10.6, -4.4, 5, 1, '#fff'))
  expect(Math.min(...Array.map(pixels, ([x]) => x))).toBe(6)
  expect(Math.max(...Array.map(pixels, ([x]) => x))).toBe(16)
})
