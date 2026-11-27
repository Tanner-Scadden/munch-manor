import { Array, Option, String } from 'effect'

import { MARKS } from '#world/run/dareLadder.ts'

import { pixelIconUrl } from './icons/icons.ts'
import { type Palette, type Sprite, spriteShapes } from './sprite.ts'

const SEAL = [
  '...OOOOO...',
  '..OLLLLLO..',
  '.OLFFFFFDO.',
  'OLFFFFFFFDO',
  'OLFFFFFFFDO',
  'OLFFFFFFFDO',
  'OLFFFFFFFDO',
  'OLFFFFFFFDO',
  '.OFFFFFFDO.',
  '..ODDDDDO..',
  '...OOOOO...',
]

const STROKE_COLUMNS: ReadonlyArray<ReadonlyArray<number>> = [
  [5],
  [4, 6],
  [3, 5, 7],
  [2, 4, 6, 8],
]
const STROKE_TOP = 3
const STROKE_BOTTOM = 7

const strokesOf = (mark: number): number => (mark > 4 ? mark - 4 : mark)

const markPixels = (mark: number): ReadonlyArray<string> => {
  const columns = Option.getOrElse(
    Array.get(STROKE_COLUMNS, strokesOf(mark) - 1),
    (): ReadonlyArray<number> => [],
  )
  return Array.map(SEAL, (row, y) =>
    y < STROKE_TOP || y > STROKE_BOTTOM
      ? row
      : Array.join(
          Array.map(String.split(row, ''), (pixel, x) =>
            Array.contains(columns, x) ? 'S' : pixel,
          ),
          '',
        ),
  )
}

const OUTLINE = '#140c10'

const DARE_PALETTE: Palette = {
  O: OUTLINE,
  L: '#ef7a68',
  F: '#c0392b',
  D: '#7a1f18',
  S: '#f4f1de',
}

const HOUSE_PALETTE: Palette = {
  O: OUTLINE,
  L: '#ffe066',
  F: '#3a1c48',
  D: '#a87a1e',
  S: '#ffe066',
}

const markPaletteOf = (mark: number): Palette =>
  mark > 4 ? HOUSE_PALETTE : DARE_PALETTE

const MARK_SPRITES: ReadonlyArray<Sprite> = Array.map(MARKS, mark =>
  spriteShapes(markPixels(mark), markPaletteOf(mark)),
)

const MARK_ICONS: ReadonlyArray<string> = Array.map(MARKS, mark =>
  pixelIconUrl(markPixels(mark), markPaletteOf(mark)),
)

const NONE_PALETTE: Palette = {
  O: '#3a2c30',
  L: '#5a4a50',
  F: '#2a2026',
  D: '#1e161a',
}

const NO_MARK_ICON = pixelIconUrl(SEAL, NONE_PALETTE)

export const markSprite = (mark: number): Sprite =>
  Option.getOrElse(Array.get(MARK_SPRITES, mark - 1), (): Sprite => [])

export const markIcon = (mark: number): string =>
  Option.getOrElse(Array.get(MARK_ICONS, mark - 1), () => NO_MARK_ICON)
