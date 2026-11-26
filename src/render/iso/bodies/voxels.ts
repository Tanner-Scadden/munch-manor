import { Array, Option, String } from 'effect'
import type { Texture } from 'pixi.js'

import {
  BatchedMesh3D,
  type Container3D,
  Geometry3D,
  Material3D,
  Matrix4,
  RenderPassBit,
} from '@pixi/3d'

import { type EyePixels, type SpriteDepth, spriteDepthOf } from '#art/sprite.ts'
import { IDENTITY, type Leaf } from '#render/iso/flatten.ts'
import { PART_BIAS } from '#render/iso/house/billboards.ts'
import type { ShadowWatch } from '#render/iso/quality/shadowWatch.ts'
import { UNIT } from '#render/iso/space.ts'
import type { PixelMasks, Textures } from '#render/iso/textures.ts'

import {
  DEPTH_BACK,
  type DepthOf,
  isFlippedOf,
  isGroundedOf,
  slabMatrixOf,
  solidBoundsOf,
  uprightMatrixOf,
  voxelMeshOf,
} from './voxelShape.ts'

const SLOTS = 2048

const FADE_STEPS = 8
const OPAQUE_ALPHA = 0.98

export const fadeStepOf = (alpha: number): number =>
  Math.min(FADE_STEPS, Math.floor(alpha * FADE_STEPS))

export const isOpaqueAt = (alpha: number): boolean => alpha >= OPAQUE_ALPHA
const WARM_SCALE = 1e-4

const {
  lift: _cubeLift,
  lean: _cubeLean,
  caster: _cubeCaster,
  glow: _cubeGlow,
  ...UNIT_CUBE
} = voxelMeshOf({
  width: 1,
  height: 1,
  isSolid: () => true,
  uvOf: () => [0.5, 0.5],
})

const GLOW_TENTHS_SPAN = 1024

type ShapeKey = number

const shapeKeyOf = ({
  isFlipped,
  isGrounded,
  most,
  hasEyes,
}: Readonly<{
  isFlipped: boolean
  isGrounded: boolean
  most: number
  hasEyes: boolean
}>): ShapeKey =>
  most * 8 + (isFlipped ? 4 : 0) + (isGrounded ? 2 : 0) + (hasEyes ? 1 : 0)

export type Carved = Readonly<{
  geometry: Geometry3D
  caster: Geometry3D
  eyes: Geometry3D | undefined
  lift: number
  lean: number
  depthOf?: DepthOf
}>

export const CASTING_ALPHA = 0.5

export type PartReach = { blocks: number }

export const newReach = (): PartReach => ({ blocks: 0 })

export type StandInput = Readonly<{
  leaf: Leaf
  footY: number
  part: number
  isFlash: boolean
  isGlowing?: boolean
  most: number
  reach: PartReach
  spin?: number
  eyes?: EyePixels | undefined
}>

export type VoxelPlacement = Readonly<{
  carved: Carved
  sheet: Texture
  masks: PixelMasks
  texels: Readonly<{ width: number; height: number }>
  isFlipped: boolean
  isUpright: boolean
  elements: ReadonlyArray<number>
  blocks: number
}>

type MutablePlacement = {
  -readonly [Field in keyof VoxelPlacement]: VoxelPlacement[Field]
}

export type Cube = Readonly<{
  x: number
  footY: number
  rise: number
  width: number
  height: number
  color: number
  glow: number
}>

export type VoxelTextures = Pick<
  Textures,
  'imageOf' | 'sheetOf' | 'masksOf' | 'lookOptions'
>

const lit = (
  textures: VoxelTextures,
  options: ConstructorParameters<typeof Material3D>[0],
  look: StandLook,
) =>
  new Material3D({
    vertexColors: true,
    roughness: 1,
    metallic: 0,
    specular: { factor: 0 },
    ...textures.lookOptions(look),
    ...options,
  })

type StandLook = 'Standing' | 'Upright'

const fadedOf = (
  input: Readonly<{
    textures: VoxelTextures
    sheet: Texture
    alpha: number
    look: StandLook
  }>,
): Material3D => {
  const { textures, sheet, alpha, look } = input
  const material = lit(
    textures,
    { baseColorTexture: sheet, alphaMode: 'blend', alpha },
    look,
  )
  material.state.depthMask = true
  return material
}

const depthOfSprite = (
  input: Readonly<{
    depth: SpriteDepth | undefined
    most: number
    columnOf: (column: number) => number
    bottom: number
  }>,
): Readonly<{ depthOf?: DepthOf }> => {
  const { depth, most, columnOf, bottom } = input
  if (depth === undefined) {
    return {}
  }
  if (depth.isUpright === true) {
    return {
      depthOf: (_column, row) => Math.max(1, Math.min(most, bottom + 1 - row)),
    }
  }
  const { rows } = depth
  if (rows !== undefined) {
    return {
      depthOf: (column, row) =>
        Option.match(
          Option.flatMap(Array.get(rows, row), line =>
            String.charAt(line, columnOf(column)),
          ),
          {
            onNone: () => undefined,
            onSome: symbol => Math.min(most, Number.parseInt(symbol, 16) || 0),
          },
        ),
    }
  }
  return depth.isBox === true ? { depthOf: () => most } : {}
}

export class VoxelBatch {
  private readonly batch: BatchedMesh3D
  private readonly casters: BatchedMesh3D
  private readonly textures: VoxelTextures
  private readonly scratch = new Matrix4()
  private readonly watch: ShadowWatch | undefined
  private used = 0
  private readonly filled: Array<boolean> = []
  private readonly slotGeometry: Array<Geometry3D | undefined> = []
  private readonly slotMaterial: Array<Material3D | undefined> = []
  private readonly slotPasses: Array<number> = []
  private castersUsed = 0
  private readonly casterGeometry: Array<Geometry3D | undefined> = []
  private readonly casterShown: Array<boolean> = []
  private readonly casterMaterial = new Material3D({})
  private readonly geometries = new Map<Texture, Map<ShapeKey, Carved>>()
  private readonly solidBottoms = new Map<Texture, number>()
  private readonly sheetMaterials: Readonly<
    Record<StandLook, Map<Texture, Array<Material3D>>>
  > = { Standing: new Map(), Upright: new Map() }
  private readonly colorMaterials = new Map<number, Material3D>()
  private readonly glowMaterials = new Map<Texture, Material3D>()
  private readonly cube = new Geometry3D({ ...UNIT_CUBE })
  private isBlendWarm = false
  private placement: MutablePlacement | undefined = undefined
  private readonly flash = new Material3D({
    baseColor: 0x000000,
    emissive: { color: 0xffffff, strength: 1 },
  })

  constructor(
    input: Readonly<{
      parent: Container3D
      textures: VoxelTextures
      watch?: ShadowWatch
    }>,
  ) {
    this.textures = input.textures
    this.watch = input.watch
    this.batch = new BatchedMesh3D({ size: SLOTS })
    this.casters = new BatchedMesh3D({ size: SLOTS })
    input.parent.addChild(this.batch)
    input.parent.addChild(this.casters)
  }

  begin(): void {
    this.used = 0
    this.castersUsed = 0
  }

  end(): void {
    for (let index = this.used; index < this.filled.length; index += 1) {
      if (this.batch.getVisibleAt(index)) {
        this.batch.setVisibleAt(index, false)
      }
    }
    for (
      let index = this.castersUsed;
      index < this.casterShown.length;
      index += 1
    ) {
      if (this.casterShown[index] === true) {
        this.casterShown[index] = false
        this.casters.setVisibleAt(index, false)
      }
    }
  }

  standLeaf(input: StandInput): boolean {
    const { leaf, isFlash, reach } = input
    const isGlowing = input.isGlowing === true
    const { shape, alpha } = leaf
    if (shape._tag !== 'Image' || this.used >= SLOTS) {
      return false
    }
    const step = fadeStepOf(alpha)
    if (step < 1) {
      return true
    }
    const placement = this.placeInto(input, this.placement)
    this.placement = placement ?? this.placement
    if (placement === undefined) {
      return false
    }
    const { carved, sheet, elements, blocks, isUpright } = placement
    reach.blocks = blocks
    const isOpaque = isFlash || isOpaqueAt(alpha)
    this.fill({
      geometry: carved.geometry,
      material: isFlash
        ? this.flash
        : this.materialOf({ sheet, alpha, isUpright, isGlowing }),
      elements,
      passes: isOpaque ? RenderPassBit.OPAQUE : RenderPassBit.TRANSPARENT,
    })
    if (carved.eyes !== undefined && this.used < SLOTS) {
      this.fill({
        geometry: carved.eyes,
        material: isFlash ? this.flash : this.glowMaterialOf(sheet),
        elements,
        passes: RenderPassBit.OPAQUE,
      })
    }
    if (alpha >= CASTING_ALPHA && !isGlowing && !isUpright) {
      this.cast(carved.caster)
    }
    if (!this.isBlendWarm && this.used < SLOTS) {
      this.isBlendWarm = true
      this.fill({
        geometry: carved.geometry,
        material: this.sheetMaterialOf({ sheet, step: 1, look: 'Standing' }),
        elements: Array.map(elements, (value, index) =>
          index < 12 && index % 4 !== 3 ? value * WARM_SCALE : value,
        ),
        passes: RenderPassBit.TRANSPARENT,
      })
    }
    return true
  }

  materialOf(
    input: Readonly<{
      sheet: Texture
      alpha: number
      isUpright: boolean
      isGlowing: boolean
    }>,
  ): Material3D {
    const { sheet, alpha, isUpright, isGlowing } = input
    return isGlowing
      ? this.glowMaterialOf(sheet)
      : this.sheetMaterialOf({
          sheet,
          step: isOpaqueAt(alpha) ? FADE_STEPS : fadeStepOf(alpha),
          look: isUpright ? 'Upright' : 'Standing',
        })
  }

  private watchCast(caster: Geometry3D): void {
    if (this.watch === undefined) {
      return
    }
    const { center, radius } = caster.boundsSphere
    this.watch.cast({
      shape: caster,
      elements: this.scratch.elements,
      center,
      radius,
    })
  }

  private cast(caster: Geometry3D): void {
    if (this.castersUsed >= SLOTS) {
      return
    }
    const index = this.castersUsed
    this.castersUsed += 1
    if (this.casterGeometry[index] !== caster) {
      if (this.casterGeometry[index] === undefined) {
        this.casters.setMaterialAt(index, this.casterMaterial)
        this.casters.setPassesAt(index, RenderPassBit.SHADOW)
      }
      this.casterGeometry[index] = caster
      this.casters.setGeometryAt(index, caster)
    }
    this.casters.setMatrixAt(index, this.scratch)
    this.watchCast(caster)
    if (this.casterShown[index] !== true) {
      this.casterShown[index] = true
      this.casters.setVisibleAt(index, true)
    }
  }

  placementOf(input: StandInput): Option.Option<VoxelPlacement> {
    return Option.fromUndefinedOr(this.placeInto(input, undefined))
  }

  private placeInto(
    input: StandInput,
    into: MutablePlacement | undefined,
  ): MutablePlacement | undefined {
    const { leaf, footY, part, most, reach, spin, eyes } = input
    const { shape, matrix } = leaf
    if (shape._tag !== 'Image') {
      return undefined
    }
    const texture = this.textures.imageOf(shape, false)
    if (texture === undefined) {
      return undefined
    }
    const sheet = this.textures.sheetOf(texture)
    const masks = this.textures.masksOf(texture)
    if (sheet === undefined || masks === undefined) {
      return undefined
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
    const depth = spriteDepthOf(shape)
    const isUpright = depth?.isUpright === true
    const carved = this.carvedOf({
      texture,
      sheet,
      masks,
      isFlipped,
      isGrounded,
      most,
      depth,
      eyes,
    })
    const blocks = Math.max(
      isGrounded && !isUpright ? carved.lift : 0,
      reach.blocks,
    )
    const slab = {
      matrix,
      box: shape,
      texels,
      footY,
      hover: 0,
      nudge: part * PART_BIAS + blocks * DEPTH_BACK * UNIT,
      depth: 1,
      ...(spin === undefined ? {} : { spin }),
    }
    const { elements } = isUpright
      ? uprightMatrixOf({ ...slab, lean: carved.lean })
      : slabMatrixOf(slab)
    if (into === undefined) {
      return {
        carved,
        sheet,
        masks,
        texels,
        isFlipped,
        isUpright,
        elements,
        blocks,
      }
    }
    into.carved = carved
    into.sheet = sheet
    into.masks = masks
    into.texels = texels
    into.isFlipped = isFlipped
    into.isUpright = isUpright
    into.elements = elements
    into.blocks = blocks
    return into
  }

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
      depth: SpriteDepth | undefined
      eyes: EyePixels | undefined
    }>,
  ): Carved {
    const { texture, sheet, masks, isFlipped, isGrounded, depth } = input
    const { x, y, width, height } = texture.frame
    const most = depth?.most ?? input.most
    const eyes =
      input.eyes?.width === width && input.eyes.height === height
        ? input.eyes
        : undefined
    const shapeKey = shapeKeyOf({
      isFlipped,
      isGrounded,
      most,
      hasEyes: eyes !== undefined,
    })
    const knownShapes = this.geometries.get(texture)
    const shapes = knownShapes ?? new Map<ShapeKey, Carved>()
    if (knownShapes === undefined) {
      this.geometries.set(texture, shapes)
    }
    const known = shapes.get(shapeKey)
    if (known !== undefined) {
      return known
    }
    const columnOf = (column: number): number =>
      isFlipped ? width - 1 - column : column
    const sheetWidth = Math.max(1, sheet.source.width)
    const sheetHeight = Math.max(1, sheet.source.height)
    const hand = depthOfSprite({
      depth,
      most,
      columnOf,
      bottom: this.solidBottomOf(texture, masks),
    })
    const { lift, lean, caster, glow, ...mesh } = voxelMeshOf({
      width,
      height,
      isSolid: (column, row) =>
        masks.solid[row * width + columnOf(column)] === 1,
      isDark: (column, row) => masks.dark[row * width + columnOf(column)] === 1,
      isGrounded,
      most,
      ...hand,
      isUpright: depth?.isUpright === true,
      uvOf: (column, row) => [
        (x + columnOf(column) + 0.5) / sheetWidth,
        (y + row + 0.5) / sheetHeight,
      ],
      ...(eyes === undefined
        ? {}
        : {
            isGlow: (column: number, row: number) =>
              eyes.isEye[row * width + columnOf(column)] === 1,
          }),
    })
    const carved = {
      geometry: new Geometry3D({ ...mesh }),
      caster: new Geometry3D({ ...caster }),
      eyes: glow === undefined ? undefined : new Geometry3D({ ...glow }),
      lift,
      lean,
      ...hand,
    }
    shapes.set(shapeKey, carved)
    return carved
  }

  private sheetMaterialOf(
    input: Readonly<{ sheet: Texture; step: number; look: StandLook }>,
  ): Material3D {
    const { sheet, step, look } = input
    const byLook = this.sheetMaterials[look]
    const steps =
      byLook.get(sheet) ??
      Array.makeBy(FADE_STEPS + 1, at =>
        at === FADE_STEPS
          ? lit(this.textures, { baseColorTexture: sheet }, look)
          : fadedOf({
              textures: this.textures,
              sheet,
              alpha: at / FADE_STEPS,
              look,
            }),
      )
    byLook.set(sheet, steps)
    return steps[step] ?? lit(this.textures, { baseColorTexture: sheet }, look)
  }

  glowMaterialOf(sheet: Texture): Material3D {
    const known = this.glowMaterials.get(sheet)
    if (known !== undefined) {
      return known
    }
    const material = new Material3D({
      vertexColors: true,
      baseColor: 0x000000,
      emissive: { texture: sheet, strength: 1 },
    })
    this.glowMaterials.set(sheet, material)
    return material
  }

  private colorMaterialOf(color: number, glow: number): Material3D {
    const tenths = Math.max(0, Math.round(glow * 10))
    const strength = tenths / 10
    const key =
      color * GLOW_TENTHS_SPAN + Math.min(tenths, GLOW_TENTHS_SPAN - 1)
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
        : lit(this.textures, { baseColor: color }, 'Standing')
    this.colorMaterials.set(key, material)
    return material
  }

  destroy(): void {
    this.batch.destroy()
    this.casters.destroy()
    for (const shapes of this.geometries.values()) {
      for (const { geometry, caster, eyes } of shapes.values()) {
        geometry.destroy()
        caster.destroy()
        eyes?.destroy()
      }
    }
    this.casterMaterial.destroy()
    this.cube.destroy()
    this.geometries.clear()
    this.solidBottoms.clear()
    this.sheetMaterials.Standing.clear()
    this.sheetMaterials.Upright.clear()
    this.colorMaterials.clear()
    this.glowMaterials.clear()
  }
}
