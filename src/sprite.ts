import { Array, Match, Option, Record, String, pipe } from 'effect'
import { Canvas } from 'foldkit'

import { ZERO_VECTOR } from './geometry'
import { type Fill, parseColor, pngDataUrl } from './png'
import {
  type AtlasHit,
  atlasLookup,
  spriteKeyOf,
  spriteMode,
  standInKeyOf,
  standInSource,
} from './spriteAtlas'

export type Palette = Readonly<Record<string, string>>

type PixelRun = Readonly<{
  x: number
  y: number
  width: number
  height: number
  color: string
}>

export const TRANSPARENT = '.'

// NOTE: one pass along the row that grows the last run in place, since this
// runs for every row of every sprite as the game loads. Copying the run list
// for each pixel made a long row cost the square of its length.
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
    const symbol = row.charAt(x)
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

// NOTE: an image needs no vertical merging, which costs more than the image,
// so sprite images are painted from each row's runs.
const rowRunsOf = (
  pixels: ReadonlyArray<string>,
  palette: Palette,
): ReadonlyArray<PixelRun> =>
  Array.flatMap(pixels, (row, y) => rowRuns(row, y, palette))

export const pixelRuns = (
  pixels: ReadonlyArray<string>,
  palette: Palette,
): ReadonlyArray<PixelRun> =>
  pipe(
    pixels,
    Array.flatMap((row, y) => rowRuns(row, y, palette)),
    Array.reduce<ReadonlyArray<PixelRun>, PixelRun>([], mergeVertically),
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

export const spriteRects = (
  pixels: ReadonlyArray<string>,
  palette: Palette,
  anchor: Anchor = centerAnchor(pixels),
): ReadonlyArray<Canvas.Rect> =>
  Array.map(pixelRuns(pixels, palette), run =>
    Canvas.Rect({
      x: run.x - anchor.x,
      y: run.y - anchor.y,
      width: run.width,
      height: run.height,
      fill: run.color,
    }),
  )

// SPRITE IMAGES

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

// NOTE: the size and every run in paint order, which is everything the PNG is
// built from, so two equal keys always make the same image.
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

// NOTE: a sprite image is a PNG data URL built here from its pixel runs, not
// an SVG. The browser makes a whole SVG document for every SVG image and
// redraws its shapes each time a canvas draws it, which cost seconds at load
// and nothing saved per frame over the Rect shapes. A PNG decodes once into a
// bitmap that drawImage copies. About a third of the sprites the game builds
// come out the same as one built before (a flash frame of an all white
// sprite, a wear stage with no wear yet, a glyph in two tones that match), so
// each distinct image is encoded once and its data URL reused.
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

export const spriteDataUrl = (
  pixels: ReadonlyArray<string>,
  palette: Palette,
): Option.Option<string> =>
  runsDataUrl(spriteWidth(pixels), pixels.length, rowRunsOf(pixels, palette))

const builtSpriteSources = new Set<string>()

// NOTE: a sprite image draws nothing until the browser has decoded it, so
// every sprite image is recorded here as it is built. The sprites the game
// builds as it loads are all recorded before the first frame, and the warm-up
// canvas in layers.ts draws them once so none blinks when it first appears.
export const recordedSpriteSources = (): ReadonlyArray<string> =>
  Array.fromIterable(builtSpriteSources)

const imageAt = (
  src: string,
  x: number,
  y: number,
  width: number,
  height: number,
): Canvas.Image => {
  builtSpriteSources.add(src)
  return Canvas.Image({ src, x, y, width, height, rendering: 'Pixelated' })
}

// NOTE: how to build a prebuilt sprite's image on its own, by where it sits
// in the atlas, for HTML that shows a sprite as an <img>, which cannot crop.
const recipesByPlace = new Map<string, () => Option.Option<string>>()

const placeOf = (src: string, x: number, y: number): string =>
  `${src}#${x},${y}`

// NOTE: a sprite's image as a source of its own: a prebuilt sprite's built
// on first use, anything else's own source.
export const standaloneSource = (image: Canvas.Image): string => {
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

// NOTE: a prebuilt sprite is a cropped region of one of the atlas's files.
const atlasImageAt = (
  hit: AtlasHit,
  x: number,
  y: number,
  recipe: () => Option.Option<string>,
): Canvas.Image => {
  builtSpriteSources.add(hit.src)
  recipesByPlace.set(placeOf(hit.src, hit.x, hit.y), recipe)
  return Canvas.Image({
    src: hit.src,
    x,
    y,
    width: hit.width,
    height: hit.height,
    crop: { x: hit.x, y: hit.y, width: hit.width, height: hit.height },
    rendering: 'Pixelated',
  })
}

// CONTENT

export type SpriteContent = Readonly<{
  width: number
  height: number
  fills: ReadonlyArray<Fill>
}>

const contentsByKey = new Map<string, SpriteContent>()

// NOTE: every sprite built in stand-in mode, by key, with its pixels as the
// fills to paint. The atlas generator packs these, and tests read them.
export const spriteContents = (): ReadonlyMap<string, SpriteContent> =>
  contentsByKey

export const spriteContentOf = (src: string): Option.Option<SpriteContent> =>
  Option.flatMap(standInKeyOf(src), key =>
    Option.fromNullishOr(contentsByKey.get(key)),
  )

// NOTE: the image for a sprite the atlas does not hold: a stand-in named by
// its key in stand-in mode, else a PNG data URL encoded here. None when a
// palette color cannot be read, so the caller keeps rectangles.
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

// NOTE: a pixel map's key: its size, its rows, and its palette in symbol
// order, so the same map and colors always find the same prebuilt image.
const pixelsKeyOf = (
  width: number,
  pixels: ReadonlyArray<string>,
  palette: Palette,
): string => {
  let text = `p${width}x${pixels.length}`
  for (const row of pixels) {
    text += `\n${row}`
  }
  for (const symbol of Object.keys(palette).sort()) {
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
): ReadonlyArray<Canvas.Shape> => {
  const runs = rowRunsOf(pixels, palette)
  if (Array.isReadonlyArrayEmpty(runs)) {
    return []
  }

  return Option.match(builtSource(key, width, pixels.length, runs), {
    onNone: () => spriteRects(pixels, palette, anchor),
    onSome: src => [imageAt(src, -anchor.x, -anchor.y, width, pixels.length)],
  })
}

// NOTE: a sprite is one image of its pixel map, drawn with a single
// drawImage, instead of a rectangle for each run of same colored pixels. A
// prebuilt one is found by its key with no pixel work at all. A palette color
// that is not a hex or rgb() color keeps the rectangles.
export const spriteShapes = (
  pixels: ReadonlyArray<string>,
  palette: Palette,
  anchor: Anchor = centerAnchor(pixels),
): ReadonlyArray<Canvas.Shape> => {
  const width = spriteWidth(pixels)
  const key = pixelsKeyOf(width, pixels, palette)
  return Option.match(atlasLookup(key), {
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
  })
}

type Box = Readonly<{
  left: number
  top: number
  right: number
  bottom: number
}>

const isWhole = (value: number | undefined): boolean =>
  value === undefined || Number.isInteger(value)

const isPlainTranslate = (group: Canvas.Group): boolean =>
  group.rotate === undefined &&
  group.scale === undefined &&
  group.opacity === undefined &&
  isWhole(group.translate?.x) &&
  isWhole(group.translate?.y)

const isWholeRect = (rect: Canvas.Rect): boolean =>
  rect.stroke === undefined &&
  Array.every([rect.x, rect.y, rect.width, rect.height], isWhole)

const shapeRuns = (
  shape: Canvas.Shape,
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
    Text: () => Option.none(),
    Image: () => Option.none(),
  })

const flattenRects = (
  shapes: ReadonlyArray<Canvas.Shape>,
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

// NOTE: bakes a fixed list of whole pixel rectangles, such as a stall part
// drawn with Rect shapes, into one sprite image that paints the same pixels
// in the same order. Anything else, such as a circle or a scaled group, keeps
// its shapes as they are.
export const bakeShapes = (
  shapes: ReadonlyArray<Canvas.Shape>,
): ReadonlyArray<Canvas.Shape> => {
  const runs = Option.getOrElse(flattenRects(shapes, 0, 0), () => [])
  if (!Array.isReadonlyArrayNonEmpty(runs)) {
    return shapes
  }

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
        onNone: () => shapes,
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

// NOTE: draws a sprite at a whole pixel offset. A one image sprite moves the
// image itself, which saves the painter a Group's save, restore, and
// translate for every sprite in the scene.
export const placeAt = (
  x: number,
  y: number,
  sprite: ReadonlyArray<Canvas.Shape>,
): Canvas.Shape => {
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
}

// NOTE: draws a sprite stretched by `scaleX` and `scaleY` about its anchor,
// for a squash and stretch pop. A one image sprite stretches the image
// itself, so the pop costs no Group.
export const placeScaled = (
  x: number,
  y: number,
  sprite: ReadonlyArray<Canvas.Shape>,
  scaleX: number,
  scaleY: number,
): Canvas.Shape => {
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
}

export const mirrorRows = (
  pixels: ReadonlyArray<string>,
): ReadonlyArray<string> =>
  Array.map(pixels, row =>
    pipe(String.split(row, ''), Array.reverse, Array.join('')),
  )

export const padRow = (row: string, left: number, right: number): string =>
  `${TRANSPARENT.repeat(left)}${row}${TRANSPARENT.repeat(right)}`

const FLASH_COLOR = '#ffffff'

export const flashPalette = (palette: Palette): Palette =>
  Record.map(palette, () => FLASH_COLOR)

// SPRITES

export type Facing = 'Left' | 'Right'
export type Tone = 'Normal' | 'Flash'

export type Sprite = ReadonlyArray<Canvas.Shape>
export type SpriteSet = Readonly<Record<Tone, Readonly<Record<Facing, Sprite>>>>
export type SpriteFrames = Array.NonEmptyReadonlyArray<SpriteSet>

type GroupFields = Omit<Canvas.Group, '_tag'>

// NOTE: Canvas.Group re-parses every nested shape through Schema on each call,
// because its shapes field is recursive. The scene builds hundreds of Groups a
// frame around shapes the Canvas constructors already made, so this builds the
// same Group value without parsing the whole subtree again.
export const group = (fields: GroupFields): Canvas.Group => ({
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

export const facingSprites = (
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
})

export const spriteSet =
  (palette: Palette, anchorX: number) =>
  (pixels: ReadonlyArray<string>): SpriteSet => ({
    Normal: facingSprites(pixels, palette, anchorX),
    Flash: facingSprites(pixels, flashPalette(palette), anchorX),
  })

export const spriteFrames = (
  framePixels: Array.NonEmptyReadonlyArray<ReadonlyArray<string>>,
  palette: Palette,
  anchorX: number,
): SpriteFrames => Array.map(framePixels, spriteSet(palette, anchorX))

export const frameAt = (frames: SpriteFrames, frameIndex: number): SpriteSet =>
  Option.getOrElse(Array.get(frames, frameIndex % frames.length), () =>
    Array.headNonEmpty(frames),
  )
