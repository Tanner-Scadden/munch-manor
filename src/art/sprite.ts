import { Array, Function, Match, Option, Record, String, pipe } from 'effect'

import * as Draw from '#render/draw.ts'
import { ZERO_VECTOR } from '#world/step/geometry.ts'

import { type Fill, parseColor, pngDataUrl } from './png.ts'
import {
  type AtlasHit,
  atlasLookup,
  spriteKeyOf,
  spriteMode,
  standInKeyOf,
  standInSource,
} from './spriteAtlas.ts'

export type Palette = Readonly<Record<string, string>>

type PixelRun = Readonly<{
  x: number
  y: number
  width: number
  height: number
  color: string
}>

export const TRANSPARENT = '.'

const rowRuns = (
  row: string,
  y: number,
  palette: Palette,
): ReadonlyArray<PixelRun> => {
  const runs: Array<{
    x: number
    y: number
    width: number
    height: number
    color: string
  }> = []
  for (let x = 0; x < row.length; x++) {
    const symbol = Option.getOrElse(String.charAt(row, x), () => TRANSPARENT)
    const color = palette[symbol]
    if (symbol === TRANSPARENT || color === undefined) {
      continue
    }
    const last = runs[runs.length - 1]
    if (last?.color === color && last.x + last.width === x) {
      last.width += 1
    } else {
      runs.push({ x, y, width: 1, height: 1, color })
    }
  }
  return runs
}

const isVerticalContinuation = (above: PixelRun, below: PixelRun): boolean =>
  above.x === below.x &&
  above.width === below.width &&
  above.color === below.color &&
  above.y + above.height === below.y

const mergeVertically = (
  merged: ReadonlyArray<PixelRun>,
  run: PixelRun,
): ReadonlyArray<PixelRun> =>
  Option.match(
    Array.findFirstIndex(merged, above => isVerticalContinuation(above, run)),
    {
      onNone: () => Array.append(merged, run),
      onSome: index =>
        pipe(
          Array.modify(merged, index, above => ({
            x: above.x,
            y: above.y,
            width: above.width,
            height: above.height + 1,
            color: above.color,
          })),
          Option.getOrElse(() => merged),
        ),
    },
  )

const rowRunsOf = (
  pixels: ReadonlyArray<string>,
  palette: Palette,
): ReadonlyArray<PixelRun> =>
  Array.flatMap(pixels, (row, y) => rowRuns(row, y, palette))

export const pixelRuns: {
  (palette: Palette): (pixels: ReadonlyArray<string>) => ReadonlyArray<PixelRun>
  (pixels: ReadonlyArray<string>, palette: Palette): ReadonlyArray<PixelRun>
} = Function.dual(
  2,
  (pixels: ReadonlyArray<string>, palette: Palette): ReadonlyArray<PixelRun> =>
    pipe(
      pixels,
      Array.flatMap((row, y) => rowRuns(row, y, palette)),
      Array.reduce<ReadonlyArray<PixelRun>, PixelRun>([], mergeVertically),
    ),
)

export const spriteWidth = (pixels: ReadonlyArray<string>): number =>
  pipe(
    pixels,
    Array.map(row => row.length),
    Array.reduce(0, (widest, length) => Math.max(widest, length)),
  )

export type Anchor = Readonly<{ x: number; y: number }>

export const TOP_LEFT: Anchor = ZERO_VECTOR

const centerAnchor = (pixels: ReadonlyArray<string>): Anchor => ({
  x: Math.floor(spriteWidth(pixels) / 2),
  y: Math.floor(pixels.length / 2),
})

export const spriteRects: {
  (
    palette: Palette,
    anchor?: Anchor,
  ): (pixels: ReadonlyArray<string>) => ReadonlyArray<Draw.Rect>
  (
    pixels: ReadonlyArray<string>,
    palette: Palette,
    anchor?: Anchor,
  ): ReadonlyArray<Draw.Rect>
} = Function.dual(
  (args: IArguments): boolean => Array.isArray(args[0]),
  (
    pixels: ReadonlyArray<string>,
    palette: Palette,
    anchor: Anchor = centerAnchor(pixels),
  ): ReadonlyArray<Draw.Rect> =>
    Array.map(pixelRuns(pixels, palette), run =>
      Draw.Rect({
        x: run.x - anchor.x,
        y: run.y - anchor.y,
        width: run.width,
        height: run.height,
        fill: run.color,
      }),
    ),
)

const fillsOf = (
  runs: ReadonlyArray<PixelRun>,
): Option.Option<ReadonlyArray<Fill>> =>
  Option.all(
    Array.map(runs, run =>
      Option.map(parseColor(run.color), color => ({
        x: run.x,
        y: run.y,
        width: run.width,
        height: run.height,
        color,
      })),
    ),
  )

const contentKeyOf = (
  width: number,
  height: number,
  runs: ReadonlyArray<PixelRun>,
): string => {
  let key = `${width}x${height}`
  for (const run of runs) {
    key += `;${run.x},${run.y},${run.width},${run.height},${run.color}`
  }
  return key
}

const sourcesByContent = new Map<string, Option.Option<string>>()

const runsDataUrl = (
  width: number,
  height: number,
  runs: ReadonlyArray<PixelRun>,
): Option.Option<string> => {
  const key = contentKeyOf(width, height, runs)
  const cached = sourcesByContent.get(key)
  if (cached !== undefined) {
    return cached
  }
  const built = Option.map(fillsOf(runs), fills =>
    pngDataUrl(width, height, fills),
  )
  sourcesByContent.set(key, built)
  return built
}

export const spriteDataUrl: {
  (palette: Palette): (pixels: ReadonlyArray<string>) => Option.Option<string>
  (pixels: ReadonlyArray<string>, palette: Palette): Option.Option<string>
} = Function.dual(
  2,
  (pixels: ReadonlyArray<string>, palette: Palette): Option.Option<string> =>
    runsDataUrl(spriteWidth(pixels), pixels.length, rowRunsOf(pixels, palette)),
)

const builtSpriteSources = new Set<string>()

export const recordedSpriteSources = (): ReadonlyArray<string> =>
  Array.fromIterable(builtSpriteSources)

const imageAt = (
  src: string,
  x: number,
  y: number,
  width: number,
  height: number,
): Draw.Image => {
  builtSpriteSources.add(src)
  return Draw.Image({ src, x, y, width, height, rendering: 'Pixelated' })
}

const recipesByPlace = new Map<string, () => Option.Option<string>>()

const placeOf = (src: string, x: number, y: number): string =>
  `${src}#${x},${y}`

export const standaloneSource = (image: Draw.Image): string => {
  if (image.crop === undefined) {
    return image.src
  }
  const recipe = recipesByPlace.get(
    placeOf(image.src, image.crop.x, image.crop.y),
  )
  return recipe === undefined
    ? image.src
    : Option.getOrElse(recipe(), () => image.src)
}

export type ArtImage = Readonly<{ src: string; width: number; height: number }>

export const spriteImage = (
  sprite: ReadonlyArray<Draw.Shape>,
): Option.Option<ArtImage> =>
  pipe(
    Array.head(sprite),
    Option.flatMap((shape: Draw.Shape) =>
      shape._tag === 'Image'
        ? Option.some({
            src: standaloneSource(shape),
            width: shape.width,
            height: shape.height,
          })
        : Option.none(),
    ),
  )

const atlasImageAt = (
  hit: AtlasHit,
  x: number,
  y: number,
  recipe: () => Option.Option<string>,
): Draw.Image => {
  builtSpriteSources.add(hit.src)
  recipesByPlace.set(placeOf(hit.src, hit.x, hit.y), recipe)
  return Draw.Image({
    src: hit.src,
    x,
    y,
    width: hit.width,
    height: hit.height,
    crop: { x: hit.x, y: hit.y, width: hit.width, height: hit.height },
    rendering: 'Pixelated',
  })
}

export type SpriteContent = Readonly<{
  width: number
  height: number
  fills: ReadonlyArray<Fill>
}>

const contentsByKey = new Map<string, SpriteContent>()

export const spriteContents = (): ReadonlyMap<string, SpriteContent> =>
  contentsByKey

export const spriteContentOf = (src: string): Option.Option<SpriteContent> =>
  Option.flatMap(standInKeyOf(src), key =>
    Option.fromNullishOr(contentsByKey.get(key)),
  )

const builtSource = (
  key: string,
  width: number,
  height: number,
  runs: ReadonlyArray<PixelRun>,
): Option.Option<string> => {
  if (spriteMode() === 'Encode') {
    return runsDataUrl(width, height, runs)
  }
  return Option.map(fillsOf(runs), fills => {
    contentsByKey.set(key, { width, height, fills })
    return standInSource(key)
  })
}

const pixelsKeyOf = (
  width: number,
  pixels: ReadonlyArray<string>,
  palette: Palette,
): string => {
  let text = `p${width}x${pixels.length}`
  for (const row of pixels) {
    text += `\n${row}`
  }
  for (const symbol of Record.keys(palette).sort()) {
    text += `\n${symbol}=${palette[symbol] ?? ''}`
  }
  return spriteKeyOf(text)
}

const builtSpriteShapes = (
  key: string,
  pixels: ReadonlyArray<string>,
  palette: Palette,
  anchor: Anchor,
  width: number,
): ReadonlyArray<Draw.Shape> => {
  const runs = rowRunsOf(pixels, palette)
  if (Array.isReadonlyArrayEmpty(runs)) {
    return []
  }

  return Option.match(builtSource(key, width, pixels.length, runs), {
    onNone: () => spriteRects(pixels, palette, anchor),
    onSome: src => [imageAt(src, -anchor.x, -anchor.y, width, pixels.length)],
  })
}

const FLASH_COLOR = '#ffffff'

const FLASH_PALETTES = new WeakSet<Palette>()
const FLASH_SHAPES = new WeakSet<Draw.Shape>()

export const flashPalette = (palette: Palette): Palette => {
  const flash = Record.map(palette, () => FLASH_COLOR)
  FLASH_PALETTES.add(flash)
  return flash
}

export const isFlashShape = (shape: Draw.Shape): boolean =>
  FLASH_SHAPES.has(shape)

const EYE_LETTERS = new WeakMap<Palette, string>()
const EYE_PIXELS = new WeakMap<Draw.Shape, EyePixels>()
const GLOW_SHAPES = new WeakSet<Draw.Shape>()

export type EyePixels = Readonly<{
  width: number
  height: number
  isEye: Uint8Array
}>

export const glowingEyes: {
  (letters: string): <P extends Palette>(palette: P) => P
  <P extends Palette>(palette: P, letters: string): P
} = Function.dual(2, <P extends Palette>(palette: P, letters: string): P => {
  EYE_LETTERS.set(palette, letters)
  return palette
})

export const eyePixelsOf = (shape: Draw.Shape): EyePixels | undefined =>
  EYE_PIXELS.get(shape)

const eyePixelsIn = (
  pixels: ReadonlyArray<string>,
  letters: string,
): EyePixels | undefined => {
  const width = spriteWidth(pixels)
  const height = pixels.length
  const isEye = new Uint8Array(width * height)
  let count = 0
  for (let row = 0; row < height; row += 1) {
    const line = pixels[row] ?? ''
    for (let column = 0; column < line.length; column += 1) {
      if (String.includes(line[column] ?? '.')(letters)) {
        isEye[row * width + column] = 1
        count += 1
      }
    }
  }
  return count === 0 ? undefined : { width, height, isEye }
}

export const glowing = <S extends Draw.Shape>(shape: S): S => {
  GLOW_SHAPES.add(shape)
  return shape
}

export const isGlowShape = (shape: Draw.Shape): boolean =>
  GLOW_SHAPES.has(shape)

const noteFlash = (
  palette: Palette,
  pixels: ReadonlyArray<string>,
  shapes: ReadonlyArray<Draw.Shape>,
): ReadonlyArray<Draw.Shape> => {
  if (FLASH_PALETTES.has(palette)) {
    Array.forEach(shapes, shape => {
      FLASH_SHAPES.add(shape)
    })
  }
  const letters = EYE_LETTERS.get(palette)
  const eyes = letters === undefined ? undefined : eyePixelsIn(pixels, letters)
  if (eyes !== undefined) {
    Array.forEach(shapes, shape => {
      EYE_PIXELS.set(shape, eyes)
    })
  }
  return shapes
}

export type CropTable<V> = Readonly<{
  get: (image: Draw.Image) => V | undefined
  setSprite: (sprite: ReadonlyArray<Draw.Shape>, value: V) => void
}>

const CORNER_SPAN = 65536

const cornerOf = (image: Draw.Image): number =>
  (image.crop?.x ?? 0) * CORNER_SPAN + (image.crop?.y ?? 0)

export const makeCropTable = <V>(): CropTable<V> => {
  const bySheet = new Map<string, Map<number, V>>()
  const set = (image: Draw.Image, value: V): void => {
    const known = bySheet.get(image.src)
    const corners = known ?? new Map<number, V>()
    if (known === undefined) {
      bySheet.set(image.src, corners)
    }
    corners.set(cornerOf(image), value)
  }
  return {
    get: image => bySheet.get(image.src)?.get(cornerOf(image)),
    setSprite: (sprite, value) => {
      Array.forEach(sprite, shape => {
        if (shape._tag === 'Image') {
          set(shape, value)
        }
      })
    },
  }
}

export const cropSetOf = (
  sprites: ReadonlyArray<ReadonlyArray<Draw.Shape>>,
): ((image: Draw.Image) => boolean) => {
  const table = makeCropTable<true>()
  Array.forEach(sprites, sprite => {
    table.setSprite(sprite, true)
  })
  return image => table.get(image) === true
}

const GLOWING_IMAGES = makeCropTable<true>()

export const glowingSprite = (sprite: Sprite): Sprite => {
  GLOWING_IMAGES.setSprite(sprite, true)
  return sprite
}

export const isGlowingShape = (shape: Draw.Shape): boolean =>
  shape._tag === 'Image' && GLOWING_IMAGES.get(shape) === true

export type SpriteDepth = Readonly<{
  most?: number
  isBox?: boolean
  rows?: ReadonlyArray<string>
  isUpright?: boolean
}>

const SPRITE_DEPTHS = makeCropTable<SpriteDepth>()

export const deepSprite: {
  (depth: SpriteDepth): (sprite: Sprite) => Sprite
  (sprite: Sprite, depth: SpriteDepth): Sprite
} = Function.dual(2, (sprite: Sprite, depth: SpriteDepth): Sprite => {
  SPRITE_DEPTHS.setSprite(sprite, depth)
  return sprite
})

export const spriteDepthOf = (shape: Draw.Image): SpriteDepth | undefined =>
  SPRITE_DEPTHS.get(shape)

export const spriteShapes: {
  (
    palette: Palette,
    anchor?: Anchor,
  ): (pixels: ReadonlyArray<string>) => ReadonlyArray<Draw.Shape>
  (
    pixels: ReadonlyArray<string>,
    palette: Palette,
    anchor?: Anchor,
  ): ReadonlyArray<Draw.Shape>
} = Function.dual(
  (args: IArguments): boolean => Array.isArray(args[0]),
  (
    pixels: ReadonlyArray<string>,
    palette: Palette,
    anchor: Anchor = centerAnchor(pixels),
  ): ReadonlyArray<Draw.Shape> => {
    const width = spriteWidth(pixels)
    const key = pixelsKeyOf(width, pixels, palette)
    return noteFlash(
      palette,
      pixels,
      Option.match(atlasLookup(key), {
        onNone: () => builtSpriteShapes(key, pixels, palette, anchor, width),
        onSome: maybeHit =>
          Option.match(maybeHit, {
            onNone: () => [],
            onSome: hit => [
              atlasImageAt(hit, -anchor.x, -anchor.y, () =>
                runsDataUrl(width, pixels.length, rowRunsOf(pixels, palette)),
              ),
            ],
          }),
      }),
    )
  },
)

export type Box = Readonly<{
  left: number
  top: number
  right: number
  bottom: number
}>

const EMPTY_BOUNDS: Box = {
  left: Infinity,
  top: Infinity,
  right: -Infinity,
  bottom: -Infinity,
}

const joinBounds = (a: Box, b: Box): Box => ({
  left: Math.min(a.left, b.left),
  top: Math.min(a.top, b.top),
  right: Math.max(a.right, b.right),
  bottom: Math.max(a.bottom, b.bottom),
})

const boxBounds = (
  x: number,
  y: number,
  width: number,
  height: number,
): Box => ({
  left: x,
  top: y,
  right: x + width,
  bottom: y + height,
})

const shiftBounds = (bounds: Box, x: number, y: number): Box => ({
  left: bounds.left + x,
  top: bounds.top + y,
  right: bounds.right + x,
  bottom: bounds.bottom + y,
})

export const boundsOf = (shapes: ReadonlyArray<Draw.Shape>): Box =>
  Array.reduce(shapes, EMPTY_BOUNDS, (bounds: Box, shape): Box =>
    joinBounds(
      bounds,
      Match.valueTags(shape, {
        Rect: ({ x, y, width, height }) => boxBounds(x, y, width, height),
        Image: ({ x, y, width, height }) => boxBounds(x, y, width, height),
        Circle: ({ x, y, radius }) =>
          boxBounds(x - radius, y - radius, radius * 2, radius * 2),
        Group: group =>
          shiftBounds(
            boundsOf(group.shapes),
            group.translate?.x ?? 0,
            group.translate?.y ?? 0,
          ),
        Path: () => EMPTY_BOUNDS,
      }),
    ),
  )

const isWhole = (value: number | undefined): boolean =>
  value === undefined || Number.isInteger(value)

const isPlainTranslate = (group: Draw.Group): boolean =>
  group.rotate === undefined &&
  group.scale === undefined &&
  group.opacity === undefined &&
  isWhole(group.translate?.x) &&
  isWhole(group.translate?.y)

const isWholeRect = (rect: Draw.Rect): boolean =>
  rect.stroke === undefined &&
  Array.every([rect.x, rect.y, rect.width, rect.height], isWhole)

const shapeRuns = (
  shape: Draw.Shape,
  offsetX: number,
  offsetY: number,
): Option.Option<ReadonlyArray<PixelRun>> =>
  Match.valueTags(shape, {
    Rect: rect =>
      rect.fill !== undefined && isWholeRect(rect)
        ? Option.some([
            {
              x: rect.x + offsetX,
              y: rect.y + offsetY,
              width: rect.width,
              height: rect.height,
              color: rect.fill,
            },
          ])
        : Option.none(),
    Group: group =>
      isPlainTranslate(group)
        ? flattenRects(
            group.shapes,
            offsetX + (group.translate?.x ?? 0),
            offsetY + (group.translate?.y ?? 0),
          )
        : Option.none(),
    Circle: () => Option.none(),
    Path: () => Option.none(),
    Image: () => Option.none(),
  })

const flattenRects = (
  shapes: ReadonlyArray<Draw.Shape>,
  offsetX: number,
  offsetY: number,
): Option.Option<ReadonlyArray<PixelRun>> =>
  Option.map(
    Option.all(Array.map(shapes, shape => shapeRuns(shape, offsetX, offsetY))),
    Array.flatten,
  )

const boxOf = (runs: Array.NonEmptyReadonlyArray<PixelRun>): Box =>
  Array.reduce(
    runs,
    { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
    (box: Box, run): Box => ({
      left: Math.min(box.left, run.x),
      top: Math.min(box.top, run.y),
      right: Math.max(box.right, run.x + run.width),
      bottom: Math.max(box.bottom, run.y + run.height),
    }),
  )

const bakeRuns = (
  runs: Array.NonEmptyReadonlyArray<PixelRun>,
  fallback: () => ReadonlyArray<Draw.Shape>,
): ReadonlyArray<Draw.Shape> => {
  const box = boxOf(runs)
  const width = box.right - box.left
  const height = box.bottom - box.top
  const shifted = Array.map(runs, run => ({
    x: run.x - box.left,
    y: run.y - box.top,
    width: run.width,
    height: run.height,
    color: run.color,
  }))
  const key = spriteKeyOf(`r${contentKeyOf(width, height, shifted)}`)
  return Option.match(atlasLookup(key), {
    onNone: () =>
      Option.match(builtSource(key, width, height, shifted), {
        onNone: fallback,
        onSome: src => [imageAt(src, box.left, box.top, width, height)],
      }),
    onSome: maybeHit =>
      Option.match(maybeHit, {
        onNone: () => [],
        onSome: hit => [
          atlasImageAt(hit, box.left, box.top, () =>
            runsDataUrl(width, height, shifted),
          ),
        ],
      }),
  })
}

export const bakeShapes = (
  shapes: ReadonlyArray<Draw.Shape>,
): ReadonlyArray<Draw.Shape> => {
  const runs = Option.getOrElse(flattenRects(shapes, 0, 0), () => [])
  return Array.isReadonlyArrayNonEmpty(runs)
    ? bakeRuns(runs, () => shapes)
    : shapes
}

const clipRun = (run: PixelRun, box: Box): Option.Option<PixelRun> => {
  const left = Math.max(run.x, box.left)
  const top = Math.max(run.y, box.top)
  const right = Math.min(run.x + run.width, box.right)
  const bottom = Math.min(run.y + run.height, box.bottom)
  return right > left && bottom > top
    ? Option.some({
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
        color: run.color,
      })
    : Option.none()
}

export const bakeShapesWithin: {
  (box: Box): (shapes: ReadonlyArray<Draw.Shape>) => ReadonlyArray<Draw.Shape>
  (shapes: ReadonlyArray<Draw.Shape>, box: Box): ReadonlyArray<Draw.Shape>
} = Function.dual(
  2,
  (shapes: ReadonlyArray<Draw.Shape>, box: Box): ReadonlyArray<Draw.Shape> =>
    Option.match(flattenRects(shapes, 0, 0), {
      onNone: () => shapes,
      onSome: runs => {
        const inside = Array.getSomes(Array.map(runs, run => clipRun(run, box)))
        return Array.isReadonlyArrayNonEmpty(inside)
          ? bakeRuns(inside, () => shapes)
          : []
      },
    }),
)

export const placeAt: {
  (y: number, sprite: ReadonlyArray<Draw.Shape>): (x: number) => Draw.Shape
  (x: number, y: number, sprite: ReadonlyArray<Draw.Shape>): Draw.Shape
} = Function.dual(
  3,
  (x: number, y: number, sprite: ReadonlyArray<Draw.Shape>): Draw.Shape => {
    const only = sprite.length === 1 ? sprite[0] : undefined
    if (only?._tag === 'Image') {
      return {
        _tag: 'Image',
        src: only.src,
        x: only.x + x,
        y: only.y + y,
        width: only.width,
        height: only.height,
        crop: only.crop,
        rendering: only.rendering,
      }
    }

    return group({ translate: { x, y }, shapes: sprite })
  },
)

export const placeScaled: {
  (
    y: number,
    sprite: ReadonlyArray<Draw.Shape>,
    scaleX: number,
    scaleY: number,
  ): (x: number) => Draw.Shape
  (
    x: number,
    y: number,
    sprite: ReadonlyArray<Draw.Shape>,
    scaleX: number,
    scaleY: number,
  ): Draw.Shape
} = Function.dual(
  5,
  (
    x: number,
    y: number,
    sprite: ReadonlyArray<Draw.Shape>,
    scaleX: number,
    scaleY: number,
  ): Draw.Shape => {
    const only = sprite.length === 1 ? sprite[0] : undefined
    if (only?._tag === 'Image') {
      return {
        _tag: 'Image',
        src: only.src,
        x: Math.round(x + only.x * scaleX),
        y: Math.round(y + only.y * scaleY),
        width: Math.round(only.width * scaleX),
        height: Math.round(only.height * scaleY),
        crop: only.crop,
        rendering: only.rendering,
      }
    }

    return group({
      translate: { x, y },
      scale: { x: scaleX, y: scaleY },
      shapes: sprite,
    })
  },
)

export const mirrorRows = (
  pixels: ReadonlyArray<string>,
): ReadonlyArray<string> =>
  Array.map(pixels, row =>
    pipe(String.split(row, ''), Array.reverse, Array.join('')),
  )

export const padRow: {
  (left: number, right: number): (row: string) => string
  (row: string, left: number, right: number): string
} = Function.dual(
  3,
  (row: string, left: number, right: number): string =>
    `${String.repeat(left)(TRANSPARENT)}${row}${String.repeat(right)(TRANSPARENT)}`,
)

export type Facing = 'Left' | 'Right'
export type Tone = 'Normal' | 'Flash'

export type Sprite = ReadonlyArray<Draw.Shape>
export type SpriteSet = Readonly<Record<Tone, Readonly<Record<Facing, Sprite>>>>
export type SpriteFrames = Array.NonEmptyReadonlyArray<SpriteSet>

type GroupFields = Omit<Draw.Group, '_tag'>

export const group = (fields: GroupFields): Draw.Group => ({
  _tag: 'Group',
  shapes: fields.shapes,
  translate: fields.translate,
  rotate: fields.rotate,
  scale: fields.scale,
  opacity: fields.opacity,
})

const footAnchor = (pixels: ReadonlyArray<string>, x: number): Anchor => ({
  x,
  y: pixels.length,
})

export const facingSprites: {
  (
    palette: Palette,
    anchorX: number,
  ): (pixels: ReadonlyArray<string>) => Readonly<Record<Facing, Sprite>>
  (
    pixels: ReadonlyArray<string>,
    palette: Palette,
    anchorX: number,
  ): Readonly<Record<Facing, Sprite>>
} = Function.dual(
  3,
  (
    pixels: ReadonlyArray<string>,
    palette: Palette,
    anchorX: number,
  ): Readonly<Record<Facing, Sprite>> => ({
    Right: spriteShapes(pixels, palette, footAnchor(pixels, anchorX)),
    Left: spriteShapes(
      mirrorRows(pixels),
      palette,
      footAnchor(pixels, spriteWidth(pixels) - anchorX),
    ),
  }),
)

export const spriteSet: {
  (
    palette: Palette,
    anchorX: number,
  ): (pixels: ReadonlyArray<string>) => SpriteSet
  (pixels: ReadonlyArray<string>, palette: Palette, anchorX: number): SpriteSet
} = Function.dual(
  3,
  (
    pixels: ReadonlyArray<string>,
    palette: Palette,
    anchorX: number,
  ): SpriteSet => ({
    Normal: facingSprites(pixels, palette, anchorX),
    Flash: facingSprites(pixels, flashPalette(palette), anchorX),
  }),
)

export const spriteFrames: {
  (
    palette: Palette,
    anchorX: number,
  ): (
    framePixels: Array.NonEmptyReadonlyArray<ReadonlyArray<string>>,
  ) => SpriteFrames
  (
    framePixels: Array.NonEmptyReadonlyArray<ReadonlyArray<string>>,
    palette: Palette,
    anchorX: number,
  ): SpriteFrames
} = Function.dual(
  3,
  (
    framePixels: Array.NonEmptyReadonlyArray<ReadonlyArray<string>>,
    palette: Palette,
    anchorX: number,
  ): SpriteFrames => Array.map(framePixels, spriteSet(palette, anchorX)),
)

export const frameAt: {
  (frameIndex: number): (frames: SpriteFrames) => SpriteSet
  (frames: SpriteFrames, frameIndex: number): SpriteSet
} = Function.dual(2, (frames: SpriteFrames, frameIndex: number): SpriteSet =>
  Option.getOrElse(Array.get(frames, frameIndex % frames.length), () =>
    Array.headNonEmpty(frames),
  ),
)
