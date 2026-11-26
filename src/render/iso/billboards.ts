import { Texture } from 'pixi.js'

import {
  type Container3D,
  Material3D,
  Mesh3D,
  PlaneGeometry,
  Sprite3D,
} from '@pixi/3d'

import type * as Draw from '../draw'
import type { Leaf } from './flatten'
import { UNIT, standingPointOf, zOf } from './space'
import { type Textures, colorOf } from './textures'

export const PART_BIAS = 0.002

type DrawnLeaf = Readonly<{
  texture: Texture
  centerX: number
  bottom: number
  drawnWidth: number
  drawnHeight: number
  tint: number
  alpha: number
}>

export type Placement = DrawnLeaf &
  Readonly<{ footY: number; hover: number; part: number }>

const WHITE = { color: 0xffffff, alpha: 1 }

const textureAndTint = (
  textures: Textures,
  shape: Draw.Image | Draw.Rect,
  isFlipped: boolean,
): Readonly<{ texture: Texture; color: number; alpha: number }> | undefined => {
  if (shape._tag === 'Image') {
    const texture = textures.imageOf(shape, isFlipped)
    return texture === undefined ? undefined : { texture, ...WHITE }
  }
  return shape.fill === undefined
    ? undefined
    : { texture: Texture.WHITE, ...colorOf(shape.fill) }
}

const drawnLeafOf = ({
  textures,
  leaf: { shape, matrix, alpha },
}: Readonly<{ textures: Textures; leaf: Leaf }>): DrawnLeaf | undefined => {
  if (shape._tag !== 'Image' && shape._tag !== 'Rect') {
    return undefined
  }
  const middleX = shape.x + shape.width / 2
  const middleY = shape.y + shape.height / 2
  const centerX = matrix.a * middleX + matrix.c * middleY + matrix.e
  const centerY = matrix.b * middleX + matrix.d * middleY + matrix.f
  const drawnWidth = Math.hypot(matrix.a, matrix.b) * shape.width
  const drawnHeight = Math.hypot(matrix.c, matrix.d) * shape.height
  if (drawnWidth < 0.01 || drawnHeight < 0.01) {
    return undefined
  }
  const width = matrix.a < 0 ? -drawnWidth : drawnWidth
  const look = textureAndTint(textures, shape, width < 0)
  return look === undefined
    ? undefined
    : {
        texture: look.texture,
        centerX,
        bottom: centerY + drawnHeight / 2,
        drawnWidth,
        drawnHeight,
        tint: look.color,
        alpha: look.alpha * alpha,
      }
}

const IS_SHADED = !new URLSearchParams(window.location.search).has('flat')

const litMaterial = (textures: Textures): Material3D =>
  new Material3D({
    roughness: 1,
    metallic: 0,
    specular: { factor: 0 },
    ...(IS_SHADED ? { normalTexture: textures.flatNormal() } : {}),
    ...textures.lookOptions('Standing'),
  })

export class BillboardPool {
  private readonly sprites: Array<Sprite3D> = []
  private readonly materials: Array<Material3D | undefined> = []
  private used = 0
  private readonly parent: Container3D
  private readonly textures: Textures
  private readonly isLit: boolean

  constructor(
    input: Readonly<{
      parent: Container3D
      textures: Textures
      isLit: boolean
    }>,
  ) {
    this.parent = input.parent
    this.textures = input.textures
    this.isLit = input.isLit
  }

  begin(): void {
    this.used = 0
  }

  end(): void {
    for (let index = this.used; index < this.sprites.length; index += 1) {
      const sprite = this.sprites[index]
      if (sprite !== undefined) {
        sprite.visible = false
      }
    }
  }

  release(): void {
    for (const sprite of this.sprites) {
      sprite.visible = false
      if (sprite.texture !== Texture.WHITE) {
        sprite.texture = Texture.WHITE
      }
    }
  }

  standLeaves(
    leaves: ReadonlyArray<Leaf>,
    footY: number,
    hover: number,
    opacity: number,
  ): void {
    let part = 0
    for (const leaf of leaves) {
      const drawn = drawnLeafOf({ textures: this.textures, leaf })
      if (drawn !== undefined) {
        this.place({
          ...drawn,
          footY,
          hover,
          alpha: drawn.alpha * opacity,
          part,
        })
        part += 1
      }
    }
  }

  standLeaf(leaf: Leaf, footY: number, part: number): void {
    const drawn = drawnLeafOf({ textures: this.textures, leaf })
    if (drawn !== undefined) {
      this.place({ ...drawn, footY, hover: 0, part })
    }
  }

  place(p: Placement): void {
    const index = this.used
    const sprite = this.next()
    if (sprite.texture !== p.texture) {
      sprite.texture = p.texture
    }
    const material = this.materials[index]
    if (material !== undefined && IS_SHADED) {
      const normal = this.textures.normalOf(p.texture)
      if (material.textures.normal !== normal) {
        material.textures.normal = normal
      }
    }
    const pixel = p.drawnHeight / p.texture.frame.height
    const pixelSize = pixel * UNIT
    if (sprite.pixelSize !== pixelSize) {
      sprite.pixelSize = pixelSize
    }
    const scaleX = p.drawnWidth / p.texture.frame.width / pixel
    if (sprite.scale.x !== scaleX) {
      sprite.scale.x = scaleX
    }
    if (sprite.tint !== p.tint) {
      sprite.tint = p.tint
    }
    if (sprite.alpha !== p.alpha) {
      sprite.alpha = p.alpha
    }
    const mode = p.alpha < 0.98 ? 'blend' : 'mask'
    if (sprite.alphaMode !== mode) {
      sprite.alphaMode = mode
    }
    const left = Math.round(p.centerX - p.drawnWidth / 2)
    const at = standingPointOf({
      x: left + p.drawnWidth / 2,
      footY: Math.round(p.footY),
      atY: Math.round(p.bottom) - Math.round(p.hover) - p.drawnHeight / 2,
      out: p.part * PART_BIAS,
    })
    sprite.position.set(at.x, at.y, at.z)
    if (!sprite.visible) {
      sprite.visible = true
    }
  }

  private next(): Sprite3D {
    const existing = this.sprites[this.used]
    this.used += 1
    if (existing !== undefined) {
      return existing
    }
    const material = this.isLit ? litMaterial(this.textures) : undefined
    const sprite = new Sprite3D({
      texture: Texture.WHITE,
      ...(material === undefined ? {} : { material }),
      anchor: { x: 0.5, y: 0.5 },
      billboardMode: 'spherical',
      alphaMode: 'mask',
      alphaCutoff: 0.5,
      position: { x: 0, y: 0, z: 0 },
    })
    this.parent.addChild(sprite)
    this.sprites.push(sprite)
    this.materials.push(material)
    return sprite
  }
}

const RIM_REACH = 80
const RIM_COLOR = 0xffd7a0
const RIM_FLASH_COLOR = 0xfff4e0

export type Lamp = Readonly<{ x: number; y: number; flash: number }>

export const rimUp = (
  input: Readonly<{
    pool: BillboardPool
    textures: Textures
    leaves: ReadonlyArray<Leaf>
    footY: number
    lamp: Lamp
  }>,
): void => {
  const { pool, textures, leaves, footY, lamp } = input
  const drawn: Array<DrawnLeaf> = []
  for (const leaf of leaves) {
    const one = drawnLeafOf({ textures, leaf })
    if (one !== undefined) {
      drawn.push(one)
    }
  }
  const [first] = drawn
  if (first === undefined) {
    return
  }
  const dx = lamp.x - first.centerX
  const dy = lamp.y - footY
  const distance = Math.hypot(dx, dy)
  if (distance < 6 || distance > RIM_REACH) {
    return
  }
  const strength = Math.min(
    1,
    (1 - distance / RIM_REACH) ** 1.5 * (1 + 0.8 * lamp.flash),
  )
  const offsetX = Math.round(dx / distance)
  const offsetY = Math.round(dy / distance)
  const tint = lamp.flash > 0.3 ? RIM_FLASH_COLOR : RIM_COLOR
  for (const leaf of drawn) {
    pool.place({
      ...leaf,
      texture: textures.silhouetteOf(leaf.texture),
      centerX: leaf.centerX + offsetX,
      bottom: leaf.bottom + offsetY,
      footY,
      hover: 0,
      tint,
      alpha: Math.min(0.97, strength * leaf.alpha),
      part: -1,
    })
  }
}

const CASTER_GEOMETRY = new PlaneGeometry({ width: 1, height: 1 })

export type Cutout = Readonly<{
  texture: Texture
  left: number
  top: number
  width: number
  height: number
  footY: number
}>

export const standCutout = (
  input: Readonly<{
    parent: Container3D
    material: Material3D
    cutout: Cutout
  }>,
): Mesh3D => {
  const { parent, material, cutout } = input
  const mesh = new Mesh3D({
    geometry: CASTER_GEOMETRY,
    material,
    castShadow: true,
    receiveShadow: false,
  })
  mesh.disablePass('opaque')
  mesh.rotation.z = Math.PI
  mesh.rotation.y = Math.PI
  placeCutout(mesh, cutout)
  parent.addChild(mesh)
  return mesh
}

const placeCutout = (mesh: Mesh3D, cutout: Cutout): void => {
  mesh.scale.set(cutout.width * UNIT, cutout.height * UNIT, 1)
  mesh.position.set(
    (cutout.left + cutout.width / 2) * UNIT,
    (cutout.footY - cutout.top - cutout.height / 2) * UNIT,
    zOf(cutout.footY),
  )
}
