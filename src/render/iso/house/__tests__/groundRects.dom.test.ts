import { Array } from 'effect'
import { describe, expect, test } from 'vitest'

import * as Draw from '#render/draw.ts'
import { flatten, isSameLeaves } from '#render/iso/flatten.ts'
import {
  type GroundBox,
  groundBoxOf,
  splitGround,
  writeGroundBoxes,
} from '#render/iso/house/groundRects.ts'
import { UNIT, zOf } from '#render/iso/space.ts'

const shadow = (x: number) =>
  Draw.Rect({ x, y: 20, width: 8, height: 3, fill: 'rgba(0,0,0,0.4)' })

const decal = Draw.Image({
  src: 'a.png',
  x: 0,
  y: 0,
  width: 4,
  height: 4,
  rendering: 'Pixelated',
})

describe('the ground split', () => {
  test('takes the plain filled rectangles as quads, in order, and leaves the rest', () => {
    const ring = Draw.Rect({
      x: 0,
      y: 0,
      width: 4,
      height: 4,
      stroke: '#f00',
    })
    const turned = Draw.Group({ rotate: 0.5, shapes: [shadow(30)] })
    const { rects, rest } = splitGround(
      flatten([shadow(1), decal, ring, shadow(2), turned]),
    )
    expect(Array.map(rects, ({ shape }) => shape.x)).toEqual([1, 2])
    expect(Array.map(rest, ({ shape }) => shape._tag)).toEqual([
      'Image',
      'Rect',
      'Rect',
    ])
  })

  test('a moved rectangle leaves the picture as it was', () => {
    const before = splitGround(flatten([decal, shadow(1)]))
    const after = splitGround(flatten([decal, shadow(2)]))
    expect(isSameLeaves(before.rest, after.rest)).toBe(true)
    expect(isSameLeaves(before.rects, after.rects)).toBe(false)
  })
})

describe('the picture is drawn again only on a change', () => {
  test('the same leaves built again are the same', () => {
    expect(
      isSameLeaves(flatten([decal, shadow(1)]), flatten([decal, shadow(1)])),
    ).toBe(true)
  })

  test('a leaf moved, recolored, faded, added, or taken away is not', () => {
    const base = flatten([decal, shadow(1)])
    const changed = [
      flatten([decal, shadow(2)]),
      flatten([
        decal,
        Draw.Rect({ x: 1, y: 20, width: 8, height: 3, fill: '#f00' }),
      ]),
      flatten([decal, Draw.Group({ opacity: 0.5, shapes: [shadow(1)] })]),
      flatten([decal, shadow(1), shadow(1)]),
      flatten([decal]),
    ]
    Array.forEach(changed, leaves => {
      expect(isSameLeaves(base, leaves)).toBe(false)
    })
  })
})

describe('a rectangle as a box on the floor', () => {
  test('its box through its groups, on whole game pixels, its opacity theirs', () => {
    const [leaf] = splitGround(
      flatten([
        Draw.Group({
          translate: { x: 10.4, y: 5 },
          opacity: 0.5,
          shapes: [
            Draw.Rect({
              x: 1,
              y: 2,
              width: 3,
              height: 4,
              fill: 'rgba(255,0,51,0.8)',
            }),
          ],
        }),
      ]),
    ).rects
    expect(leaf).toBeDefined()
    if (leaf === undefined) {
      return
    }
    const { alpha, ...rest } = groundBoxOf(leaf)
    expect(rest).toEqual({
      x: 11,
      y: 7,
      width: 3,
      height: 4,
      red: 1,
      green: 0,
      blue: 0.2,
    })
    expect(alpha).toBeCloseTo(0.4, 6)
  })
})

describe('the quads', () => {
  const box: GroundBox = {
    x: 2,
    y: 3,
    width: 4,
    height: 5,
    red: 1,
    green: 0.5,
    blue: 0,
    alpha: 0.25,
  }
  const origin = { x: 1, y: 0.5, z: 2 }

  test('a box lies at the lift from the mesh, its color in linear light', () => {
    const out = {
      positions: new Float32Array(2 * 12),
      colors: new Float32Array(2 * 16),
    }
    writeGroundBoxes({ boxes: [box], lift: 0.75, origin, out })
    const left = 2 * UNIT - 1
    const right = 6 * UNIT - 1
    const near = zOf(3) - 2
    const far = zOf(8) - 2
    expect(Array.fromIterable(out.positions.subarray(0, 12))).toEqual(
      Array.map(
        [
          left,
          0.25,
          near,
          right,
          0.25,
          near,
          right,
          0.25,
          far,
          left,
          0.25,
          far,
        ],
        value => Math.fround(value),
      ),
    )
    expect(Array.fromIterable(out.colors.subarray(0, 4))).toEqual([
      1,
      Math.fround(0.5 ** 2.2),
      0,
      0.25,
    ])
    expect(Array.fromIterable(out.colors.subarray(12, 16))).toEqual(
      Array.fromIterable(out.colors.subarray(0, 4)),
    )
  })

  test('a quad past the last box draws nothing', () => {
    const out = {
      positions: new Float32Array(2 * 12).fill(9),
      colors: new Float32Array(2 * 16).fill(9),
    }
    writeGroundBoxes({ boxes: [box], lift: 0.75, origin, out })
    expect(Array.fromIterable(out.positions.subarray(12))).toEqual(
      Array.replicate(0, 12),
    )
    expect(Array.fromIterable(out.colors.subarray(16))).toEqual(
      Array.replicate(0, 16),
    )
  })
})
