import { Array, Option, String } from 'effect'

import { type Sprite, TOP_LEFT, spriteShapes } from './sprite.ts'

const PALETTE = {
  o: '#140a04',
  p: '#5a3418',
  P: '#b07a40',
  b: '#8a6418',
  G: '#f4c43c',
  Y: '#fff6b8',
  r: '#c8985a',
  R: '#fff2cc',
  w: '#4a2a12',
  W: '#946034',
  i: '#24242c',
  I: '#9a9aaa',
}

const TAUT_ROWS: ReadonlyArray<string> = [
  '.......Rr...',
  '.......rR...',
  '.......Rr...',
  '.......rR...',
  '.......Rr...',
  '.......rR...',
  'ooo....Rr...',
  'oPo..bGYGb..',
  'oPIIIGYRrGb.',
  'oPiiiGrRYGb.',
  'oPo..bGGGb..',
  'oPo....Rr...',
  'oPo....rR...',
  'oPo....Rr...',
  'oPo....rR...',
  'oPo.bGGRrGGb',
  'oPo.GRRRRRRG',
  'oPo.YrrrrrrY',
  'oPo.GRRRRRRG',
  'oPo.YrrrrrrY',
  'oPo.GRRRRRRG',
  'oPo.YrrrrrrY',
  'oPo.bGGGGGGb',
  'oPo..Ii..Ii.',
  'oPo..Ii..Ii.',
  'oPo.iIIiiIIi',
  'oPoIIIIIIIII',
  'oPoiiiiiiiii',
  'oooooooooooo',
]

const SLACK_ROWS: ReadonlyArray<string> = [
  '.......Rr...',
  '.......rR...',
  '......Rr....',
  '......rR....',
  '.......Rr...',
  '........rR..',
  'ooo....Rr...',
  'oPo..bGYGb..',
  'oPIIIGYRrGb.',
  'oPiiiGrRYGRr',
  'oPo..bGGGb.R',
  'oPo........R',
  'oPo.......Rr',
  'oPo.......R.',
  'oPo......Rr.',
  'oPo.bGGGRrGb',
  'oPo.GwWwWwWG',
  'oPo.YWwWwWwY',
  'oPo.GwWRrWwG',
  'oPo.YWwWwWwY',
  'oPo.GwWwWwWG',
  'oPo.YWwWwWwY',
  'oPo.bGGGGGGb',
  'oPo..Ii..Ii.',
  'oPo..Ii..Ii.',
  'oPo.iIIiiIIi',
  'oPoIIIIIIIII',
  'oPoiiiiiiiii',
  'oooooooooooo',
]

export const WINCH_HEIGHT_PX = TAUT_ROWS.length
export const WINCH_ROPE_COLUMN = 7

type Pixel = Readonly<{ column: number; row: number; mark: string }>

const HUB = { column: 7, row: 19 }

const CRANK_TURNS: Array.NonEmptyReadonlyArray<ReadonlyArray<Pixel>> = [
  [
    { ...HUB, mark: 'o' },
    { column: 7, row: 18, mark: 'i' },
    { column: 7, row: 17, mark: 'i' },
    { column: 7, row: 16, mark: 'b' },
  ],
  [
    { ...HUB, mark: 'o' },
    { column: 8, row: 19, mark: 'i' },
    { column: 9, row: 19, mark: 'i' },
    { column: 10, row: 19, mark: 'b' },
  ],
  [
    { ...HUB, mark: 'o' },
    { column: 7, row: 20, mark: 'i' },
    { column: 7, row: 21, mark: 'i' },
    { column: 7, row: 22, mark: 'b' },
  ],
  [
    { ...HUB, mark: 'o' },
    { column: 6, row: 19, mark: 'i' },
    { column: 5, row: 19, mark: 'i' },
    { column: 4, row: 19, mark: 'b' },
  ],
]

const withPixels = (
  rows: ReadonlyArray<string>,
  pixels: ReadonlyArray<Pixel>,
): ReadonlyArray<string> =>
  Array.map(rows, (line, row) =>
    Array.join(
      Array.map(String.split(line, ''), (mark, column) =>
        Option.getOrElse(
          Option.map(
            Array.findFirst(
              pixels,
              pixel => pixel.row === row && pixel.column === column,
            ),
            pixel => pixel.mark,
          ),
          () => mark,
        ),
      ),
      '',
    ),
  )

const framesOf = (
  rows: ReadonlyArray<string>,
): Array.NonEmptyReadonlyArray<Sprite> =>
  Array.map(CRANK_TURNS, turn =>
    spriteShapes(withPixels(rows, turn), PALETTE, TOP_LEFT),
  )

export const WINCH_TAUT: Array.NonEmptyReadonlyArray<Sprite> =
  framesOf(TAUT_ROWS)
export const WINCH_SLACK: Array.NonEmptyReadonlyArray<Sprite> =
  framesOf(SLACK_ROWS)

export const ROPE_LIGHT_COLOR = PALETTE.R
export const ROPE_DARK_COLOR = PALETTE.r
export const BRASS_COLOR = PALETTE.G
export const BRASS_DARK_COLOR = PALETTE.b
export const BRASS_SHINE_COLOR = PALETTE.Y
