import { Array, Option, Record, String } from 'effect'

import type { DareKind } from '#world/dare/dareSchema.ts'

import { pixelIconUrl } from './icons/icons.ts'
import { type Palette, type Sprite, TOP_LEFT, spriteShapes } from './sprite.ts'

export const DARE_ICON_SIZE = 7

const DARE_PIXELS: Readonly<Record<DareKind, ReadonlyArray<string>>> = {
  SilverSpoon: [
    '....SS.',
    '...SWWS',
    '...SWWS',
    '....SS.',
    '...S...',
    '..S....',
    '.S.....',
  ],
  FamilyPortrait: [
    'GGGGGGG',
    'GbbbbbG',
    'GbsssbG',
    'GbsksbG',
    'GbsssbG',
    'GbrrrbG',
    'GGGGGGG',
  ],
  GuestBookPage: [
    'pppppd.',
    'pkkkpdd',
    'ppppppd',
    'pkkkkpd',
    'ppppppd',
    'pkkkkpd',
    'ppppppd',
  ],
  GrandmasRecipe: [
    'ccccccc',
    'cRRcRRc',
    'cRRRRRc',
    'ccRRRcc',
    'cccRccc',
    'ckkkkkc',
    'ccccccc',
  ],
  MusicBox: [
    '...N.N.',
    '..NN.NN',
    '.......',
    'RRRRRRR',
    'RyRRRyR',
    'RRRRRRR',
    'r.....r',
  ],
  ButlersBell: [
    '...k...',
    '..yyy..',
    '.yYyyy.',
    '.yYyyy.',
    'yyyyyyy',
    'ddddddd',
    '.......',
  ],
  NapkinRing: [
    '..ccc..',
    '.cGGGc.',
    'cG...Gc',
    'cG...Gc',
    'cG...Gc',
    '.cG.Gc.',
    '..c.c..',
  ],
  DareNote: [
    'aaaaaa.',
    'akkakaa',
    'aaaaaaa',
    'akakkka',
    'aaaaaaa',
    'aaaRRRa',
    '.aaaaaa',
  ],
  FalseTeeth: [
    '.kkkkk.',
    'jjjjjjj',
    'jRRRRRj',
    'jWWWWWj',
    'jWWWWWj',
    'jRRRRRj',
    '.jjjjj.',
  ],
  Invitation: [
    '.......',
    'eeeeeee',
    'eGeeeGe',
    'eeGeGee',
    'eeeReee',
    'eeeeeee',
    '.......',
  ],
}

const DARE_PALETTE: Palette = {
  S: '#9aa3ad',
  W: '#e6ebf0',
  G: '#c9a227',
  b: '#3a2a3a',
  s: '#e8c39e',
  k: '#140c10',
  r: '#6a1f2a',
  p: '#f1e7cf',
  d: '#b8a77e',
  c: '#f4e6c3',
  R: '#c8483c',
  N: '#f4f1de',
  y: '#e0b232',
  Y: '#fff1a8',
  a: '#d9c48f',
  j: '#7fb8c9',
  e: '#e9c7d8',
}

const SILHOUETTE_PALETTE: Palette = {
  S: '#a89cba',
  W: '#e2dbec',
  G: '#b4a8c6',
  b: '#5a506a',
  s: '#d2c9de',
  k: '#3a3046',
  r: '#6e6282',
  p: '#d6cee2',
  d: '#9e92b0',
  c: '#d6cee2',
  R: '#8e82a2',
  N: '#e2dbec',
  y: '#b8acca',
  Y: '#ddd5e8',
  a: '#c4b8d4',
  j: '#9e92b0',
  e: '#d2c9de',
}

export const DARE_ICONS: Readonly<Record<DareKind, Sprite>> = Record.map(
  DARE_PIXELS,
  pixels => spriteShapes(pixels, DARE_PALETTE, TOP_LEFT),
)

export const DARE_ICON_URLS: Readonly<Record<DareKind, string>> = Record.map(
  DARE_PIXELS,
  pixels => pixelIconUrl(pixels, DARE_PALETTE),
)

export const DARE_SILHOUETTE_URLS: Readonly<Record<DareKind, string>> =
  Record.map(DARE_PIXELS, pixels => pixelIconUrl(pixels, SILHOUETTE_PALETTE))

const SLOT_SCALE = 2
export const DARE_SLOT_SIZE = DARE_ICON_SIZE * SLOT_SCALE + 2

const RIM = 'o'
const FILL = 'f'

const doubled = (pixels: ReadonlyArray<string>): ReadonlyArray<string> =>
  Array.flatMap(pixels, row => {
    const wide = Array.join(
      Array.map(String.split(row, ''), symbol =>
        String.repeat(SLOT_SCALE)(symbol),
      ),
      '',
    )
    return Array.makeBy(SLOT_SCALE, () => wide)
  })

const slotPixels = (pixels: ReadonlyArray<string>): ReadonlyArray<string> => {
  const edge = String.repeat(DARE_SLOT_SIZE)(RIM)
  return [
    edge,
    ...Array.map(
      doubled(pixels),
      row => `${RIM}${String.replaceAll('.', FILL)(row)}${RIM}`,
    ),
    edge,
  ]
}

const EMPTY_FILL = '#120d16'
const FOUND_FILL = '#2b2131'
const EMPTY_RIM = '#6f6580'
const FOUND_RIM = '#ffe066'

const slotSprites = (
  palette: Palette,
  fill: string,
  rimOf: (kind: DareKind) => string,
): Readonly<Record<DareKind, Sprite>> =>
  Record.map(DARE_PIXELS, (pixels, kind) =>
    spriteShapes(
      slotPixels(pixels),
      { ...palette, [RIM]: rimOf(kind), [FILL]: fill },
      TOP_LEFT,
    ),
  )

export const DARE_EMPTY_SLOTS: Readonly<Record<DareKind, Sprite>> = slotSprites(
  SILHOUETTE_PALETTE,
  EMPTY_FILL,
  () => EMPTY_RIM,
)

export const DARE_FOUND_SLOTS: Readonly<Record<DareKind, Sprite>> = slotSprites(
  DARE_PALETTE,
  FOUND_FILL,
  () => FOUND_RIM,
)

export const DARE_CHECK_SIZE = 9

export const DARE_CHECK: Sprite = spriteShapes(
  [
    '..ooooo..',
    '.oGGGGGo.',
    'oGGGGGGGo',
    'oGGGGGwGo',
    'oGwGGwGGo',
    'oGGwwGGGo',
    'oGGGwGGGo',
    '.oGGGGGo.',
    '..ooooo..',
  ],
  { o: '#0f2a12', G: '#3fae49', w: '#f4f1de' },
  TOP_LEFT,
)

export const DARE_CARD_WIDTH = 7
export const DARE_CARD_HEIGHT = 9

export const DARE_CARD_ICON: Sprite = spriteShapes(
  [
    '.ooooo.',
    'opppppo',
    'okkkkpo',
    'opppppo',
    'okkkppo',
    'opppppo',
    'okkkkpo',
    'opppppo',
    '.ooooo.',
  ],
  { o: '#140c10', p: '#f4e6c3', k: '#8a7a5a' },
  TOP_LEFT,
)

export const DARE_BIG_ICON_SIZE = DARE_ICON_SIZE * SLOT_SCALE + 2

const OUTLINE = 'O'

const isInk = (pixels: ReadonlyArray<string>, x: number, y: number): boolean =>
  Option.exists(
    Option.flatMap(Array.get(pixels, y), row => String.charAt(row, x)),
    symbol => symbol !== '.' && symbol !== OUTLINE,
  )

const NEIGHBORS: ReadonlyArray<readonly [number, number]> = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
]

const outlined = (pixels: ReadonlyArray<string>): ReadonlyArray<string> => {
  const big = doubled(pixels)
  return Array.makeBy(DARE_BIG_ICON_SIZE, y =>
    Array.join(
      Array.makeBy(DARE_BIG_ICON_SIZE, x => {
        const inner = { x: x - 1, y: y - 1 }
        return isInk(big, inner.x, inner.y)
          ? Option.getOrElse(
              Option.flatMap(Array.get(big, inner.y), row =>
                String.charAt(row, inner.x),
              ),
              () => '.',
            )
          : Array.some(NEIGHBORS, ([dx, dy]) =>
                isInk(big, inner.x + dx, inner.y + dy),
              )
            ? OUTLINE
            : '.'
      }),
      '',
    ),
  )
}

export const DARE_BIG_ICONS: Readonly<Record<DareKind, Sprite>> = Record.map(
  DARE_PIXELS,
  pixels =>
    spriteShapes(
      outlined(pixels),
      { ...DARE_PALETTE, [OUTLINE]: '#140c10' },
      TOP_LEFT,
    ),
)

const JOURNAL_PIXELS: ReadonlyArray<string> = [
  'BBBBBBp',
  'BbGGGbp',
  'BbbGbbp',
  'BbbGbbp',
  'BGbGbbp',
  'BbGbbbp',
  'BBBBBBp',
]

const JOURNAL_PALETTE: Palette = {
  B: '#4a2e1c',
  b: '#7a4a2a',
  G: '#ffd23f',
  p: '#f1e7cf',
}

export const JOURNAL_ICON_URL = pixelIconUrl(JOURNAL_PIXELS, JOURNAL_PALETTE)

export const JOURNAL_BIG_ICON: Sprite = spriteShapes(
  outlined(JOURNAL_PIXELS),
  { ...JOURNAL_PALETTE, [OUTLINE]: '#140c10' },
  TOP_LEFT,
)

export const SATCHEL_SCALE = 2
export const SATCHEL_WIDTH = 42
export const SATCHEL_BACK_HEIGHT = 4
export const SATCHEL_FRONT_HEIGHT = 14

const SATCHEL_PALETTE: Palette = {
  o: '#2a1a12',
  L: '#c08a52',
  B: '#9a6236',
  b: '#6e4224',
  l: '#b07a48',
  s: '#e8c89a',
  d: '#5a3418',
  D: '#7a4a26',
  G: '#ffd23f',
  g: '#c9a227',
  k: '#24140c',
}

export const SATCHEL_BACK: Sprite = spriteShapes(
  [
    '.oooooooooooooooooooooooooooooooooooooooo.',
    'obbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbo',
    'okkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkko',
    'okkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkko',
  ],
  SATCHEL_PALETTE,
  TOP_LEFT,
)

export const SATCHEL_FRONT: Sprite = spriteShapes(
  [
    '.oooooooooooooooooooooooooooooooooooooooo.',
    'oLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLo',
    'oBsBBsBBsBBsBBsBBsBBsBBsBBsBBsBBsBBsBBsBBo',
    'olBBBBBBBBBBBBBBBBBdDDdBBBBBBBBBBBBBBBbbbo',
    'olBBBBBBBBBBBBBBBBBdDDdBBBBBBBBBBBBBBBbbbo',
    'olBBBBBBBBBBddddddddDDddddddddBBBBBBBBbbbo',
    'olBBBBBBBBBBdLLLLLGGGGGGLLLLLdBBBBBBBBbbbo',
    'olBBBBBBBBBBdBBBBBGGDDGGBBBBBdBBBBBBBBbbbo',
    'olBBBBBBBBBBdBBBBBgGGGGgBBBBBdBBBBBBBBbbbo',
    'olBBBBBBBBBBdBBBBBBBBBBBBBBBBdBBBBBBBBbbbo',
    'olBBBBBBBBBBddddddddddddddddddBBBBBBBBbbbo',
    'olBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBbbbo',
    '.obbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbo.',
    '..oooooooooooooooooooooooooooooooooooooo..',
  ],
  SATCHEL_PALETTE,
  TOP_LEFT,
)

export const PLAIN_SIGHT: Sprite = spriteShapes(
  ['..ooo..', '.owwwo.', 'owwkwwo', '.owwwo.', '..ooo..'],
  { o: '#4a4038', w: '#ffe066', k: '#140c10' },
  TOP_LEFT,
)

export const BIG_KEY_PALETTE: Palette = {
  k: '#140c10',
  Y: '#ffd23f',
  y: '#c9971c',
  W: '#fff7d0',
}

export const BIG_KEY_PIXELS: ReadonlyArray<string> = [
  '.kkkk..........',
  'kYWYYk.........',
  'kYkkYkkkkkkkkk.',
  'kYkkYYYYYYYYYYk',
  'kyyyykkkkykkyyk',
  '.kkkk....kk.kkk',
]
