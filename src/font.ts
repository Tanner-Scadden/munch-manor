import { Array, Option, Record, String, pipe } from 'effect'
import { Canvas } from 'foldkit'

import {
  ALERT_GLYPH_COLOR,
  COIN_COLOR,
  COIN_GLYPH_COLOR,
  DAMAGE_GLYPH_COLOR,
  GLYPH_SHADOW_COLOR,
  KILL_GLYPH_COLOR,
  STREAK_GLYPH_COLOR,
} from './constants'
import {
  type Anchor,
  type Sprite,
  TOP_LEFT,
  TRANSPARENT,
  bakeShapes,
  group,
  placeAt,
  spriteShapes,
  spriteWidth,
} from './sprite'

// GLYPHS

const GLYPH_PIXELS = {
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['##.', '..#', '.#.', '#..', '###'],
  '3': ['##.', '..#', '.#.', '..#', '##.'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '##.', '..#', '##.'],
  '6': ['.##', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '.#.', '.#.', '.#.'],
  '8': ['###', '#.#', '.#.', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '##.'],
  A: ['.#.', '#.#', '###', '#.#', '#.#'],
  B: ['##.', '#.#', '##.', '#.#', '##.'],
  C: ['.##', '#..', '#..', '#..', '.##'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'],
  E: ['###', '#..', '##.', '#..', '###'],
  F: ['###', '#..', '##.', '#..', '#..'],
  G: ['.##', '#..', '#.#', '#.#', '.##'],
  H: ['#.#', '#.#', '###', '#.#', '#.#'],
  I: ['###', '.#.', '.#.', '.#.', '###'],
  J: ['..#', '..#', '..#', '#.#', '.#.'],
  K: ['#.#', '#.#', '##.', '#.#', '#.#'],
  L: ['#..', '#..', '#..', '#..', '###'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#'],
  N: ['#..#', '##.#', '#.##', '#..#', '#..#'],
  O: ['.#.', '#.#', '#.#', '#.#', '.#.'],
  P: ['##.', '#.#', '##.', '#..', '#..'],
  Q: ['.#.', '#.#', '#.#', '##.', '.##'],
  R: ['##.', '#.#', '##.', '#.#', '#.#'],
  S: ['.##', '#..', '.#.', '..#', '##.'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  U: ['#.#', '#.#', '#.#', '#.#', '###'],
  V: ['#...#', '#...#', '.#.#.', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#.#.#', '##.##', '#...#'],
  X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'],
  Z: ['###', '..#', '.#.', '#..', '###'],
  '+': ['...', '.#.', '###', '.#.', '...'],
  x: ['...', '#.#', '.#.', '#.#', '...'],
  '.': ['.', '.', '.', '.', '#'],
  ',': ['.', '.', '.', '#', '#'],
  '!': ['#', '#', '#', '.', '#'],
  ':': ['.', '#', '.', '#', '.'],
  "'": ['#', '#', '.', '.', '.'],
  '%': ['#.#', '..#', '.#.', '#..', '#.#'],
  '/': ['..#', '..#', '.#.', '#..', '#..'],
  '-': ['...', '...', '###', '...', '...'],
  '?': ['##.', '..#', '.#.', '...', '.#.'],
  '∞': ['.....', '##.##', '#.#.#', '##.##', '.....'],
} satisfies Readonly<Record<string, ReadonlyArray<string>>>

export type Glyph = keyof typeof GLYPH_PIXELS

const GLYPH_ROWS = 5
export const GLYPH_HEIGHT = GLYPH_ROWS + 1
const GLYPH_GAP = 1
const SPACE_WIDTH = 2

const GLYPH_FILL = '#'
const GLYPH_SHADOW = 'S'

const isGlyph = (symbol: string): symbol is Glyph =>
  Object.hasOwn(GLYPH_PIXELS, symbol)

// COIN

export const COIN_SYMBOL = '$'

const COIN_OUTLINE_COLOR = '#5a3510'
const COIN_SHINE_COLOR = '#fff3b0'
const COIN_SHADE_COLOR = '#d9962a'
const COIN_MARK_COLOR = '#c98a1a'

const coinRect = (
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
): Canvas.Shape => Canvas.Rect({ x, y, width, height, fill })

export const COIN_WIDTH = 7
const COIN_LIFT = 1

export const COIN_SPRITE: Sprite = bakeShapes([
  coinRect(0, 2, 7, 3, COIN_OUTLINE_COLOR),
  coinRect(1, 1, 5, 5, COIN_OUTLINE_COLOR),
  coinRect(2, 0, 3, 7, COIN_OUTLINE_COLOR),
  coinRect(1, 2, 5, 3, COIN_COLOR),
  coinRect(2, 1, 3, 5, COIN_COLOR),
  coinRect(2, 1, 2, 1, COIN_SHINE_COLOR),
  coinRect(1, 2, 1, 2, COIN_SHINE_COLOR),
  coinRect(5, 2, 1, 3, COIN_SHADE_COLOR),
  coinRect(2, 5, 3, 1, COIN_SHADE_COLOR),
  coinRect(3, 2, 1, 3, COIN_MARK_COLOR),
])

export const glyphPixels = (glyph: Glyph): ReadonlyArray<string> =>
  GLYPH_PIXELS[glyph]

export const toGlyph = (symbol: string): Option.Option<Glyph> =>
  Option.liftPredicate(symbol, isGlyph)

const glyphWidth = (glyph: Glyph): number => spriteWidth(GLYPH_PIXELS[glyph])

type Mark =
  | Readonly<{ kind: 'Glyph'; glyph: Glyph }>
  | Readonly<{ kind: 'Coin' }>
  | Readonly<{ kind: 'Space' }>

type Cell = Readonly<{ mark: Mark; width: number }>

const COIN_CELL: Cell = { mark: { kind: 'Coin' }, width: COIN_WIDTH }

const cellOf = (symbol: string): Cell => {
  if (symbol === COIN_SYMBOL) {
    return COIN_CELL
  }

  return Option.match(toGlyph(symbol), {
    onNone: () => ({ mark: { kind: 'Space' }, width: SPACE_WIDTH }),
    onSome: glyph => ({
      mark: { kind: 'Glyph', glyph },
      width: glyphWidth(glyph),
    }),
  })
}

const cellsOf = (text: string): ReadonlyArray<Cell> =>
  Array.map(String.split(text, ''), cellOf)

export const textWidth = (text: string): number =>
  Math.max(
    0,
    Array.reduce(
      cellsOf(text),
      0,
      (sum, { width }) => sum + width + GLYPH_GAP,
    ) - GLYPH_GAP,
  )

const cellRow = ({ mark, width }: Cell, row: number): string =>
  mark.kind === 'Glyph'
    ? Option.getOrElse(Array.get(GLYPH_PIXELS[mark.glyph], row), () =>
        TRANSPARENT.repeat(width),
      )
    : TRANSPARENT.repeat(width)

type Placed = Readonly<{ x: number; shapes: ReadonlyArray<Canvas.Shape> }>

const placeCells = (
  cells: ReadonlyArray<Cell>,
  left: number,
  toShapes: (mark: Mark, x: number) => ReadonlyArray<Canvas.Shape>,
): ReadonlyArray<Canvas.Shape> =>
  Array.reduce(
    cells,
    { x: left, shapes: [] },
    (current: Placed, { mark, width }): Placed => ({
      x: current.x + width + GLYPH_GAP,
      shapes: Array.appendAll(current.shapes, toShapes(mark, current.x)),
    }),
  ).shapes

const coinAt = (x: number, top: number): Canvas.Shape =>
  placeAt(x, top - COIN_LIFT, COIN_SPRITE)

const coinShapes = (text: string): ReadonlyArray<Canvas.Shape> =>
  String.includes(COIN_SYMBOL)(text)
    ? placeCells(cellsOf(text), 0, (mark, x) =>
        mark.kind === 'Coin' ? [coinAt(x, 0)] : [],
      )
    : []

export const textPixels = (text: string): ReadonlyArray<string> => {
  const cells = cellsOf(text)
  return Array.makeBy(GLYPH_ROWS, row =>
    pipe(
      cells,
      Array.map(cell => cellRow(cell, row)),
      Array.join(TRANSPARENT.repeat(GLYPH_GAP)),
    ),
  )
}

const withDropShadow = (
  pixels: ReadonlyArray<string>,
): ReadonlyArray<string> => {
  const width = spriteWidth(pixels)
  const isFilled = (x: number, y: number): boolean =>
    pipe(
      Array.get(pixels, y),
      Option.flatMap(row => String.at(row, x)),
      Option.exists(symbol => symbol === GLYPH_FILL),
    )
  return Array.makeBy(pixels.length + 1, y =>
    pipe(
      Array.makeBy(width, x => {
        if (isFilled(x, y)) {
          return GLYPH_FILL
        } else if (isFilled(x, y - 1)) {
          return GLYPH_SHADOW
        } else {
          return TRANSPARENT
        }
      }),
      Array.join(''),
    ),
  )
}

// TONES

export type TextTone =
  | 'Damage'
  | 'Kill'
  | 'Streak'
  | 'Coin'
  | 'Alert'
  | 'Plain'
  | 'Prompt'
  | 'Hint'
  | 'Title'
  | 'Victory'
  | 'Defeat'
  | 'Fresh'

const TONE_COLORS: Readonly<Record<TextTone, string>> = {
  Damage: DAMAGE_GLYPH_COLOR,
  Kill: KILL_GLYPH_COLOR,
  Streak: STREAK_GLYPH_COLOR,
  Coin: COIN_GLYPH_COLOR,
  Alert: ALERT_GLYPH_COLOR,
  Plain: '#f4f1de',
  Prompt: '#ffe066',
  Hint: '#c9d3c0',
  Title: '#9be36a',
  Victory: '#ffd23f',
  Defeat: '#ff4a4f',
  Fresh: '#ff8a3d',
}

const tonePalette = (tone: TextTone) => ({
  [GLYPH_FILL]: TONE_COLORS[tone],
  [GLYPH_SHADOW]: GLYPH_SHADOW_COLOR,
})

const glyphSprites = (tone: TextTone): Readonly<Record<Glyph, Sprite>> =>
  Record.map(GLYPH_PIXELS, pixels =>
    spriteShapes(withDropShadow(pixels), tonePalette(tone), TOP_LEFT),
  )

export const GLYPH_SPRITES: Readonly<
  Record<TextTone, Readonly<Record<Glyph, Sprite>>>
> = Record.map(TONE_COLORS, (_color, tone) => glyphSprites(tone))

// TEXT

type Align = 'Left' | 'Center' | 'Right'

const alignedLeft = (x: number, width: number, align: Align): number => {
  if (align === 'Center') {
    return Math.round(x - width / 2)
  } else if (align === 'Right') {
    return Math.round(x - width)
  } else {
    return Math.round(x)
  }
}

export const textShapes = (
  text: string,
  tone: TextTone,
  x: number,
  y: number,
  align: Align,
): ReadonlyArray<Canvas.Shape> => {
  const top = Math.round(y)
  return placeCells(
    cellsOf(text),
    alignedLeft(x, textWidth(text), align),
    (mark, cellX) => {
      if (mark.kind === 'Glyph') {
        return [placeAt(cellX, top, GLYPH_SPRITES[tone][mark.glyph])]
      } else if (mark.kind === 'Coin') {
        return [coinAt(cellX, top)]
      } else {
        return []
      }
    },
  )
}

export type BakedText = Readonly<{ width: number; sprite: Sprite }>

export const bakeText = (text: string, tone: TextTone): BakedText => ({
  width: textWidth(text),
  sprite: [
    ...spriteShapes(
      withDropShadow(textPixels(text)),
      tonePalette(tone),
      TOP_LEFT,
    ),
    ...coinShapes(text),
  ],
})

export type Placement = Readonly<{
  x: number
  y: number
  align: Align
  scale?: number
  opacity?: number | undefined
}>

export const placeBaked = (
  { width, sprite }: BakedText,
  { x, y, align, scale = 1, opacity }: Placement,
): Canvas.Shape => {
  const left = alignedLeft(x, width * scale, align)
  return scale === 1 && opacity === undefined
    ? placeAt(left, Math.round(y), sprite)
    : group({
        translate: { x: left, y: Math.round(y) },
        scale: scale === 1 ? undefined : { x: scale, y: scale },
        opacity,
        shapes: sprite,
      })
}

// COUNTS

const COUNT_SPRITE_MAX = 40

const COUNT_ANCHOR: Anchor = { x: 0, y: Math.floor(GLYPH_ROWS / 2) }

export const COUNT_SPRITES: ReadonlyArray<Sprite> = Array.makeBy(
  COUNT_SPRITE_MAX + 1,
  count =>
    spriteShapes(
      textPixels(`x${count}`),
      { [GLYPH_FILL]: KILL_GLYPH_COLOR },
      COUNT_ANCHOR,
    ),
)
