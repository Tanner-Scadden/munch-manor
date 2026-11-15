import { Array, Option } from 'effect'
import { describe, expect, test } from 'vitest'

import {
  type CarvedModel,
  type PixelView,
  carve,
  carveSprite,
  carvedViewsOf,
  faceColorOf,
  formOf,
  isSolidAt,
  lensViewOf,
  showpieceSheetOf,
  viewColorsOf,
  voxelsOf,
  voxelsWithin,
} from '../carve'
import { ZOMBIE_PALETTE, groanerWalkForms } from '../sprites/zombieArt'

// Carving a piece from its views (src/art/carve.ts): the visual hull, its
// parts, the hand fixes, each face's color, and a sprite's default form off
// its front art alone.

const PALETTE = { a: '#aa0000', b: '#00bb00', c: '#0000cc', o: '#111111' }

const view = (rows: ReadonlyArray<string>): PixelView => ({
  rows,
  palette: PALETTE,
})

const colorsOf = viewColorsOf

const keyOf = ({ x, y, z }: Readonly<{ x: number; y: number; z: number }>) =>
  `${x},${y},${z}`

const blocksOf = (model: CarvedModel): ReadonlySet<string> =>
  new Set(Array.map(voxelsOf(model), keyOf))

describe('carve', () => {
  test('keeps a block only where the front, top, and side all see one', () => {
    const model = carve({
      views: {
        front: view(['aa', 'a.']),
        parts: [
          { name: 'all', top: view(['b.', 'bb']), side: view(['cc', 'c.']) },
        ],
      },
    })
    expect(blocksOf(model)).toEqual(
      new Set(['0,0,0', '1,0,0', '0,1,0', '0,0,1']),
    )
  })

  test('carves each part against the front on its own', () => {
    const front = view(['aaa'])
    const together = carve({
      views: {
        front,
        parts: [
          { name: 'both', top: view(['b.b', 'bbb']), side: view(['cc']) },
        ],
      },
    })
    const apart = carve({
      views: {
        front,
        parts: [
          { name: 'near', top: view(['bbb']), side: view(['c']) },
          { name: 'far', top: view(['b.b']), side: view(['c']), near: 1 },
        ],
      },
    })
    expect(voxelsOf(together)).toHaveLength(5)
    expect(voxelsOf(apart)).toHaveLength(5)
    expect(isSolidAt({ model: apart, voxel: { x: 1, y: 0, z: 1 } })).toBe(false)
  })

  test('applies the hand fixes, the removals last', () => {
    const model = carve({
      views: {
        front: view(['aa']),
        parts: [{ name: 'all', top: view(['bb']), side: view(['c']) }],
      },
      fixes: {
        add: [{ x: 0, y: 0, z: 1, color: '#123456' }],
        remove: [{ x: 1, y: 0, z: 0 }],
      },
    })
    expect(blocksOf(model)).toEqual(new Set(['0,0,0']))
    expect(
      voxelsWithin({ from: { x: 0, y: 0, z: 0 }, to: { x: 1, y: 1, z: 0 } }),
    ).toHaveLength(4)
  })

  test('colors each face from the view that sees it', () => {
    const model = carve({
      views: {
        front: view(['a']),
        parts: [{ name: 'all', top: view(['b']), side: view(['c']) }],
      },
    })
    const voxel = { x: 0, y: 0, z: 0 }
    const colorOf = (face: 'Front' | 'Top' | 'Right') =>
      faceColorOf({ model, voxel, face })
    expect(colorOf('Front')).toEqual(Option.some(PALETTE.a))
    expect(colorOf('Top')).toEqual(Option.some(PALETTE.b))
    expect(colorOf('Right')).toEqual(Option.some(PALETTE.c))
  })

  test('reads its front along the lens with a lean of 1', () => {
    const model = carve({
      views: {
        front: view(['a', 'a']),
        parts: [
          {
            name: 'all',
            top: view(['b', 'b']),
            side: view(['cc', 'cc', 'cc']),
          },
        ],
      },
      lean: 1,
    })
    expect(colorsOf(carvedViewsOf(model).front)).toEqual(
      colorsOf(view(['a', 'a'])),
    )
    expect(isSolidAt({ model, voxel: { x: 0, y: 2, z: 1 } })).toBe(true)
  })
})

describe('the default form', () => {
  const rows = (art: ReadonlyArray<string>) => ({
    width: art[0]?.length ?? 0,
    height: art.length,
    isSolid: (column: number, row: number) => art[row]?.[column] === '#',
  })

  test('rounds a body: deepest down its middle, one block at its edges', () => {
    const form = formOf(rows(['#######', '#######', '#######', '#######']))
    const thickAt = (column: number, row: number) =>
      form.thick[row * form.width + column]
    expect(thickAt(0, 1)).toBe(1)
    expect(thickAt(3, 1)).toBeGreaterThan(thickAt(1, 1) ?? 0)
    expect(form.depth).toBe(thickAt(3, 1))
    expect(form.near[1 * form.width]).toBe(Math.floor((form.depth - 1) / 2))
  })

  test('keeps an arm held out thin and the torso its own width', () => {
    const form = formOf(
      rows(['.####....', '.####....', '.########', '.####....', '.####....']),
    )
    const thickAt = (column: number, row: number) =>
      form.thick[row * form.width + column] ?? 0
    expect(thickAt(7, 2)).toBeLessThanOrEqual(1)
    expect(thickAt(2, 2)).toBeLessThanOrEqual(thickAt(2, 1) + 2)
  })

  test("keeps a Groaner's art exactly from the front, and round", () => {
    Array.forEach(groanerWalkForms(0), model => {
      const art = model.views.front
      expect(colorsOf(carvedViewsOf(model).front)).toEqual(colorsOf(art))
      expect(model.depth).toBeGreaterThanOrEqual(4)
      expect(lensViewOf(model).rows.length).toBe(art.rows.length + 1)
    })
  })

  test('shows an outline on the front face alone', () => {
    const pixels = ['ooooo', 'oaaao', 'oaaao', 'ooooo']
    const model = carveSprite({
      pixels,
      palette: PALETTE,
      refine: OUTLINED,
    })
    const edge = Option.getOrThrow(
      Array.findFirst(voxelsOf(model), ({ x, y, z }) => x === 0 && y - z === 1),
    )
    expect(faceColorOf({ model, voxel: edge, face: 'Front' })).toEqual(
      Option.some(PALETTE.o),
    )
    expect(faceColorOf({ model, voxel: edge, face: 'Left' })).toEqual(
      Option.some(PALETTE.a),
    )
  })

  test('is carved once for each pixel map, palette, and refinement', () => {
    const pixels = ['aa', 'aa']
    const first = carveSprite({ pixels, palette: ZOMBIE_PALETTE })
    expect(carveSprite({ pixels, palette: ZOMBIE_PALETTE })).toBe(first)
    expect(
      carveSprite({ pixels, palette: ZOMBIE_PALETTE, refine: OUTLINED }),
    ).not.toBe(first)
  })

  test('lays out its views for a reviewer', () => {
    const sheet = showpieceSheetOf(Array.headNonEmpty(groanerWalkForms(0)))
    expect(sheet.voxels.length).toBeGreaterThan(0)
    expect(sheet.carved.top.rows).toHaveLength(sheet.size.depth)
  })
})

const OUTLINED = { outline: 'o' }
