// The renderer's textures: each sprite source loaded once, each crop of it
// (mirrored when drawn flipped), and each crop's plain white silhouette for
// the lamp's rim and the shadows' stand-ins. One cache per renderer, emptied
// when it goes.

import { Option } from 'effect'
import type { Canvas } from 'foldkit'
import {
  type Application,
  Color,
  type ColorMatrix,
  ColorMatrixFilter,
  Rectangle,
  Sprite,
  Texture,
  TextureSource,
  groupD8,
} from 'pixi.js'

import { Material3D } from '@pixi/3d'

import { atlasNormalOf } from '../../art/spriteAtlas'

TextureSource.defaultOptions.scaleMode = 'nearest'

// NOTE: a color as pixi takes it, from the CSS the shapes carry.
export const colorOf = (
  css: string,
): Readonly<{ color: number; alpha: number }> => {
  const color = new Color(css)
  return { color: color.toNumber(), alpha: color.alpha }
}

// NOTE: every color channel set to one, the alpha kept.
const WHITE_MATRIX: ColorMatrix = [
  0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0,
]

// NOTE: mutable on purpose: the renderer draws into pixi's own mutable
// objects, and this cache is private to one renderer.
export class Textures {
  private readonly app: Application
  private readonly sources = new Map<string, Texture | 'Loading'>()
  private readonly crops = new Map<string, Texture>()
  private readonly silhouettes = new Map<Texture, Texture>()
  private readonly casterMaterials = new Map<Texture, Material3D>()
  private readonly normals = new Map<TextureSource, Texture>()
  // NOTE: the address each loaded source came from, to find its normal map.
  private readonly addresses = new Map<TextureSource, string>()
  // NOTE: the atlas's normal maps, loaded at a lit sprite's first draw, after
  // the splash; apart from `sources`, so they never hold the splash, take its
  // bandwidth, or repaint the floor.
  private readonly normalSheets = new Map<string, Texture | 'Loading'>()
  // NOTE: how many sources have loaded, so the floor repaints as they do.
  loaded = 0
  // NOTE: how many are still on their way; one that fails counts as done,
  // so a bad image never holds the splash.
  private pending = 0

  // NOTE: called as each source loads, so the world draws again with it even
  // when no new frame comes (a paused game, a held scene).
  private readonly onLoaded: () => void

  constructor(app: Application, onLoaded: () => void) {
    this.app = app
    this.onLoaded = onLoaded
  }

  // NOTE: whether every source asked for so far has loaded (or failed).
  get isSettled(): boolean {
    return this.pending === 0
  }

  // NOTE: starts loading a source, so it is ready by the time it shows.
  preload(src: string): void {
    this.sourceOf(src)
  }

  private sourceOf(src: string): Texture | undefined {
    const known = this.sources.get(src)
    if (known === 'Loading') {
      return undefined
    }
    if (known !== undefined) {
      return known
    }
    this.sources.set(src, 'Loading')
    this.pending += 1
    const image = new Image()
    image.addEventListener('load', () => {
      const texture = Texture.from(image)
      this.sources.set(src, texture)
      this.addresses.set(texture.source, src)
      this.pending -= 1
      this.loaded += 1
      this.onLoaded()
    })
    image.addEventListener('error', () => {
      this.pending -= 1
      this.onLoaded()
    })
    image.src = src
    return undefined
  }

  // NOTE: a prebuilt normal map, or nothing while it loads (or if it fails).
  private normalSheetOf(src: string): Texture | undefined {
    const known = this.normalSheets.get(src)
    if (known !== undefined) {
      return known === 'Loading' ? undefined : known
    }
    this.normalSheets.set(src, 'Loading')
    const image = new Image()
    image.addEventListener('load', () => {
      this.normalSheets.set(src, Texture.from(image))
      this.onLoaded()
    })
    image.src = src
    return undefined
  }

  // NOTE: a cropped frame of an image, mirrored when the shape is drawn
  // flipped, or nothing while its source loads.
  imageOf(image: Canvas.Image, isFlipped: boolean): Texture | undefined {
    const base = this.sourceOf(image.src)
    if (base === undefined) {
      return undefined
    }
    const crop = image.crop ?? {
      x: 0,
      y: 0,
      width: base.source.width,
      height: base.source.height,
    }
    const key = `${image.src}|${crop.x},${crop.y},${crop.width},${crop.height}|${isFlipped}`
    const cached = this.crops.get(key)
    if (cached !== undefined) {
      return cached
    }
    const texture = new Texture({
      source: base.source,
      frame: new Rectangle(crop.x, crop.y, crop.width, crop.height),
      rotate: isFlipped ? groupD8.MIRROR_HORIZONTAL : 0,
    })
    this.crops.set(key, texture)
    return texture
  }

  // NOTE: a texture's shape in plain white, baked once, so a tint gives a
  // solid rim of the lamp's color.
  silhouetteOf(texture: Texture): Texture {
    if (texture === Texture.WHITE) {
      return texture
    }
    const known = this.silhouettes.get(texture)
    if (known !== undefined) {
      return known
    }
    const sprite = new Sprite(texture)
    const white = new ColorMatrixFilter()
    white.matrix = WHITE_MATRIX
    white.padding = 0
    sprite.filters = [white]
    const baked = this.app.renderer.generateTexture({
      target: sprite,
      resolution: 1,
      frame: new Rectangle(0, 0, texture.frame.width, texture.frame.height),
    })
    baked.source.scaleMode = 'nearest'
    sprite.destroy()
    this.silhouettes.set(texture, baked)
    return baked
  }

  // NOTE: the normal map of the sheet a texture is cropped from, baked with
  // the atlas. A lit billboard's material crops it with the texture's own
  // frame, so the whole sheet is the right texture for every crop of it.
  // Anything else (a sprite encoded on its own, what the renderer drew, a
  // sheet's map still loading) faces straight out.
  normalOf(texture: Texture): Texture {
    const known = this.normals.get(texture.source)
    if (known !== undefined) {
      return known
    }
    const address = this.addresses.get(texture.source)
    const normal =
      address === undefined
        ? undefined
        : Option.match(atlasNormalOf(address), {
            onNone: () => this.flatNormal(),
            onSome: src => this.normalSheetOf(src),
          })
    if (normal === undefined) {
      return this.flatNormal()
    }
    this.normals.set(texture.source, normal)
    return normal
  }

  // NOTE: a normal map that faces straight out everywhere. A lit sprite is
  // built wearing it: pixi picks a mesh's shader once, with normal mapping
  // only when it already has a normal map, so one set later would be ignored.
  flatNormal(): Texture {
    const known = this.normals.get(Texture.WHITE.source)
    if (known !== undefined) {
      return known
    }
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const context = canvas.getContext('2d')
    if (context !== null) {
      context.fillStyle = 'rgb(128, 128, 255)'
      context.fillRect(0, 0, 1, 1)
    }
    const texture = Texture.from(canvas)
    this.normals.set(Texture.WHITE.source, texture)
    return texture
  }

  // NOTE: the material a hidden shadow stand-in wears: its silhouette cut
  // out, seen from both sides (the lights shine from the north, onto its
  // back).
  casterMaterialOf(texture: Texture): Material3D {
    const known = this.casterMaterials.get(texture)
    if (known !== undefined) {
      return known
    }
    const material = new Material3D({
      baseColorTexture: texture,
      alphaMode: 'mask',
      alphaCutoff: 0.5,
      doubleSided: true,
    })
    this.casterMaterials.set(texture, material)
    return material
  }

  destroy(): void {
    for (const texture of this.silhouettes.values()) {
      texture.destroy(true)
    }
    for (const texture of this.crops.values()) {
      texture.destroy(false)
    }
    for (const source of this.sources.values()) {
      if (source !== 'Loading') {
        source.destroy(true)
      }
    }
    for (const texture of new Set([
      ...this.normals.values(),
      ...this.normalSheets.values(),
    ])) {
      if (texture !== 'Loading') {
        texture.destroy(true)
      }
    }
    this.normals.clear()
    this.normalSheets.clear()
    this.addresses.clear()
    this.silhouettes.clear()
    this.crops.clear()
    this.sources.clear()
    this.casterMaterials.clear()
  }
}
