import { Array, Option } from 'effect'
import { describe, expect, test } from 'vitest'

import {
  depthsOf,
  isGroundedOf,
  maxDepthOf,
  sideShadeOf,
  sideSourcesOf,
  slabMatrixOf,
  snappedSpinOf,
  voxelMeshOf,
} from '../voxelShape'

// A sprite's pixels as blocks (src/render/iso/voxelShape.ts): how deep each
// one goes, the faces it shows, whose color their sides wear and how dark
// toward the foot, and the matrix that stands it where its billboard stood.

const rows = (art: ReadonlyArray<string>) => ({
  width: art[0]?.length ?? 0,
  height: art.length,
  isSolid: (column: number, row: number) => art[row]?.[column] === '#',
})

// NOTE: art with ink: `#` solid and light, `k` solid and dark.
const inked = (art: ReadonlyArray<string>) => ({
  width: art[0]?.length ?? 0,
  height: art.length,
  isSolid: (column: number, row: number) => {
    const pixel = art[row]?.[column]
    return pixel === '#' || pixel === 'k'
  },
  isDark: (column: number, row: number) => art[row]?.[column] === 'k',
})

// NOTE: each corner's uv names its pixel, so a face tells whose color it
// wears.
const uvByPixel = (column: number, row: number): readonly [number, number] => [
  column,
  row,
]

const FACE_CORNERS = 4

type Face = Readonly<{
  normalZ: number
  uv: readonly [number, number]
  shade: number
}>

const facesOf = (mesh: ReturnType<typeof voxelMeshOf>): ReadonlyArray<Face> =>
  Array.makeBy(mesh.normals.length / (FACE_CORNERS * 3), face => ({
    normalZ: mesh.normals[face * FACE_CORNERS * 3 + 2] ?? 0,
    uv: [
      mesh.uvs[face * FACE_CORNERS * 2] ?? -1,
      mesh.uvs[face * FACE_CORNERS * 2 + 1] ?? -1,
    ],
    shade: mesh.colors[face * FACE_CORNERS * 4] ?? -1,
  }))

const isFront = ({ normalZ }: Face) => normalZ === 1

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

describe('outline once', () => {
  const RING = ['kkkkk', 'k###k', 'k###k', 'k###k', 'kkkkk']

  test("an ink ring's sides wear the fill inside it", () => {
    const sources = sideSourcesOf(inked(RING))
    expect(sources[0]).toBe(6)
    expect(sources[2]).toBe(7)
    expect(sources[2 * 5 + 4]).toBe(2 * 5 + 3)
    expect(sources[2 * 5 + 2]).toBe(2 * 5 + 2)
  })

  test('the edge of a dark mass keeps a dark color', () => {
    const art = inked(['kkkkk', 'kkkkk', 'kkkkk', '#####'])
    const sources = sideSourcesOf(art)
    const isDarkAt = (index: number) =>
      art.isDark(index % 5, Math.floor(index / 5))
    expect(
      Array.every(
        Array.makeBy(15, at => at),
        at => isDarkAt(sources[at] ?? -1),
      ),
    ).toBe(true)
  })

  test('ink with nothing inside it keeps its own color', () => {
    const sources = sideSourcesOf(inked(['kkkk']))
    expect(Array.fromIterable(sources)).toEqual([0, 1, 2, 3])
  })

  test('the front shows the ink and no side does', () => {
    const faces = facesOf(voxelMeshOf({ ...inked(RING), uvOf: uvByPixel }))
    const isInk = ([column, row]: readonly [number, number]) =>
      column === 0 || row === 0 || column === 4 || row === 4
    const fronts = Array.filter(faces, isFront)
    const sides = Array.filter(faces, face => !isFront(face))
    expect(Array.filter(fronts, ({ uv }) => isInk(uv)).length).toBe(16)
    expect(Array.filter(sides, ({ uv }) => isInk(uv))).toEqual([])
  })
})

describe('darker near the floor', () => {
  const body = rows(Array.makeBy(16, () => '########'))

  test('a side is darkest at the foot and its own color higher up', () => {
    expect(sideShadeOf(0)).toBeLessThan(sideShadeOf(3))
    expect(sideShadeOf(3)).toBeLessThan(sideShadeOf(12))
    expect(sideShadeOf(12)).toBe(1)
  })

  test("a standing body's sides darken toward its foot, its front never", () => {
    const faces = facesOf(
      voxelMeshOf({ ...body, uvOf: uvByPixel, ground: 'Below' }),
    )
    expect(Array.every(Array.filter(faces, isFront), f => f.shade === 1)).toBe(
      true,
    )
    const sides = Array.filter(faces, face => !isFront(face))
    const shadeAt = (row: number) =>
      Math.min(
        ...Array.map(
          Array.filter(sides, ({ uv }) => uv[1] === row),
          ({ shade }) => shade,
        ),
      )
    expect(shadeAt(15)).toBeLessThan(shadeAt(12))
    expect(shadeAt(1)).toBe(1)
  })

  test('reversed rows darken toward their first row', () => {
    const faces = facesOf(
      voxelMeshOf({ ...body, uvOf: uvByPixel, ground: 'Above' }),
    )
    const sides = Array.filter(faces, face => !isFront(face))
    const footSide = Array.filter(sides, ({ uv }) => uv[1] === 0)
    const headSide = Array.filter(sides, ({ uv }) => uv[1] === 15)
    expect(Array.every(footSide, ({ shade }) => shade < 1)).toBe(true)
    expect(Array.every(headSide, ({ shade }) => shade === 1)).toBe(true)
  })

  test('art off the floor keeps its own colors', () => {
    const faces = facesOf(voxelMeshOf({ ...body, uvOf: uvByPixel }))
    expect(Array.every(faces, ({ shade }) => shade === 1)).toBe(true)
  })
})

describe('on the floor', () => {
  const standing = {
    box: { x: -4, y: -16, width: 8, height: 16 },
    texels: { height: 16 },
    footY: 100,
    solidBottom: 15,
  }
  const turned = (angle: number) => ({
    a: Math.cos(angle),
    b: Math.sin(angle),
    c: -Math.sin(angle),
    d: Math.cos(angle),
    e: 50,
    f: 100,
  })

  test('a body at its foot stands, facing either way', () => {
    expect(
      isGroundedOf({
        ...standing,
        matrix: { a: 1, b: 0, c: 0, d: 1, e: 50, f: 100 },
      }),
    ).toBe(true)
    expect(
      isGroundedOf({
        ...standing,
        matrix: { a: -1, b: 0, c: 0, d: 1, e: 50, f: 100 },
      }),
    ).toBe(true)
  })

  test('a lean stands, a fall does not', () => {
    expect(isGroundedOf({ ...standing, matrix: turned(0.3) })).toBe(true)
    expect(isGroundedOf({ ...standing, matrix: turned(Math.PI / 2) })).toBe(
      false,
    )
  })

  test('art held up off its foot does not stand', () => {
    expect(
      isGroundedOf({
        ...standing,
        matrix: { a: 1, b: 0, c: 0, d: 1, e: 50, f: 90 },
      }),
    ).toBe(false)
  })
})

describe('crisp turns', () => {
  const STEP = Math.PI / 8

  test('a coin turn snaps to sixteenths of a turn', () => {
    expect(snappedSpinOf(0.1)).toBe(0)
    expect(snappedSpinOf(STEP * 0.6)).toBeCloseTo(STEP, 9)
    expect(snappedSpinOf(STEP * 5.4)).toBeCloseTo(STEP * 5, 9)
    expect(snappedSpinOf(Math.PI * 2 - 0.05)).toBe(0)
  })

  test('a turn between steps stands exactly as its step', () => {
    const placement = {
      matrix: { a: 1, b: 0, c: 0, d: 1, e: 50, f: 100 },
      box: { x: -4, y: -8, width: 8, height: 8 },
      texels: { width: 8, height: 8 },
      footY: 100,
      hover: 0,
      nudge: 0,
      depth: 1,
    }
    expect(slabMatrixOf({ ...placement, spin: STEP * 2.3 }).elements).toEqual(
      slabMatrixOf({ ...placement, spin: STEP * 2 }).elements,
    )
    expect(slabMatrixOf({ ...placement, spin: 0.05 }).elements).toEqual(
      slabMatrixOf(placement).elements,
    )
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
