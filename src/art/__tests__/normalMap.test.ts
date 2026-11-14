import { describe, expect, test } from 'vitest'

import { normalPixelsOf } from '../normalMap'

// A sprite sheet's normal map (src/art/normalMap.ts): a shape's edge
// faces out of it, its middle faces the viewer, and a clear pixel faces
// straight out.

const SIZE = 9
const GREY = 160

// NOTE: a sheet of one opaque grey square, one clear pixel all round.
const square = (): Uint8ClampedArray => {
  const pixels = new Uint8ClampedArray(SIZE * SIZE * 4)
  for (let y = 1; y < SIZE - 1; y += 1) {
    for (let x = 1; x < SIZE - 1; x += 1) {
      const offset = (y * SIZE + x) * 4
      pixels[offset] = GREY
      pixels[offset + 1] = GREY
      pixels[offset + 2] = GREY
      pixels[offset + 3] = 255
    }
  }
  return pixels
}

const normalAt = (
  normals: Uint8ClampedArray,
  x: number,
  y: number,
): ReadonlyArray<number> => {
  const offset = (y * SIZE + x) * 4
  return [
    normals[offset] ?? 0,
    normals[offset + 1] ?? 0,
    normals[offset + 2] ?? 0,
  ]
}

describe('a sprite sheet normal map', () => {
  const normals = normalPixelsOf({
    pixels: square(),
    width: SIZE,
    height: SIZE,
  })
  const middle = Math.floor(SIZE / 2)

  test('a clear pixel faces straight out', () => {
    expect(normalAt(normals, 0, 0)).toEqual([128, 128, 255])
  })

  test('the middle faces the viewer', () => {
    expect(normalAt(normals, middle, middle)).toEqual([128, 128, 255])
  })

  test('each edge faces out of the shape', () => {
    const [leftX = 0] = normalAt(normals, 1, middle)
    const [rightX = 0] = normalAt(normals, SIZE - 2, middle)
    const [, topY = 0] = normalAt(normals, middle, 1)
    const [, bottomY = 0] = normalAt(normals, middle, SIZE - 2)
    expect(leftX).toBeLessThan(128)
    expect(rightX).toBeGreaterThan(128)
    // NOTE: green is up, as glTF reads it.
    expect(topY).toBeGreaterThan(128)
    expect(bottomY).toBeLessThan(128)
  })

  // NOTE: so the slope beside a dark pixel runs down to it, and faces it.
  test('a dark pixel sits lower than a light one beside it', () => {
    const pixels = square()
    const dark = (middle * SIZE + middle + 1) * 4
    pixels[dark] = 0
    pixels[dark + 1] = 0
    pixels[dark + 2] = 0
    const shaded = normalPixelsOf({ pixels, width: SIZE, height: SIZE })
    const [towardDarkX = 0] = normalAt(shaded, middle, middle)
    expect(towardDarkX).toBeGreaterThan(128)
  })
})
