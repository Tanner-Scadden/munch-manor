// The renderer's textures: each sprite source loaded once, each crop of it
// (mirrored when drawn flipped), and each crop's plain white silhouette for
// the lamp's rim. One cache per renderer, emptied when it goes.

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

import { atlasNormalOf } from '../../art/spriteAtlas'
import type { Level } from '../../world/level/arena'
import type * as Draw from '../draw'
import {
  type LookKind,
  type LookOptions,
  LookTextures,
  dataTexture,
} from './look'

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
// NOTE: a crop's pixels, one byte each, row by row: solid, and dark enough
// to be an outline's ink.
export type PixelMasks = Readonly<{ solid: Uint8Array; dark: Uint8Array }>

// NOTE: a pixel this dark or darker, in luma out of 255, is ink: the
// outlines' near blacks (#140c10, #2a1418) and not a body's own shades.
const INK_LUMA = 56

// NOTE: wider than any sheet, so each crop's corner is its own number.
const CORNER_SPAN = 65536

export class Textures {
  private readonly app: Application
  private readonly sources = new Map<string, Texture | 'Loading'>()
  // NOTE: each crop's texture by its sheet, then by its corner and flip as
  // one number, asked for every part of every body each frame, so a lookup
  // builds no key. A second crop of the same corner and another size (never
  // in the atlas) is kept by a whole key apart.
  private readonly crops = new Map<string, Map<number, Texture>>()
  private readonly oddCrops = new Map<string, Texture>()
  private readonly silhouettes = new Map<Texture, Texture>()
  private readonly normals = new Map<TextureSource, Texture>()
  // NOTE: the address each loaded source came from, to find its normal map.
  private readonly addresses = new Map<TextureSource, string>()
  // NOTE: each loaded source's whole texture, so a crop's pixels can be read
  // and its voxels colored from the whole sheet.
  private readonly sheets = new Map<TextureSource, Texture>()
  // NOTE: each crop's solid pixels (1) and clear ones (0), read once.
  private readonly masks = new Map<Texture, PixelMasks>()
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

  // NOTE: the look pass's shared textures (src/render/iso/look.ts).
  private readonly look = new LookTextures()

  constructor(app: Application, onLoaded: () => void) {
    this.app = app
    this.onLoaded = onLoaded
  }

  // NOTE: what a lit material is built with for the look pass: its bit and
  // textures.
  lookOptions(kind: LookKind): LookOptions {
    return this.look.optionsFor(kind)
  }

  // NOTE: the look's room map, for the level now drawn and whether the
  // cellar is dark.
  lookAt(level: Level, isDark: boolean): void {
    this.look.paintRooms(level, isDark)
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
    // NOTE: only past a miss, for a second size at one corner, never in the
    // atlas.
    // oxlint-disable-next-line munch/no-string-key-per-frame
    const key = `${image.src}|${crop.x},${crop.y},${crop.width},${crop.height}|${isFlipped}`
    const odd = cached === undefined ? undefined : this.oddCrops.get(key)
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
      this.oddCrops.set(key, texture)
    }
    return texture
  }

  // NOTE: the whole sheet a crop is cut from, or nothing for a texture the
  // renderer drew itself.
  sheetOf(texture: Texture): Texture | undefined {
    return this.sheets.get(texture.source)
  }

  // NOTE: which of a crop's pixels are solid (an alpha of at least half)
  // and which of those are dark enough to be an outline's ink, row by row,
  // read back once off the sheet's own texture on the GPU, or nothing for a
  // texture the renderer drew itself.
  masksOf(texture: Texture): PixelMasks | undefined {
    const known = this.masks.get(texture)
    if (known !== undefined) {
      return known
    }
    const { width, height } = texture.frame
    if (!this.sheets.has(texture.source) || width < 1 || height < 1) {
      return undefined
    }
    // NOTE: the crop's frame as stored, its rows top first; a mirrored
    // crop's pixels are read unmirrored, as its image holds them.
    const { pixels } = this.app.renderer.extract.pixels(texture)
    const solid = new Uint8Array(width * height)
    const dark = new Uint8Array(width * height)
    for (let index = 0; index < solid.length; index += 1) {
      const at = index * 4
      const alpha = pixels[at + 3] ?? 0
      solid[index] = alpha >= 128 ? 1 : 0
      // NOTE: the sheet is uploaded with its alpha premultiplied, so a
      // color reads back darker by its alpha: divided out again here.
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
    for (const texture of this.oddCrops.values()) {
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
    this.sheets.clear()
    this.masks.clear()
    this.silhouettes.clear()
    this.crops.clear()
    this.oddCrops.clear()
    this.sources.clear()
  }
}
