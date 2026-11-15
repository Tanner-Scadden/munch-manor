// What stands stands carved: zombies, players, their guns and props, traps,
// pickups, the house's furniture and set pieces, each sprite carved into
// blocks (voxelShape.ts), lit by the room with their true faces; the blast's
// glowing blocks and the debris in the air as cubes. All of it in one batch,
// its slots pooled frame to frame, each carve built once and kept.

import { Option } from 'effect'
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
import { UNIT } from './space'
import type { PixelMasks, Textures } from './textures'
import {
  DEPTH_BACK,
  isFlippedOf,
  isGroundedOf,
  slabMatrixOf,
  solidBoundsOf,
  voxelMeshOf,
} from './voxelShape'

// NOTE: the most blocks of sprites and cubes standing at once. Past it the
// rest stand as billboards, as before.
const SLOTS = 2048

// NOTE: a fading body (a zombie dying, one at the edge of the cellar's
// dark) stays blocks and fades in this many steps, each its own blended
// material; under the first step it is gone.
const FADE_STEPS = 8
const OPAQUE_ALPHA = 0.98
// NOTE: how small the warm-up copy stands (see `isBlendWarm`).
const WARM_SCALE = 1e-4

const { lift: _cubeLift, ...UNIT_CUBE } = voxelMeshOf({
  width: 1,
  height: 1,
  isSolid: () => true,
  uvOf: () => [0.5, 0.5],
})

// NOTE: how a crop's blocks stand: with its columns reversed or not (its
// matrix mirrored), on the floor with its sides darkening toward it or not,
// and the most blocks deep it is carved, as `true|false|255` and the like.
type ShapeKey = `${boolean}|${boolean}|${number}`

const shapeKeyOf = ({
  isFlipped,
  isGrounded,
  most,
}: Readonly<{
  isFlipped: boolean
  isGrounded: boolean
  most: number
}>): ShapeKey => `${isFlipped}|${isGrounded}|${most}`

// NOTE: a carve's geometry and how many blocks it moves toward the lens to
// stand on the floor (`voxelMeshOf`'s lift).
export type Carved = Readonly<{ geometry: Geometry3D; lift: number }>

// NOTE: where a drawable's parts stand along the lens's ray: each part in
// front of every part before it, as the 2D game painted it over them, in
// blocks toward the lens from the sprites' plane. Begun for each drawable.
export type PartReach = { blocks: number }

export const newReach = (): PartReach => ({ blocks: 0 })

export type StandInput = Readonly<{
  leaf: Leaf
  footY: number
  part: number
  isFlash: boolean
  most: number
  reach: PartReach
  spin?: number
}>

// NOTE: a sprite's blocks as they stand: their carve, its sheet and pixel
// masks, its size in pixels, whether its columns run mirrored, the matrix
// that stands them (sixteen numbers, column by column), and how many blocks
// they moved toward the lens.
export type VoxelPlacement = Readonly<{
  carved: Carved
  sheet: Texture
  masks: PixelMasks
  texels: Readonly<{ width: number; height: number }>
  isFlipped: boolean
  elements: ReadonlyArray<number>
  blocks: number
}>

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

// NOTE: every material here takes the blocks' vertex colors: white on the
// fronts, darker toward the foot on a standing body's sides (voxelShape.ts).
const lit = (
  textures: Textures,
  options: ConstructorParameters<typeof Material3D>[0],
) =>
  new Material3D({
    vertexColors: true,
    roughness: 1,
    metallic: 0,
    specular: { factor: 0 },
    ...textures.lookOptions('Standing'),
    ...options,
  })

// NOTE: a fading body's blocks, blended but still writing their depth, so
// its front faces (drawn first, voxelShape.ts) hide the tops and sides
// behind them and it fades as the flat sprite did, never showing its insides.
const fadedOf = (
  textures: Textures,
  sheet: Texture,
  alpha: number,
): Material3D => {
  const material = lit(textures, {
    baseColorTexture: sheet,
    alphaMode: 'blend',
    alpha,
  })
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
  // NOTE: each crop's blocks by how they stand (`shapeKeyOf`), and its
  // lowest solid row.
  private readonly geometries = new Map<Texture, Map<ShapeKey, Carved>>()
  private readonly solidBottoms = new Map<Texture, number>()
  // NOTE: each sheet's materials by fade step, the last step opaque.
  private readonly sheetMaterials = new Map<Texture, Array<Material3D>>()
  private readonly colorMaterials = new Map<string, Material3D>()
  private readonly cube = new Geometry3D({ ...UNIT_CUBE })
  // NOTE: a fading body draws through its own shader program, which the GPU
  // links the first time one is drawn: about 8 ms on a desktop and many
  // times that on a phone, the hitch as the first zombie of a run fell. So
  // the first body that stands also stands a copy too small to see in a
  // faded material, and the program is linked with the rest as the run
  // starts.
  private isBlendWarm = false
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

  // NOTE: a sprite of what stands as its carved blocks, faded as it is, or
  // false when it must stand as a billboard: not an image, still loading, or
  // no slot left. One faded past seeing stands as nothing. `most` caps how
  // deep it is carved; `reach` keeps it in front of the parts before it.
  standLeaf(input: StandInput): boolean {
    const { leaf, isFlash, reach } = input
    const { shape, alpha } = leaf
    if (shape._tag !== 'Image' || this.used >= SLOTS) {
      return false
    }
    const step = Math.min(FADE_STEPS, Math.floor(alpha * FADE_STEPS))
    if (step < 1) {
      return true
    }
    // NOTE: checked by hand, not Option.match, so the hot path builds no
    // handler closures per leaf per frame.
    const placement = this.placementOf(input)
    if (Option.isNone(placement)) {
      return false
    }
    const { carved, sheet, elements, blocks } = placement.value
    reach.blocks = blocks
    const isOpaque = isFlash || alpha >= OPAQUE_ALPHA
    this.fill({
      geometry: carved.geometry,
      material: isFlash
        ? this.flash
        : this.sheetMaterialOf(sheet, isOpaque ? FADE_STEPS : step),
      elements,
      passes: isOpaque ? RenderPassBit.OPAQUE : RenderPassBit.TRANSPARENT,
    })
    if (!this.isBlendWarm && this.used < SLOTS) {
      this.isBlendWarm = true
      this.fill({
        geometry: carved.geometry,
        material: this.sheetMaterialOf(sheet, 1),
        elements: Array.from(elements, (value, index) =>
          index < 12 && index % 4 !== 3 ? value * WARM_SCALE : value,
        ),
        passes: RenderPassBit.TRANSPARENT,
      })
    }
    return true
  }

  // NOTE: where a sprite's blocks stand, as `standLeaf` stands them, and
  // what they are carved from: none for a sprite still loading. Read alone,
  // it moves no `reach`: Munch Studio's stage maps a press on a block back
  // to the sprite's pixel through it (tools/studio/stage3d.ts).
  placementOf(input: StandInput): Option.Option<VoxelPlacement> {
    const { leaf, footY, part, most, reach, spin } = input
    const { shape, matrix } = leaf
    if (shape._tag !== 'Image') {
      return Option.none()
    }
    const texture = this.textures.imageOf(shape, false)
    if (texture === undefined) {
      return Option.none()
    }
    const sheet = this.textures.sheetOf(texture)
    const masks = this.textures.masksOf(texture)
    if (sheet === undefined || masks === undefined) {
      return Option.none()
    }
    const texels = {
      width: texture.frame.width,
      height: texture.frame.height,
    }
    const isGrounded = isGroundedOf({
      matrix,
      box: shape,
      texels,
      footY,
      solidBottom: this.solidBottomOf(texture, masks),
    })
    const isFlipped = isFlippedOf({ matrix, box: shape })
    const carved = this.carvedOf({
      texture,
      sheet,
      masks,
      isFlipped,
      isGrounded,
      most,
    })
    // NOTE: a body on the floor moves toward the lens until its lowest
    // block stands on it; any part moves at least as far as the parts
    // before it reach, so it shows over them as the 2D game drew it.
    const blocks = Math.max(isGrounded ? carved.lift : 0, reach.blocks)
    const { elements } = slabMatrixOf({
      matrix,
      box: shape,
      texels,
      footY,
      hover: 0,
      nudge: part * PART_BIAS + blocks * DEPTH_BACK * UNIT,
      depth: 1,
      ...(spin === undefined ? {} : { spin }),
    })
    return Option.some({
      carved,
      sheet,
      masks,
      texels,
      isFlipped,
      elements,
      blocks,
    })
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

  private solidBottomOf(texture: Texture, masks: PixelMasks): number {
    const known = this.solidBottoms.get(texture)
    if (known !== undefined) {
      return known
    }
    const { width, height } = texture.frame
    const { bottom } = solidBoundsOf({
      width,
      height,
      isSolid: (column, row) => masks.solid[row * width + column] === 1,
    })
    this.solidBottoms.set(texture, bottom)
    return bottom
  }

  private carvedOf(
    input: Readonly<{
      texture: Texture
      sheet: Texture
      masks: PixelMasks
      isFlipped: boolean
      isGrounded: boolean
      most: number
    }>,
  ): Carved {
    const { texture, sheet, masks, isFlipped, isGrounded, most } = input
    const shapeKey = shapeKeyOf({ isFlipped, isGrounded, most })
    const shapes = this.geometries.get(texture) ?? new Map<ShapeKey, Carved>()
    this.geometries.set(texture, shapes)
    const known = shapes.get(shapeKey)
    if (known !== undefined) {
      return known
    }
    const { x, y, width, height } = texture.frame
    const columnOf = (column: number): number =>
      isFlipped ? width - 1 - column : column
    const sheetWidth = Math.max(1, sheet.source.width)
    const sheetHeight = Math.max(1, sheet.source.height)
    const { lift, ...mesh } = voxelMeshOf({
      width,
      height,
      isSolid: (column, row) =>
        masks.solid[row * width + columnOf(column)] === 1,
      isDark: (column, row) => masks.dark[row * width + columnOf(column)] === 1,
      isGrounded,
      most,
      uvOf: (column, row) => [
        (x + columnOf(column) + 0.5) / sheetWidth,
        (y + row + 0.5) / sheetHeight,
      ],
    })
    const carved = { geometry: new Geometry3D({ ...mesh }), lift }
    shapes.set(shapeKey, carved)
    return carved
  }

  private sheetMaterialOf(sheet: Texture, step: number): Material3D {
    const steps =
      this.sheetMaterials.get(sheet) ??
      Array.from({ length: FADE_STEPS + 1 }, (_, at) =>
        at === FADE_STEPS
          ? lit(this.textures, { baseColorTexture: sheet })
          : fadedOf(this.textures, sheet, at / FADE_STEPS),
      )
    this.sheetMaterials.set(sheet, steps)
    return steps[step] ?? lit(this.textures, { baseColorTexture: sheet })
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
        : lit(this.textures, { baseColor: color })
    this.colorMaterials.set(key, material)
    return material
  }

  destroy(): void {
    this.batch.destroy()
    for (const shapes of this.geometries.values()) {
      for (const { geometry } of shapes.values()) {
        geometry.destroy()
      }
    }
    this.cube.destroy()
    this.geometries.clear()
    this.solidBottoms.clear()
    this.sheetMaterials.clear()
    this.colorMaterials.clear()
  }
}
