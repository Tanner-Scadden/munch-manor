import { Array, Option, String } from 'effect'

import { type Sprite, TOP_LEFT, spriteShapes } from './sprite'

// The chandelier's winch, the dining room's cleat station: an oak post
// against the west wall, an iron arm out to a brass pulley, the rope
// leaving its top for the chandelier, and a drum on iron feet with a crank. Hung, the drum is wound full and the rope stands straight and taut;
// dropped, the drum is bare and the rope hangs loose off the pulley. The
// crank turns while the winch is worked. The pulley stands as high as the
// west wall's top, so its rope runs on in 3D from where it leaves the art's
// top, west onto the wall and along the wall tops to the chandelier
// (src/render/room/chandelierRope.ts). The rope is one solid color with a
// darker side, never a twist of two: a checker of two tones read from afar
// as a fence (owner, 2026-11-15).

// NOTE: high value contrast, as the room's look pass keeps value and loses
// most hue: bright brass and a pale rope against a dark outline, as the
// candelabras read (owner, 2026-11-15: the first winch read as dark brown
// on brown).
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
  'ooo....Rr...',
  'oPo..bGYGb..',
  'oPIIIGYRrGb.',
  'oPiiiGrRYGb.',
  'oPo..bGGGb..',
  'oPo....Rr...',
  'oPo....Rr...',
  'oPo....Rr...',
  'oPo....Rr...',
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

// NOTE: how tall the winch stands (12 wide, its post's left edge on the
// wall's face at its tile's west edge), and the column the rope leaves its
// top from.
export const WINCH_HEIGHT_PX = TAUT_ROWS.length
export const WINCH_ROPE_COLUMN = 7

// NOTE: the crank's arm from the drum's middle, a quarter turn a frame:
// up, east, down, west: dark iron and a dark brass knob on the pale rope.
type Pixel = Readonly<{ column: number; row: number; mark: string }>

const HUB = { column: 7, row: 13 }

const CRANK_TURNS: Array.NonEmptyReadonlyArray<ReadonlyArray<Pixel>> = [
  [
    { ...HUB, mark: 'o' },
    { column: 7, row: 12, mark: 'i' },
    { column: 7, row: 11, mark: 'i' },
    { column: 7, row: 10, mark: 'b' },
  ],
  [
    { ...HUB, mark: 'o' },
    { column: 8, row: 13, mark: 'i' },
    { column: 9, row: 13, mark: 'i' },
    { column: 10, row: 13, mark: 'b' },
  ],
  [
    { ...HUB, mark: 'o' },
    { column: 7, row: 14, mark: 'i' },
    { column: 7, row: 15, mark: 'i' },
    { column: 7, row: 16, mark: 'b' },
  ],
  [
    { ...HUB, mark: 'o' },
    { column: 6, row: 13, mark: 'i' },
    { column: 5, row: 13, mark: 'i' },
    { column: 4, row: 13, mark: 'b' },
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

// NOTE: the winch's frames, a crank turn each, built once as the module
// loads: taut over a hung chandelier, slack under a fallen one.
export const WINCH_TAUT: Array.NonEmptyReadonlyArray<Sprite> =
  framesOf(TAUT_ROWS)
export const WINCH_SLACK: Array.NonEmptyReadonlyArray<Sprite> =
  framesOf(SLACK_ROWS)

// NOTE: the rope's color and its darker underside, for its 3D run to the
// chandelier, and the brass of its pulleys.
export const ROPE_LIGHT_COLOR = PALETTE.R
export const ROPE_DARK_COLOR = PALETTE.r
export const BRASS_COLOR = PALETTE.G
export const BRASS_DARK_COLOR = PALETTE.b
export const BRASS_SHINE_COLOR = PALETTE.Y
