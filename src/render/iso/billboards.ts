// What stands up: every drawable the game draws above its foot becomes
// billboards at that foot, as tall as it is drawn; the lamp's rim on what
// stands near the player; and the hidden stand-ins its shadow is cast
// through.

import type { Canvas } from 'foldkit'
import { Texture } from 'pixi.js'

import {
  type Container3D,
  Material3D,
  Mesh3D,
  PlaneGeometry,
  Sprite3D,
} from '@pixi/3d'

import { type Leaf, flatten } from './flatten'
import { CAMERA_UP, TOWARD_CAMERA, UNIT, zOf } from './space'
import { type Textures, colorOf } from './textures'

// NOTE: parts later in a drawable win ties, nudged this far toward the lens.
const PART_BIAS = 0.002

// NOTE: a leaf as it is drawn: its texture (a white quad for a Rect), the
// middle of its bottom edge, its size, and its tint.
export type DrawnLeaf = Readonly<{
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
  shape: Canvas.Image | Canvas.Rect,
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

// NOTE: an Image or a filled Rect as it is drawn, or nothing when it draws
// nothing standing (an outline, a path, an image still loading).
export const drawnLeafOf = ({
  textures,
  leaf: { shape, matrix, alpha },
}: Readonly<{ textures: Textures; leaf: Leaf }>): DrawnLeaf | undefined => {
  if (shape._tag !== 'Image' && shape._tag !== 'Rect') {
    return undefined
  }
  const left = matrix.a * shape.x + matrix.c * shape.y + matrix.e
  const top = matrix.b * shape.x + matrix.d * shape.y + matrix.f
  const width = matrix.a * shape.width + matrix.c * shape.height
  const height = matrix.b * shape.width + matrix.d * shape.height
  const drawnWidth = Math.abs(width)
  const drawnHeight = Math.abs(height)
  if (drawnWidth < 0.01 || drawnHeight < 0.01) {
    return undefined
  }
  const look = textureAndTint(textures, shape, width < 0)
  return look === undefined
    ? undefined
    : {
        texture: look.texture,
        centerX: left + width / 2,
        bottom: Math.max(top, top + height),
        drawnWidth,
        drawnHeight,
        tint: look.color,
        alpha: look.alpha * alpha,
      }
}

// NOTE: whether lit sprites wear their sheet's normal map, so the light
// rounds their bodies. `?flat` in the address turns it off, to compare.
const IS_SHADED = !new URLSearchParams(window.location.search).has('flat')

const litMaterial = (textures: Textures): Material3D =>
  new Material3D({
    roughness: 1,
    metallic: 0,
    specular: { factor: 0 },
    ...(IS_SHADED ? { normalTexture: textures.flatNormal() } : {}),
  })

// NOTE: a pool of billboards, lit (Material3D, so the room's light, the lamp,
// and the muzzle flash fall on them) or flat, for what glows of itself
// (flashes, bars, rims). Mutable on purpose: it pools pixi's own objects.
export class BillboardPool {
  private readonly sprites: Array<Sprite3D> = []
  // NOTE: each lit sprite's own material, beside it, to swap its normal map.
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

  standUp(
    shapes: ReadonlyArray<Canvas.Shape>,
    footY: number,
    opacity: number = 1,
  ): void {
    this.standLeaves(flatten(shapes), footY, 0, opacity)
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

  place(p: Placement): void {
    const index = this.used
    const sprite = this.next()
    if (sprite.texture !== p.texture) {
      sprite.texture = p.texture
    }
    // NOTE: asked every placement, not only on a new texture, since a
    // sheet's normal map may arrive after its first frame.
    const material = this.materials[index]
    if (material !== undefined && IS_SHADED) {
      const normal = this.textures.normalOf(p.texture)
      if (material.textures.normal !== normal) {
        material.textures.normal = normal
      }
    }
    const pixel = p.drawnHeight / p.texture.frame.height
    sprite.pixelSize = pixel * UNIT
    sprite.scale.x = p.drawnWidth / p.texture.frame.width / pixel
    sprite.tint = p.tint
    sprite.alpha = p.alpha
    const mode = p.alpha < 0.98 ? 'blend' : 'mask'
    if (sprite.alphaMode !== mode) {
      sprite.alphaMode = mode
    }
    // NOTE: every edge on a whole game pixel, so a sprite moves a whole
    // pixel at a time and never lands between two (pixel-perfect settings,
    // owner, 2026-11-14).
    const left = Math.round(p.centerX - p.drawnWidth / 2)
    const footY = Math.round(p.footY)
    const bottom = Math.round(p.bottom)
    const rise =
      (footY - bottom + Math.round(p.hover) + p.drawnHeight / 2) * UNIT
    const nudge = p.part * PART_BIAS
    sprite.position.set(
      (left + p.drawnWidth / 2) * UNIT +
        CAMERA_UP.x * rise +
        TOWARD_CAMERA.x * nudge,
      CAMERA_UP.y * rise + TOWARD_CAMERA.y * nudge,
      zOf(footY) + CAMERA_UP.z * rise + TOWARD_CAMERA.z * nudge,
    )
    sprite.visible = true
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

// RIMS

// NOTE: how far from the player its lamp draws a rim on what stands, in game
// pixels, and the rim's color, whiter in a muzzle flash.
const RIM_REACH = 80
const RIM_COLOR = 0xffd7a0
const RIM_FLASH_COLOR = 0xfff4e0

export type Lamp = Readonly<{ x: number; y: number; flash: number }>

// NOTE: the lamp's rim on a standing drawable near the player: its shape in
// the lamp's color, one game pixel toward the player and just behind it, so
// only the lit edge shows, fading with distance.
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

// SHADOW STAND-INS

// NOTE: a billboard turns to the lens, and the shadow pass does not turn it
// (nor draws a sprite kept out of the opaque pass), so what stands casts
// through a stand-in: its art cut out upright on a plain mesh at its foot,
// in no pass but the shadow's.
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
  mesh.disablePass('outline')
  // NOTE: a plane's v runs up and a texture's rows run down: turn it over.
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

// NOTE: whatever moves (players, zombies, pickups, traps) casts its shadow
// from the room's light through a stand-in of its biggest sprite, in its
// pose this frame. Mutable on purpose: it pools pixi's own objects.
export class BodyCasters {
  private readonly meshes: Array<Mesh3D> = []
  private used = 0
  private readonly parent: Container3D
  private readonly textures: Textures

  constructor(input: Readonly<{ parent: Container3D; textures: Textures }>) {
    this.parent = input.parent
    this.textures = input.textures
  }

  begin(): void {
    this.used = 0
  }

  end(): void {
    for (let index = this.used; index < this.meshes.length; index += 1) {
      const mesh = this.meshes[index]
      if (mesh !== undefined) {
        mesh.visible = false
      }
    }
  }

  cast(leaves: ReadonlyArray<Leaf>, footY: number): void {
    let biggest: DrawnLeaf | undefined
    for (const leaf of leaves) {
      const drawn =
        leaf.shape._tag === 'Image'
          ? drawnLeafOf({ textures: this.textures, leaf })
          : undefined
      if (
        drawn !== undefined &&
        drawn.alpha >= 0.5 &&
        (biggest === undefined ||
          drawn.drawnWidth * drawn.drawnHeight >
            biggest.drawnWidth * biggest.drawnHeight)
      ) {
        biggest = drawn
      }
    }
    if (biggest === undefined) {
      return
    }
    const material = this.textures.casterMaterialOf(
      this.textures.silhouetteOf(biggest.texture),
    )
    const cutout: Cutout = {
      texture: biggest.texture,
      left: biggest.centerX - biggest.drawnWidth / 2,
      top: biggest.bottom - biggest.drawnHeight,
      width: biggest.drawnWidth,
      height: biggest.drawnHeight,
      footY,
    }
    const existing = this.meshes[this.used]
    this.used += 1
    if (existing === undefined) {
      this.meshes.push(standCutout({ parent: this.parent, material, cutout }))
      return
    }
    if (existing.material !== material) {
      existing.material = material
    }
    placeCutout(existing, cutout)
    existing.visible = true
  }
}
