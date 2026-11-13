import { Array, Option, String } from 'effect'

import { MARKS } from '../world/run/dareLadder'
import { pixelIconUrl } from './icons'
import { type Palette, type Sprite, spriteShapes } from './sprite'

// The dare ladder's marks as badges (GAME_DESIGN.md, "The dare ladder"),
// original to the game: a wax seal pressed on the dare card, scratched with
// a tally for each mark. Marks 1 to 4, the extra dares, are red wax with
// bone strokes; marks 5 to 8, the house rules, are black wax with a gold rim
// and gold strokes, so the two halves read apart at a glance. Shown on the
// lobby's pick, the end card, the Proof Shelf's rows, and the co-op host's
// seat. Built once at module scope.

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

// NOTE: the tally's columns for one to four strokes, centered in the seal,
// down its middle five rows.
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

// NOTE: red wax and bone for the extra dares.
const DARE_PALETTE: Palette = {
  O: OUTLINE,
  L: '#ef7a68',
  F: '#c0392b',
  D: '#7a1f18',
  S: '#f4f1de',
}

// NOTE: black wax in a gold rim for the house rules.
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

// NOTE: the seal with no mark, dim, for the lobby's pick at none.
const NONE_PALETTE: Palette = {
  O: '#3a2c30',
  L: '#5a4a50',
  F: '#2a2026',
  D: '#1e161a',
}

const NO_MARK_ICON = pixelIconUrl(SEAL, NONE_PALETTE)

// NOTE: a mark's badge on the canvas; mark 0 has none.
export const markSprite = (mark: number): Sprite =>
  Option.getOrElse(Array.get(MARK_SPRITES, mark - 1), (): Sprite => [])

// NOTE: a mark's badge for HTML; mark 0 is the dim seal.
export const markIcon = (mark: number): string =>
  Option.getOrElse(Array.get(MARK_ICONS, mark - 1), () => NO_MARK_ICON)
