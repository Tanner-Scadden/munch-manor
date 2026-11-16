import { Array, Option, Record } from 'effect'
import { describe, expect, test } from 'vitest'

import { PITCH, UNIT, zOf } from '../space'
import {
  type VoxelMeshData,
  isGroundedOf,
  lensFormOf,
  sideShadeOf,
  sideSourcesOf,
  slabMatrixOf,
  snappedSpinOf,
  uprightLeanOf,
  uprightMatrixOf,
  voxelMeshOf,
} from '../voxelShape'

// A sprite's pixels as carved blocks (src/render/iso/voxelShape.ts): how
// deep each stack goes, that the lens sees exactly the art, the faces it
// shows, whose color their sides wear and how dark toward the foot, and the
// matrix that stands it where its billboard stood.

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

const facesOf = (mesh: VoxelMeshData): ReadonlyArray<Face> =>
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

// NOTE: what the lens sees of a mesh: for each screen pixel (column, row
// of the art) the uv of the nearest front or top face over its middle. In
// the geometry, a point's screen row is minus its y, and nearer the lens is
// a larger z.
const lensPictureOf = (
  mesh: ReturnType<typeof voxelMeshOf>,
): ReadonlyMap<string, readonly [number, number]> => {
  const nearest = new Map<
    string,
    Readonly<{ z: number; uv: readonly [number, number] }>
  >()
  const faces = mesh.positions.length / (FACE_CORNERS * 3)
  for (let face = 0; face < faces; face += 1) {
    const normalZ = mesh.normals[face * FACE_CORNERS * 3 + 2] ?? 0
    if (normalZ <= 0) {
      continue
    }
    const corner = (at: number, axis: number) =>
      mesh.positions[(face * FACE_CORNERS + at) * 3 + axis] ?? 0
    const xs = Array.makeBy(FACE_CORNERS, at => corner(at, 0))
    const ys = Array.makeBy(FACE_CORNERS, at => -corner(at, 1))
    const zs = Array.makeBy(FACE_CORNERS, at => corner(at, 2))
    const column = Math.min(...xs)
    const top = Math.min(...ys)
    const bottom = Math.max(...ys)
    if (bottom - top < 0.5) {
      continue
    }
    const row = Math.round(top)
    const z = (Math.min(...zs) + Math.max(...zs)) / 2
    const key = `${column},${row}`
    const known = nearest.get(key)
    if (known === undefined || z > known.z) {
      nearest.set(key, {
        z,
        uv: [
          mesh.uvs[face * FACE_CORNERS * 2] ?? -1,
          mesh.uvs[face * FACE_CORNERS * 2 + 1] ?? -1,
        ],
      })
    }
  }
  return new Map(Array.map([...nearest], ([key, { uv }]) => [key, uv]))
}

// NOTE: the art as the lens should see its carve: every pixel its own and
// nothing more, a toe or a barrel one pixel thick too.
const artPictureOf = (
  art: ReadonlyArray<string>,
): ReadonlyMap<string, readonly [number, number]> =>
  new Map(
    Array.flatMap(art, (line, row) =>
      Array.flatMap(
        Array.makeBy(line.length, column => column),
        column =>
          (art[row]?.[column] ?? '.') === '.'
            ? []
            : [[`${column},${row}`, [column, row]] as const],
      ),
    ),
  )

const thicknessAt = (
  form: ReturnType<typeof lensFormOf>,
  column: number,
  row: number,
) =>
  (form.back[row * form.width + column] ?? 0) -
  (form.near[row * form.width + column] ?? 0)

describe('carved form', () => {
  const square = rows(Array.makeBy(12, () => '############'))

  test('a body is deeper down its middle than at its edges', () => {
    const form = lensFormOf(square)
    expect(thicknessAt(form, 6, 6)).toBeGreaterThan(thicknessAt(form, 0, 6))
    expect(form.depth).toBeGreaterThan(4)
  })

  test('a thin gun in a big square cell stays thin', () => {
    const cell = Array.makeBy(20, row =>
      row === 9 || row === 10 ? '....##########......' : '....................',
    )
    expect(lensFormOf(rows(cell)).depth).toBeLessThanOrEqual(2)
  })

  test('the most caps how deep it is carved', () => {
    expect(lensFormOf({ ...square, most: 3 }).depth).toBeLessThanOrEqual(3)
  })

  test('a top edge folds into the tops of the row under it', () => {
    const form = lensFormOf(square)
    expect(form.folded[3]).toBe(1)
    expect(form.folded[12 + 3]).toBe(0)
    expect(thicknessAt(form, 3, 0)).toBe(0)
  })

  test('its lowest block stands on the floor at the foot', () => {
    const form = lensFormOf(square)
    const lowest = Math.max(
      ...Array.makeBy(12 * 12, index =>
        (form.back[index] ?? 0) > 0
          ? Math.floor(index / 12) + (form.back[index] ?? 0)
          : 0,
      ),
    )
    expect(lowest - form.lift).toBe(12)
  })

  test('a box set by hand is flush and as deep everywhere', () => {
    const form = lensFormOf({ ...square, depthOf: () => 4 })
    expect(thicknessAt(form, 0, 6)).toBe(4)
    expect(thicknessAt(form, 6, 6)).toBe(4)
    expect(form.near[6 * 12]).toBe(0)
    expect(form.near[6 * 12 + 6]).toBe(0)
  })

  test('a pixel the hand leaves out keeps the round default', () => {
    const round = lensFormOf(square)
    const form = lensFormOf({
      ...square,
      depthOf: column => (column === 0 ? 2 : undefined),
    })
    expect(thicknessAt(form, 0, 6)).toBe(2)
    expect(thicknessAt(form, 6, 6)).toBe(thicknessAt(round, 6, 6))
  })
})

describe('from the lens', () => {
  const ART: Readonly<{ [name: string]: ReadonlyArray<string> }> = {
    square: Array.makeBy(10, () => '##########'),
    body: [
      '...####...',
      '..######..',
      '..######..',
      '...####...',
      '.########.',
      '##########',
      '#.######.#',
      '..######..',
      '..##..##..',
      '..##..##..',
      '.###..###.',
    ],
    gun: ['..........', '.########.', '.###......', '.##.......'],
  }

  test.each(Record.keys(ART))('the %s carved shows exactly its art', name => {
    const art = ART[name] ?? []
    const picture = lensPictureOf(
      voxelMeshOf({ ...rows(art), uvOf: uvByPixel }),
    )
    expect(picture).toEqual(artPictureOf(art))
  })
})

describe('voxel mesh', () => {
  test('the front face of an eye pixel goes apart, to glow, and nowhere else', () => {
    const mesh = voxelMeshOf({
      ...rows(['###', '###', '###']),
      uvOf: uvByPixel,
      isGlow: (column, row) => column === 1 && row === 1,
    })
    const isEye = ({ uv }: Face) => uv[0] === 1 && uv[1] === 1
    const glow = facesOf(mesh.glow ?? { ...mesh, indices: new Uint32Array() })
    expect(glow.length).toBe(1)
    const [eye] = glow
    expect(eye?.uv).toEqual([1, 1])
    expect(
      Array.some(
        facesOf(mesh),
        face => isEye(face) && face.normalZ === eye?.normalZ,
      ),
    ).toBe(false)
  })

  test('a carve with no glowing pixel has no glow', () => {
    const mesh = voxelMeshOf({
      ...rows(['##']),
      uvOf: uvByPixel,
      isGlow: () => false,
    })
    expect(mesh.glow).toBeUndefined()
  })

  test('a pixel on one under it is one block, its top the upper pixel', () => {
    const mesh = voxelMeshOf({
      ...rows(['#', '#']),
      uvOf: () => [0.5, 0.5],
    })
    expect(mesh.indices.length).toBe(6 * 6)
    expect(mesh.positions.length).toBe(6 * 4 * 3)
  })

  test('neighbors as deep share no face between them', () => {
    const mesh = voxelMeshOf({
      ...rows(['##', '##']),
      uvOf: () => [0.5, 0.5],
    })
    expect(mesh.indices.length / 6).toBe(10)
  })

  test('a pixel with nothing over or under it is a plate: one top', () => {
    const mesh = voxelMeshOf({ ...rows(['###']), uvOf: uvByPixel })
    const faces = facesOf(mesh)
    expect(faces.length).toBe(3)
    expect(Array.map(faces, ({ uv }) => uv)).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
    ])
    expect(
      Array.every(faces, ({ normalZ }) => normalZ > 0 && normalZ < 1),
    ).toBe(true)
  })

  test('every front face comes first, so a fading body hides its insides', () => {
    const body = rows(Array.makeBy(8, () => '########'))
    const mesh = voxelMeshOf({ ...body, uvOf: () => [0.5, 0.5] })
    const normalZOf = (face: number) => mesh.normals[face * 4 * 3 + 2] ?? 0
    const faces = mesh.normals.length / (4 * 3)
    const firstOther = Option.getOrElse(
      Array.findFirstIndex(
        Array.makeBy(faces, face => normalZOf(face)),
        z => z !== 1,
      ),
      () => faces,
    )
    expect(firstOther).toBeGreaterThanOrEqual(7 * 8)
    expect(
      Array.some(
        Array.makeBy(faces - firstOther, at => normalZOf(firstOther + at)),
        z => z === 1,
      ),
    ).toBe(false)
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

  test('the lens shows the ink and no side does', () => {
    const mesh = voxelMeshOf({ ...inked(RING), uvOf: uvByPixel })
    const isInk = ([column, row]: readonly [number, number]) =>
      column === 0 || row === 0 || column === 4 || row === 4
    const seen = [...lensPictureOf(mesh).values()]
    expect(Array.filter(seen, isInk).length).toBe(16)
    const sides = Array.filter(
      facesOf(mesh),
      face => !isFront(face) && face.normalZ <= 0,
    )
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
      voxelMeshOf({ ...body, uvOf: uvByPixel, isGrounded: true }),
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
    expect(shadeAt(15)).toBeLessThan(shadeAt(10))
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

describe('standing upright', () => {
  // NOTE: a china cabinet's art, 6 wide and 12 tall, standing upright on 4
  // pixels of floor, as src/render/iso/voxels.ts carves one: as deep as its
  // tiles, the stacks near the foot shallower so none goes under the floor.
  const ART = rows(Array.makeBy(12, () => '######'))
  const MOST = 4
  const mesh = voxelMeshOf({
    ...ART,
    uvOf: uvByPixel,
    most: MOST,
    depthOf: (_column, row) => Math.max(1, Math.min(MOST, 12 - row)),
    isUpright: true,
  })
  const lean = uprightLeanOf({ rows: 12, most: MOST })
  const placement = {
    box: { x: 0, y: -12, width: 6, height: 12 },
    texels: { width: 6, height: 12 },
    matrix: { a: 1, b: 0, c: 0, d: 1, e: 50, f: 100 },
    footY: 100,
    hover: 0,
    nudge: 0,
    depth: 1,
    lean,
  }
  const { elements } = uprightMatrixOf(placement)
  // NOTE: each corner of the blocks where the matrix stands it.
  const corners = Array.makeBy(mesh.positions.length / 3, corner => {
    const local = Array.makeBy(
      3,
      axis => mesh.positions[corner * 3 + axis] ?? 0,
    )
    return Array.makeBy(3, axis =>
      Array.reduce(
        local,
        elements[12 + axis] ?? 0,
        (sum, part, index) => sum + part * (elements[index * 4 + axis] ?? 0),
      ),
    )
  })
  const heights = Array.map(corners, ([, y]) => y ?? 0)
  const depths = Array.map(corners, ([, , z]) => z ?? 0)
  const tallest = Math.max(...heights)

  test('its carve and its matrix lean back alike', () => {
    expect(mesh.lean).toBeCloseTo(lean, 9)
  })

  test('it stands on the floor, never under it', () => {
    expect(Math.min(...heights)).toBeCloseTo(0, 6)
  })

  test('its front is on its foot', () => {
    expect(Math.max(...depths)).toBeCloseTo(zOf(100), 6)
  })

  // NOTE: up the camera's up, as many game pixels as its art: its top row
  // folds into the tops of the row under it, a row on screen, as every
  // carve's does. A step back along the lens's ray moves no point up the
  // screen.
  test('it is as tall on screen as its art', () => {
    const rises = Array.map(
      corners,
      ([, y, z]) =>
        (y ?? 0) * Math.cos(PITCH) - ((z ?? 0) - zOf(100)) * Math.sin(PITCH),
    )
    expect(Math.max(...rises)).toBeCloseTo(12 * UNIT, 6)
  })

  test('its front leans back until its top is over the back of its tiles', () => {
    const top = Math.max(
      ...Array.filter(
        depths,
        (_, index) => Math.abs((heights[index] ?? 0) - tallest) < 1e-6,
      ),
    )
    expect(top).toBeCloseTo(zOf(100 - (MOST * (12 - 1)) / 12), 6)
  })
})

describe('leaning upright', () => {
  test('a tall piece leans its top over the back of its tiles', () => {
    Array.forEach(
      [
        { tall: 29, most: 10 },
        { tall: 40, most: 20 },
      ],
      ({ tall, most }) => {
        const lean = uprightLeanOf({ rows: tall, most })
        expect(
          (tall * Math.sin(lean) * Math.sin(PITCH)) / Math.cos(PITCH - lean),
        ).toBeCloseTo(most, 9)
      },
    )
  })

  test('the taller a piece is for its depth, the straighter it stands', () => {
    expect(uprightLeanOf({ rows: 40, most: 10 })).toBeLessThan(
      uprightLeanOf({ rows: 29, most: 10 }),
    )
  })

  test('a squat piece leans no further than the lens', () => {
    expect(uprightLeanOf({ rows: 10, most: 10 })).toBeCloseTo(PITCH, 9)
  })
})

describe('shadow caster', () => {
  test('a block of blocks casts through one quad a side', () => {
    const { caster } = voxelMeshOf({
      ...rows(Array.makeBy(6, () => '######')),
      uvOf: () => [0.5, 0.5],
      most: 1,
    })
    expect(caster.indices.length / 6).toBe(6)
  })

  test('a body casts through far fewer faces than it shows', () => {
    const mesh = voxelMeshOf({
      ...rows(Array.makeBy(12, () => '############')),
      uvOf: () => [0.5, 0.5],
    })
    expect(mesh.caster.indices.length * 4).toBeLessThan(mesh.indices.length)
  })
})
