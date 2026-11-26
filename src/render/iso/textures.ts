import { Option } from 'effect'
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

import { atlasNormalOf } from '#art/spriteAtlas.ts'
import type * as Draw from '#render/draw.ts'
import type { Level } from '#world/level/arena.ts'

import {
  type LookKind,
  type LookOptions,
  LookTextures,
  dataTexture,
} from './look.ts'

TextureSource.defaultOptions.scaleMode = 'nearest'

export const colorOf = (
  css: string,
): Readonly<{ color: number; alpha: number }> => {
  const color = new Color(css)
  return { color: color.toNumber(), alpha: color.alpha }
}

const WHITE_MATRIX: ColorMatrix = [
  0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0,
]

export type PixelMasks = Readonly<{ solid: Uint8Array; dark: Uint8Array }>

const INK_LUMA = 56

const CORNER_SPAN = 65536

export class Textures {
  private readonly app: Application
  private readonly sources = new Map<string, Texture | 'Loading'>()
  private readonly crops = new Map<string, Map<number, Texture>>()
  private readonly oddCrops = new Map<Texture, Map<number, Texture>>()
  private readonly silhouettes = new Map<Texture, Texture>()
  private readonly normals = new Map<TextureSource, Texture>()
  private readonly addresses = new Map<TextureSource, string>()
  private readonly sheets = new Map<TextureSource, Texture>()
  private readonly masks = new Map<Texture, PixelMasks>()
  private readonly normalSheets = new Map<string, Texture | 'Loading'>()
  loaded = 0
  private pending = 0

  private readonly onLoaded: () => void

  private readonly look = new LookTextures()

  constructor(app: Application, onLoaded: () => void) {
    this.app = app
    this.onLoaded = onLoaded
  }

  lookOptions(kind: LookKind): LookOptions {
    return this.look.optionsFor(kind)
  }

  lookAt(level: Level, isDark: boolean): void {
    this.look.paintRooms(level, isDark)
  }

  get isSettled(): boolean {
    return this.pending === 0
  }

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
      this.sheets.set(texture.source, texture)
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

  imageOf(image: Draw.Image, isFlipped: boolean): Texture | undefined {
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
    const known = this.crops.get(image.src)
    const corners = known ?? new Map<number, Texture>()
    if (known === undefined) {
      this.crops.set(image.src, corners)
    }
    const corner = (crop.x * CORNER_SPAN + crop.y) * 2 + (isFlipped ? 1 : 0)
    const cached = corners.get(corner)
    const isSameSize =
      cached !== undefined &&
      cached.frame.width === crop.width &&
      cached.frame.height === crop.height
    if (isSameSize) {
      return cached
    }
    const size = crop.width * CORNER_SPAN + crop.height
    const sizes = cached === undefined ? undefined : this.oddCrops.get(cached)
    const odd = sizes?.get(size)
    if (odd !== undefined) {
      return odd
    }
    const texture = new Texture({
      source: base.source,
      frame: new Rectangle(crop.x, crop.y, crop.width, crop.height),
      rotate: isFlipped ? groupD8.MIRROR_HORIZONTAL : 0,
    })
    if (cached === undefined) {
      corners.set(corner, texture)
    } else {
      const others = sizes ?? new Map<number, Texture>()
      others.set(size, texture)
      this.oddCrops.set(cached, others)
    }
    return texture
  }

  sheetOf(texture: Texture): Texture | undefined {
    return this.sheets.get(texture.source)
  }

  masksOf(texture: Texture): PixelMasks | undefined {
    const known = this.masks.get(texture)
    if (known !== undefined) {
      return known
    }
    const { width, height } = texture.frame
    if (!this.sheets.has(texture.source) || width < 1 || height < 1) {
      return undefined
    }
    const { pixels } = this.app.renderer.extract.pixels(texture)
    const solid = new Uint8Array(width * height)
    const dark = new Uint8Array(width * height)
    for (let index = 0; index < solid.length; index += 1) {
      const at = index * 4
      const alpha = pixels[at + 3] ?? 0
      solid[index] = alpha >= 128 ? 1 : 0
      const unmix = alpha === 0 ? 0 : 255 / alpha
      const luma =
        (0.299 * (pixels[at] ?? 0) +
          0.587 * (pixels[at + 1] ?? 0) +
          0.114 * (pixels[at + 2] ?? 0)) *
        unmix
      dark[index] = solid[index] === 1 && luma < INK_LUMA ? 1 : 0
    }
    const masks = { solid, dark }
    this.masks.set(texture, masks)
    return masks
  }

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

  flatNormal(): Texture {
    const known = this.normals.get(Texture.WHITE.source)
    if (known !== undefined) {
      return known
    }
    const texture = dataTexture({
      data: new Uint8Array([128, 128, 255, 255]),
      width: 1,
      height: 1,
    })
    this.normals.set(Texture.WHITE.source, texture)
    return texture
  }

  destroy(): void {
    this.look.destroy()
    for (const texture of this.silhouettes.values()) {
      texture.destroy(true)
    }
    for (const corners of this.crops.values()) {
      for (const texture of corners.values()) {
        texture.destroy(false)
      }
    }
    for (const sizes of this.oddCrops.values()) {
      for (const texture of sizes.values()) {
        texture.destroy(false)
      }
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
    this.sheets.clear()
    this.masks.clear()
    this.silhouettes.clear()
    this.crops.clear()
    this.oddCrops.clear()
    this.sources.clear()
  }
}
