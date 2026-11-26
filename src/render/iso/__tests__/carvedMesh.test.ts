import { describe, expect, test } from 'vitest'

import { carve } from '#art/carve.ts'
import { carvedMeshOf } from '#render/iso/carvedMesh.ts'

const PALETTE = { a: '#ff0000', f: '#ffd23f' }

const piece = carve({
  views: {
    front: { rows: ['af'], palette: PALETTE },
    parts: [
      {
        name: 'all',
        top: { rows: ['af'], palette: PALETTE },
        side: { rows: ['a'], palette: PALETTE },
      },
    ],
  },
})

const PLACEMENT = { left: 0, footY: 0, rise: 1 }

describe('carvedMeshOf', () => {
  test('leaves out the faces two blocks share', () => {
    const { lit, glowing } = carvedMeshOf({
      model: piece,
      placement: PLACEMENT,
      isGlowing: () => false,
    })
    expect(glowing.indices).toHaveLength(0)
    expect(lit.positions).toHaveLength(10 * 4 * 3)
    expect(lit.indices).toHaveLength(10 * 6)
  })

  test('puts the glowing colors in a geometry of their own', () => {
    const { lit, glowing } = carvedMeshOf({
      model: piece,
      placement: PLACEMENT,
      isGlowing: color => color === PALETTE.f,
    })
    expect(lit.indices).toHaveLength(6 * 6)
    expect(glowing.indices).toHaveLength(4 * 6)
    expect(Array.from(glowing.colors.slice(0, 4))).toEqual(
      Array.from(Float32Array.from([1, 0xd2 / 255, 0x3f / 255, 1])),
    )
  })

  test('winds every face to face out along its normal', () => {
    const { lit } = carvedMeshOf({
      model: piece,
      placement: PLACEMENT,
      isGlowing: () => false,
    })
    const at = (vertex: number, axis: number) =>
      lit.positions[vertex * 3 + axis] ?? 0
    for (let triangle = 0; triangle < lit.indices.length; triangle += 3) {
      const [i0, i1, i2] = [
        lit.indices[triangle] ?? 0,
        lit.indices[triangle + 1] ?? 0,
        lit.indices[triangle + 2] ?? 0,
      ]
      const edge = (to: number, axis: number) => at(to, axis) - at(i0, axis)
      const normal = (axis: number) => lit.normals[i0 * 3 + axis] ?? 0
      const facing =
        (edge(i1, 1) * edge(i2, 2) - edge(i1, 2) * edge(i2, 1)) * normal(0) +
        (edge(i1, 2) * edge(i2, 0) - edge(i1, 0) * edge(i2, 2)) * normal(1) +
        (edge(i1, 0) * edge(i2, 1) - edge(i1, 1) * edge(i2, 0)) * normal(2)
      expect(facing).toBeGreaterThan(0)
    }
  })
})
