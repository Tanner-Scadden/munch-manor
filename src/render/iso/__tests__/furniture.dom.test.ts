import { Array, Option } from 'effect'
import { Rectangle, Texture, TextureSource } from 'pixi.js'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { BatchedMesh3D, Container3D } from '@pixi/3d'

import { spriteDepthOf } from '#art/sprite.ts'
import type { ViewBox } from '#render/iso/cull.ts'
import { flatten } from '#render/iso/flatten.ts'
import { Furniture } from '#render/iso/furniture.ts'
import { VoxelBatch, type VoxelTextures } from '#render/iso/voxels.ts'
import { tallCoverOf } from '#render/room/tallCover.ts'
import { MANOR } from '#world/level/arena.ts'

const SHEET = new TextureSource({ width: 512, height: 512 })

const crops = new Map<string, Texture>()

const textures: VoxelTextures = {
  imageOf: image => {
    const width = Math.max(1, Math.round(image.crop?.width ?? image.width))
    const height = Math.max(1, Math.round(image.crop?.height ?? image.height))
    const key = `${image.src}|${width}x${height}`
    const known = crops.get(key)
    if (known !== undefined) {
      return known
    }
    const texture = new Texture({
      source: SHEET,
      frame: new Rectangle(0, 0, width, height),
    })
    crops.set(key, texture)
    return texture
  },
  sheetOf: () => Texture.WHITE,
  masksOf: texture => ({
    solid: new Uint8Array(texture.frame.width * texture.frame.height).fill(1),
    dark: new Uint8Array(texture.frame.width * texture.frame.height),
  }),
  lookOptions: () => ({}),
}

const level = MANOR

const WHOLE_HOUSE: ViewBox = {
  left: -10_000,
  top: -10_000,
  right: 10_000,
  bottom: 10_000,
}

const FAR_AWAY: ViewBox = {
  left: 100_000,
  top: 100_000,
  right: 100_100,
  bottom: 100_100,
}

const SLOT_WRITES = [
  'setGeometryAt',
  'setMaterialAt',
  'setMatrixAt',
  'setPassesAt',
  'setVisibleAt',
] as const

const countWrites = () =>
  Array.map(SLOT_WRITES, name => vi.spyOn(BatchedMesh3D.prototype, name))

const writesOf = (spies: ReturnType<typeof countWrites>): number =>
  Array.reduce(spies, 0, (sum, spy) => sum + spy.mock.calls.length)

const furnitureOf = () => {
  const parent = new Container3D()
  const voxels = new VoxelBatch({ parent, textures })
  return {
    voxels,
    furniture: new Furniture({ level, parent, voxels }),
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the furniture, built once per level', () => {
  test('the level has furniture to build', () => {
    expect(tallCoverOf(level).length).toBeGreaterThan(5)
  })

  test('a still frame writes no slot, and its shadow key holds', () => {
    const { furniture } = furnitureOf()
    const first = furniture.apply({ fades: new Map(), view: WHOLE_HOUSE })
    const spies = countWrites()
    const again = furniture.apply({ fades: new Map(), view: WHOLE_HOUSE })
    expect(writesOf(spies)).toBe(0)
    expect(again).toBe(first)
  })

  test('the per-frame voxel batch stands none of it', () => {
    const { furniture, voxels } = furnitureOf()
    const standLeaf = vi.spyOn(voxels, 'standLeaf')
    furniture.apply({ fades: new Map(), view: WHOLE_HOUSE })
    furniture.apply({ fades: new Map(), view: WHOLE_HOUSE })
    expect(standLeaf).not.toHaveBeenCalled()
  })

  test('a fade or a cull touches only the pieces it changes', () => {
    const { furniture } = furnitureOf()
    const shown = furniture.apply({ fades: new Map(), view: WHOLE_HOUSE })
    const cover = Array.findFirst(
      tallCoverOf(level),
      ({ shapes }) =>
        !Array.some(
          flatten(shapes),
          ({ shape }) =>
            shape._tag === 'Image' && spriteDepthOf(shape)?.isUpright === true,
        ),
    ).pipe(Option.getOrThrow)
    const spies = countWrites()
    const faded = furniture.apply({
      fades: new Map([[cover, 0.4]]),
      view: WHOLE_HOUSE,
    })
    const oneFade = writesOf(spies)
    expect(oneFade).toBeGreaterThan(0)
    expect(oneFade).toBeLessThan(tallCoverOf(level).length)
    expect(faded).not.toBe(shown)
    const hidden = furniture.apply({ fades: new Map(), view: FAR_AWAY })
    expect(hidden).toBe(0)
    expect(furniture.apply({ fades: new Map(), view: WHOLE_HOUSE })).toBe(shown)
  })
})
