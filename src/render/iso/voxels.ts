// What moves stands as voxels: zombies, players, their guns, traps, and
// pickups, each sprite's pixels as little blocks (voxelShape.ts), lit by the
// room with their true faces; the blast's glowing blocks and the debris in
// the air as cubes. All of it in one batch, its slots pooled frame to frame.

import type { Texture } from 'pixi.js'

import {
  BatchedMesh3D,
  type Container3D,
  Geometry3D,
  Material3D,
  Matrix4,
  RenderPassBit,
} from '@pixi/3d'

import { PART_BIAS } from './billboards'
import { IDENTITY, type Leaf } from './flatten'
import type { Textures } from './textures'
import { slabMatrixOf, voxelMeshOf } from './voxelShape'

// NOTE: the most blocks of sprites and cubes standing at once. Past it the
// rest stand as billboards, as before.
const SLOTS = 2048

// NOTE: a fading body (a zombie dying, one at the edge of the cellar's
// dark) stays blocks and fades in this many steps, each its own blended
// material; under the first step it is gone.
const FADE_STEPS = 8
const OPAQUE_ALPHA = 0.98

const UNIT_CUBE = voxelMeshOf({
  width: 1,
  height: 1,
  isSolid: () => true,
  uvOf: () => [0.5, 0.5],
})

// NOTE: a cube of color standing at a spot on the floor, raised `rise`
// game pixels, `width` across, `height` tall, and as deep as its smaller side.
export type Cube = Readonly<{
  x: number
  footY: number
  rise: number
  width: number
  height: number
  color: number
  glow: number
}>

const lit = (options: ConstructorParameters<typeof Material3D>[0]) =>
  new Material3D({
    roughness: 1,
    metallic: 0,
    specular: { factor: 0 },
    ...options,
  })

// NOTE: a fading body's blocks, blended but still writing their depth, so
// its front faces (drawn first, voxelShape.ts) hide the tops and sides
// behind them and it fades as the flat sprite did, never showing its insides.
const fadedOf = (sheet: Texture, alpha: number): Material3D => {
  const material = lit({ baseColorTexture: sheet, alphaMode: 'blend', alpha })
  material.state.depthMask = true
  return material
}

// NOTE: mutable on purpose: it pools pixi's own batch slots and caches each
// sprite's blocks for the life of the renderer.
export class VoxelBatch {
  private readonly batch: BatchedMesh3D
  private readonly textures: Textures
  private readonly scratch = new Matrix4()
  private used = 0
  private readonly filled: Array<boolean> = []
  private readonly slotGeometry: Array<Geometry3D | undefined> = []
  private readonly slotMaterial: Array<Material3D | undefined> = []
  private readonly slotPasses: Array<number> = []
  // NOTE: each crop's blocks, upright and with its rows reversed.
  private readonly geometries = new Map<Texture, Map<boolean, Geometry3D>>()
  // NOTE: each sheet's materials by fade step, the last step opaque.
  private readonly sheetMaterials = new Map<Texture, Array<Material3D>>()
  private readonly colorMaterials = new Map<string, Material3D>()
  private readonly cube = new Geometry3D({ ...UNIT_CUBE })
  // NOTE: a hit flash glows white in any light, the cellar's dark too.
  private readonly flash = new Material3D({
    baseColor: 0x000000,
    emissive: { color: 0xffffff, strength: 1 },
  })

  constructor(input: Readonly<{ parent: Container3D; textures: Textures }>) {
    this.textures = input.textures
    this.batch = new BatchedMesh3D({ size: SLOTS })
    input.parent.addChild(this.batch)
  }

  begin(): void {
    this.used = 0
  }

  end(): void {
    for (let index = this.used; index < this.filled.length; index += 1) {
      if (this.batch.getVisibleAt(index)) {
        this.batch.setVisibleAt(index, false)
      }
    }
  }

  // NOTE: a sprite of a standing body as its blocks, faded as it is, or
  // false when it must stand as a billboard: not an image, still loading, or
  // no slot left. One faded past seeing stands as nothing.
  standLeaf(
    input: Readonly<{
      leaf: Leaf
      footY: number
      part: number
      isFlash: boolean
      spin?: number
    }>,
  ): boolean {
    const { leaf, footY, part, isFlash, spin } = input
    const { shape, matrix, alpha } = leaf
    if (shape._tag !== 'Image' || this.used >= SLOTS) {
      return false
    }
    const step = Math.min(FADE_STEPS, Math.floor(alpha * FADE_STEPS))
    if (step < 1) {
      return true
    }
    const texture = this.textures.imageOf(shape, false)
    if (texture === undefined) {
      return false
    }
    const sheet = this.textures.sheetOf(texture)
    const solid = this.textures.solidOf(texture)
    if (sheet === undefined || solid === undefined) {
      return false
    }
    const texels = {
      width: texture.frame.width,
      height: texture.frame.height,
    }
    const { elements, isFlipped } = slabMatrixOf({
      matrix,
      box: shape,
      texels,
      footY,
      hover: 0,
      nudge: part * PART_BIAS,
      depth: 1,
      ...(spin === undefined ? {} : { spin }),
    })
    const geometry = this.geometryOf({ texture, sheet, solid, isFlipped })
    const isOpaque = isFlash || alpha >= OPAQUE_ALPHA
    this.fill({
      geometry,
      material: isFlash
        ? this.flash
        : this.sheetMaterialOf(sheet, isOpaque ? FADE_STEPS : step),
      elements,
      passes: isOpaque ? RenderPassBit.OPAQUE : RenderPassBit.TRANSPARENT,
    })
    return true
  }

  // NOTE: a cube of plain color, glowing or lit, or false with no slot left.
  standCube(cube: Cube): boolean {
    if (this.used >= SLOTS) {
      return false
    }
    const { elements } = slabMatrixOf({
      matrix: IDENTITY,
      box: {
        x: Math.round(cube.x - cube.width / 2),
        y: Math.round(cube.footY - cube.rise - cube.height),
        width: cube.width,
        height: cube.height,
      },
      texels: { width: 1, height: 1 },
      footY: cube.footY,
      hover: 0,
      nudge: 0,
      depth: Math.min(cube.width, cube.height),
    })
    this.fill({
      geometry: this.cube,
      material: this.colorMaterialOf(cube.color, cube.glow),
      elements,
      passes: RenderPassBit.OPAQUE,
    })
    return true
  }

  private fill(
    input: Readonly<{
      geometry: Geometry3D
      material: Material3D
      elements: ReadonlyArray<number>
      passes: number
    }>,
  ): void {
    const { geometry, material, elements, passes } = input
    const index = this.used
    this.used += 1
    if (this.slotGeometry[index] !== geometry) {
      this.slotGeometry[index] = geometry
      this.batch.setGeometryAt(index, geometry)
    }
    if (this.slotMaterial[index] !== material) {
      this.slotMaterial[index] = material
      this.batch.setMaterialAt(index, material)
    }
    this.scratch.fromArray(elements)
    this.batch.setMatrixAt(index, this.scratch)
    this.filled[index] = true
    if (this.slotPasses[index] !== passes) {
      this.slotPasses[index] = passes
      this.batch.setPassesAt(index, passes)
    }
    if (!this.batch.getVisibleAt(index)) {
      this.batch.setVisibleAt(index, true)
    }
  }

  private geometryOf(
    input: Readonly<{
      texture: Texture
      sheet: Texture
      solid: Uint8Array
      isFlipped: boolean
    }>,
  ): Geometry3D {
    const { texture, sheet, solid, isFlipped } = input
    const both = this.geometries.get(texture) ?? new Map<boolean, Geometry3D>()
    this.geometries.set(texture, both)
    const known = both.get(isFlipped)
    if (known !== undefined) {
      return known
    }
    const { x, y, width, height } = texture.frame
    const rowOf = (row: number): number => (isFlipped ? height - 1 - row : row)
    const sheetWidth = Math.max(1, sheet.source.width)
    const sheetHeight = Math.max(1, sheet.source.height)
    const geometry = new Geometry3D({
      ...voxelMeshOf({
        width,
        height,
        isSolid: (column, row) => solid[rowOf(row) * width + column] === 1,
        uvOf: (column, row) => [
          (x + column + 0.5) / sheetWidth,
          (y + rowOf(row) + 0.5) / sheetHeight,
        ],
      }),
    })
    both.set(isFlipped, geometry)
    return geometry
  }

  private sheetMaterialOf(sheet: Texture, step: number): Material3D {
    const steps =
      this.sheetMaterials.get(sheet) ??
      Array.from({ length: FADE_STEPS + 1 }, (_, at) =>
        at === FADE_STEPS
          ? lit({ baseColorTexture: sheet })
          : fadedOf(sheet, at / FADE_STEPS),
      )
    this.sheetMaterials.set(sheet, steps)
    return steps[step] ?? lit({ baseColorTexture: sheet })
  }

  private colorMaterialOf(color: number, glow: number): Material3D {
    const strength = Math.round(glow * 10) / 10
    const key = `${color}|${strength}`
    const known = this.colorMaterials.get(key)
    if (known !== undefined) {
      return known
    }
    const material =
      strength > 0
        ? new Material3D({
            baseColor: 0x000000,
            emissive: { color, strength },
          })
        : lit({ baseColor: color })
    this.colorMaterials.set(key, material)
    return material
  }

  destroy(): void {
    this.batch.destroy()
    for (const both of this.geometries.values()) {
      for (const geometry of both.values()) {
        geometry.destroy()
      }
    }
    this.cube.destroy()
    this.geometries.clear()
    this.sheetMaterials.clear()
    this.colorMaterials.clear()
  }
}
