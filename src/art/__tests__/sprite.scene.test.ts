import { Array, Option, Record, String, pipe } from 'effect'
import { afterEach, describe, expect, test } from 'vitest'

import { defaultAppearance } from '../../app/model'
import * as Draw from '../../render/draw'
import { decodePng, hexOf } from '../../test/testPng'
import { imagesIn } from '../../test/viewReading'
import { playerSprites } from '../appearance'
import { GLYPH_SPRITES, KEY_SPRITE } from '../font'
import {
  type Palette,
  bakeShapes,
  placeAt,
  spriteDataUrl,
  spriteShapes,
} from '../sprite'
import { standInKeyOf, useSpriteAtlas, useSpriteMode } from '../spriteAtlas'
import { PICKUP_SPRITES } from '../sprites/pickups'
import { BARRICADE_SPRITES } from '../sprites/traps'
import { ZOMBIE_SPRITES } from '../sprites/zombies'

// PIXEL MAPS

const PALETTE: Palette = { R: '#e8333a', W: '#ff8a8f', K: '#2a1418' }

const PIXELS: ReadonlyArray<string> = [
  '.KKK.',
  'KRWRK',
  'KRRRK',
  '.KRK.',
  '..K..',
  '.....',
]

const colorAt = (x: number, y: number): Option.Option<string> =>
  pipe(
    Array.get(PIXELS, y),
    Option.flatMap(row => Option.fromNullishOr(row[x])),
    Option.flatMap(symbol => Option.fromNullishOr(PALETTE[symbol])),
  )

const onlyImage = (shapes: ReadonlyArray<Draw.Shape>): Draw.Image => {
  expect(shapes.length).toBe(1)
  return Option.getOrThrow(Array.head(imagesIn(shapes)))
}

describe('sprite images', () => {
  test('a pixel map becomes the same PNG every time', () => {
    const first = spriteDataUrl(PIXELS, PALETTE)
    const second = spriteDataUrl([...PIXELS], { ...PALETTE })
    expect(Option.isSome(first)).toBe(true)
    expect(first).toEqual(second)
    expect(
      String.startsWith('data:image/png;base64,')(Option.getOrThrow(first)),
    ).toBe(true)
  })

  test('the PNG is the size of the pixel map and holds its exact colors', () => {
    const decoded = Option.getOrThrow(
      Option.flatMap(spriteDataUrl(PIXELS, PALETTE), decodePng),
    )
    expect(decoded.width).toBe(5)
    expect(decoded.height).toBe(PIXELS.length)
    Array.forEach(decoded.pixels, (pixel, index) => {
      const x = index % decoded.width
      const y = Math.floor(index / decoded.width)
      Option.match(colorAt(x, y), {
        onNone: () => expect(pixel.a).toBe(0),
        onSome: color => {
          expect(pixel.a).toBe(255)
          expect(hexOf(pixel)).toBe(color)
        },
      })
    })
  })

  test('a sprite is one pixelated image placed by its anchor', () => {
    const image = onlyImage(spriteShapes(PIXELS, PALETTE, { x: 2, y: 6 }))
    expect(image).toMatchObject({
      x: -2,
      y: -6,
      width: 5,
      height: PIXELS.length,
      rendering: 'Pixelated',
    })
  })

  test('an empty pixel map draws nothing', () => {
    expect(spriteShapes(['...', '...'], PALETTE)).toEqual([])
  })

  test('every zombie frame, facing, tone, frenzy look, and wear stage is one image', () => {
    const sprites = Array.flatMap(Record.values(ZOMBIE_SPRITES), kind =>
      Array.flatMap(kind.stages, stage =>
        Array.flatMap(
          [
            ...stage.walk,
            ...stage.lit,
            ...stage.rage,
            stage.gape,
            stage.litGape,
            stage.rageGape,
          ],
          set =>
            Array.flatMap(Record.values(set), facings =>
              Record.values(facings),
            ),
        ),
      ),
    )
    expect(sprites.length).toBeGreaterThan(100)
    Array.forEach(sprites, sprite => {
      expect(onlyImage(sprite).rendering).toBe('Pixelated')
    })
  })

  test('the player, glyphs, pickups, barricades, and coin are images', () => {
    const player = playerSprites(defaultAppearance)
    const sprites = [
      ...Array.flatMap([...player.walk, ...player.idle], set =>
        Array.flatMap(Record.values(set), facings => Record.values(facings)),
      ),
      ...Array.flatMap(Record.values(GLYPH_SPRITES), Record.values),
      ...Record.values(PICKUP_SPRITES),
      ...Array.flatMap(Record.values(BARRICADE_SPRITES), stages =>
        Array.flatMap(Record.values(stages), Record.values),
      ),
      KEY_SPRITE,
    ]
    Array.forEach(sprites, sprite => {
      expect(sprite).toHaveLength(1)
      expect(imagesIn(sprite)).toHaveLength(1)
    })
  })

  test('baking rectangles paints them in order into one image', () => {
    const baked = onlyImage(
      bakeShapes([
        Draw.Rect({ x: 2, y: 3, width: 3, height: 2, fill: '#000000' }),
        Draw.Rect({ x: 3, y: 3, width: 1, height: 1, fill: '#ffffff' }),
      ]),
    )
    expect(baked).toMatchObject({ x: 2, y: 3, width: 3, height: 2 })
    const decoded = Option.getOrThrow(decodePng(baked.src))
    expect(Array.map(decoded.pixels, hexOf)).toEqual([
      '#000000',
      '#ffffff',
      '#000000',
      '#000000',
      '#000000',
      '#000000',
    ])
  })

  test('shapes that are not whole pixel rectangles stay as they are', () => {
    const circle = [Draw.Circle({ x: 3, y: 3, radius: 2, fill: '#000' })]
    expect(bakeShapes(circle)).toBe(circle)
  })

  test('placing a one image sprite moves the image instead of grouping it', () => {
    const sprite = spriteShapes(PIXELS, PALETTE, { x: 0, y: 0 })
    expect(placeAt(10, 20, sprite)).toMatchObject({
      _tag: 'Image',
      x: 10,
      y: 20,
    })
  })
})

// PREBUILT SPRITES

const keyOf = (shapes: ReadonlyArray<Draw.Shape>): string =>
  Option.getOrThrow(standInKeyOf(onlyImage(shapes).src))

const ATLAS_FILE = 'sprites.png'

describe('prebuilt sprites', () => {
  afterEach(() => {
    useSpriteAtlas({ sources: [], entries: {}, normals: [], levels: {} })
    useSpriteMode('StandIn')
  })

  test('a stand-in holds the same pixels as the encoded PNG', () => {
    const standIn = onlyImage(spriteShapes(PIXELS, PALETTE))
    expect(standInKeyOf(standIn.src)).toEqual(Option.some(keyOf([standIn])))
    expect(decodePng(standIn.src)).toEqual(
      Option.flatMap(spriteDataUrl(PIXELS, PALETTE), decodePng),
    )
  })

  test('the same pixel map and colors always get the same key', () => {
    expect(keyOf(spriteShapes([...PIXELS], { ...PALETTE }))).toBe(
      keyOf(spriteShapes(PIXELS, PALETTE)),
    )
    expect(keyOf(spriteShapes(PIXELS, { ...PALETTE, R: '#000000' }))).not.toBe(
      keyOf(spriteShapes(PIXELS, PALETTE)),
    )
  })

  test('a sprite in the atlas is a cropped region of its file, placed by its anchor', () => {
    const key = keyOf(spriteShapes(PIXELS, PALETTE))
    useSpriteAtlas({
      sources: [ATLAS_FILE],
      entries: { [key]: [0, 7, 9, 5, 6] },
      normals: [],
      levels: {},
    })
    expect(onlyImage(spriteShapes(PIXELS, PALETTE, { x: 2, y: 6 }))).toEqual(
      Draw.Image({
        src: ATLAS_FILE,
        x: -2,
        y: -6,
        width: 5,
        height: 6,
        crop: { x: 7, y: 9, width: 5, height: 6 },
        rendering: 'Pixelated',
      }),
    )
  })

  test('a sprite the atlas marks empty draws nothing', () => {
    const key = keyOf(spriteShapes(PIXELS, PALETTE))
    useSpriteAtlas({
      sources: [ATLAS_FILE],
      entries: { [key]: null },
      normals: [],
      levels: {},
    })
    expect(spriteShapes(PIXELS, PALETTE)).toEqual([])
  })

  test('baked rectangles in the atlas are found by their content, wherever they stand', () => {
    const rects = (x: number) => [
      Draw.Rect({ x, y: 3, width: 3, height: 2, fill: '#000000' }),
      Draw.Rect({ x: x + 1, y: 3, width: 1, height: 1, fill: '#ffffff' }),
    ]
    const key = keyOf(bakeShapes(rects(2)))
    expect(keyOf(bakeShapes(rects(40)))).toBe(key)
    useSpriteAtlas({
      sources: [ATLAS_FILE],
      entries: { [key]: [0, 1, 1, 3, 2] },
      normals: [],
      levels: {},
    })
    expect(onlyImage(bakeShapes(rects(40)))).toMatchObject({
      src: ATLAS_FILE,
      x: 40,
      y: 3,
      crop: { x: 1, y: 1, width: 3, height: 2 },
    })
  })

  test('a sprite the atlas lacks is encoded as a PNG outside the tests', () => {
    useSpriteMode('Encode')
    expect(onlyImage(spriteShapes(PIXELS, PALETTE)).src).toBe(
      Option.getOrThrow(spriteDataUrl(PIXELS, PALETTE)),
    )
  })
})

// DRAW SHAPES

describe('Draw.Image', () => {
  test('builds an image shape', () => {
    const src = Option.getOrThrow(spriteDataUrl(PIXELS, PALETTE))
    expect(Draw.Image({ src, x: 0, y: 0, width: 5, height: 6 })).toEqual({
      _tag: 'Image',
      src,
      x: 0,
      y: 0,
      width: 5,
      height: 6,
    })
  })
})
