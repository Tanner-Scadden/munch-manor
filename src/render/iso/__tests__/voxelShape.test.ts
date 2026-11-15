import { Array, Option } from 'effect'
import { describe, expect, test } from 'vitest'

import { depthsOf, maxDepthOf, slabMatrixOf, voxelMeshOf } from '../voxelShape'

// A sprite's pixels as blocks (src/render/iso/voxelShape.ts): how deep each
// one goes, the faces it shows, and the matrix that stands it where its
// billboard stood.

const rows = (art: ReadonlyArray<string>) => ({
  width: art[0]?.length ?? 0,
  height: art.length,
  isSolid: (column: number, row: number) => art[row]?.[column] === '#',
})

const determinantOf = (elements: ReadonlyArray<number>): number => {
  const at = (index: number) => elements[index] ?? 0
  return (
    at(0) * (at(5) * at(10) - at(9) * at(6)) -
    at(4) * (at(1) * at(10) - at(9) * at(2)) +
    at(8) * (at(1) * at(6) - at(5) * at(2))
  )
}

describe('voxel depths', () => {
  test('a body is deepest down its middle and one deep at its edges', () => {
    const body = rows(Array.makeBy(12, () => '############'))
    const depths = depthsOf(body)
    expect(depths[6 * 12 + 6]).toBe(3)
    expect(depths[6 * 12]).toBe(1)
    expect(depths[6]).toBe(1)
  })

  test('a thin gun in a big square cell stays one deep', () => {
    const cell = Array.makeBy(20, row =>
      row === 9 || row === 10 ? '....##########......' : '....................',
    )
    const depths = depthsOf(rows(cell))
    expect(Math.max(...depths)).toBe(1)
  })

  test('clear pixels have no depth', () => {
    const depths = depthsOf(rows(['#.#', '...', '#.#']))
    expect(Array.fromIterable(depths)).toEqual([1, 0, 1, 0, 0, 0, 1, 0, 1])
  })

  test('the most depth follows the art, from one to three', () => {
    expect(maxDepthOf({ width: 2, height: 30 })).toBe(1)
    expect(maxDepthOf({ width: 8, height: 9 })).toBe(2)
    expect(maxDepthOf({ width: 40, height: 40 })).toBe(3)
  })
})

describe('voxel mesh', () => {
  test('a lone pixel is a whole block: six faces of two triangles', () => {
    const mesh = voxelMeshOf({
      ...rows(['#']),
      uvOf: () => [0.5, 0.5],
    })
    expect(mesh.indices.length).toBe(6 * 6)
    expect(mesh.positions.length).toBe(6 * 4 * 3)
  })

  test('neighbors as deep share no face between them', () => {
    const mesh = voxelMeshOf({
      ...rows(['##']),
      uvOf: () => [0.5, 0.5],
    })
    expect(mesh.indices.length / 6).toBe(10)
  })

  test('every front face comes first, so a fading body hides its insides', () => {
    const body = rows(Array.makeBy(8, () => '########'))
    const mesh = voxelMeshOf({ ...body, uvOf: () => [0.5, 0.5] })
    const fronts = 8 * 8
    const normalZOf = (face: number) => mesh.normals[face * 4 * 3 + 2] ?? 0
    const faces = mesh.normals.length / (4 * 3)
    const firstOthers = Array.findFirstIndex(
      Array.makeBy(faces, face => normalZOf(face)),
      z => z !== 1,
    )
    expect(Option.getOrUndefined(firstOthers)).toBe(fronts)
    expect(
      Array.every(
        Array.makeBy(fronts, face => normalZOf(face)),
        z => z === 1,
      ),
    ).toBe(true)
  })
})

describe('slab matrix', () => {
  const placement = {
    box: { x: -4, y: -12, width: 8, height: 12 },
    texels: { width: 8, height: 12 },
    footY: 100,
    hover: 0,
    nudge: 0,
    depth: 1,
  }

  test('an upright sprite keeps a positive turn', () => {
    const { elements, isFlipped } = slabMatrixOf({
      ...placement,
      matrix: { a: 1, b: 0, c: 0, d: 1, e: 50, f: 100 },
    })
    expect(isFlipped).toBe(false)
    expect(determinantOf(elements)).toBeGreaterThan(0)
  })

  test('a mirrored sprite is built flipped, so its turn stays positive', () => {
    const { elements, isFlipped } = slabMatrixOf({
      ...placement,
      matrix: { a: -1, b: 0, c: 0, d: 1, e: 50, f: 100 },
    })
    expect(isFlipped).toBe(true)
    expect(determinantOf(elements)).toBeGreaterThan(0)
  })

  test('a turned sprite keeps its depth square to its face', () => {
    const turn = Math.PI / 5
    const { elements } = slabMatrixOf({
      ...placement,
      matrix: {
        a: Math.cos(turn),
        b: Math.sin(turn),
        c: -Math.sin(turn),
        d: Math.cos(turn),
        e: 50,
        f: 100,
      },
    })
    const column = (index: number) =>
      Array.makeBy(3, axis => elements[index * 4 + axis] ?? 0)
    const dot = (left: ReadonlyArray<number>, right: ReadonlyArray<number>) =>
      Array.reduce(
        Array.zipWith(left, right, (one, other) => one * other),
        0,
        (sum, part) => sum + part,
      )
    expect(dot(column(0), column(2))).toBeCloseTo(0, 9)
    expect(dot(column(1), column(2))).toBeCloseTo(0, 9)
    expect(dot(column(0), column(1))).toBeCloseTo(0, 9)
  })
})
