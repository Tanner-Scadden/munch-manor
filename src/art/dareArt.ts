import { Array, Option, Record, String } from 'effect'

import type { DareKind } from '../world/dare/dareSchema'
import { pixelIconUrl } from './icons'
import { type Palette, type Sprite, TOP_LEFT, spriteShapes } from './sprite'

// The dare's things as 7 by 7 pixel icons, for the dare card on the HUD and
// for the things themselves in the house: the silver spoon, the family
// portrait, a page of the guest book, Grandma Munch's recipe, the music box,
// the butler's bell, and the four a player's milestones open
// (src/world/dare/milestones.ts): Uncle Chunk's chewed napkin ring,
// Rattles' dare note from 1924, Grandma's false teeth in their jar, and
// the party's invitation. Each has a light
// silhouette too, for a slot on the HUD's pocket still empty.

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

// NOTE: a thing still to find is a light silhouette that keeps its inner
// detail: each color of the thing takes a lavender of about its own
// lightness, so the spoon's bowl, the portrait's face, and the bell's shine
// still read on the slot's dark fill. One flat grey on a dark slot read as
// a blur on a phone (owner, 2026-11-10).
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

// NOTE: the things as SVG for HTML, crisp at any size: in color, and as
// the silhouette for one not found yet (the pause screen's list,
// src/features/menus/pauseProgress.ts).
export const DARE_ICON_URLS: Readonly<Record<DareKind, string>> = Record.map(
  DARE_PIXELS,
  pixels => pixelIconUrl(pixels, DARE_PALETTE),
)

export const DARE_SILHOUETTE_URLS: Readonly<Record<DareKind, string>> =
  Record.map(DARE_PIXELS, pixels => pixelIconUrl(pixels, SILHOUETTE_PALETTE))

// NOTE: a dare slot on the HUD's pocket, one sprite: the thing at twice its
// size, so a spoon reads as a spoon on a phone, on a dark fill inside a rim
// one pixel wide. An empty slot has a dim rim and the silhouette; a found
// one a gold rim and the thing in color, with a green check (DARE_CHECK) on its corner.
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

// NOTE: the check on a found slot's bottom right corner, hanging a little
// past it like a sticker.
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

// NOTE: the dare card itself, folded in your pocket: a slip of paper with
// three lines of scrawl, on the pocket's chip and its open list.
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

// NOTE: a thing at twice its size inside a dark outline one pixel wide, so
// it reads on any floor and in Rattles' bubble: what lies in an open room
// on Dare and Double Dare (src/features/dare/dareView.ts), and the thing a
// hint is about (src/screens/game/stallBubble.ts).
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

// THE DARE JOURNAL

// NOTE: the Dare Journal itself, a brown book with a gold J and its pages'
// edge: a story page opened on the end card's unlock card
// (src/features/end/rankStripView.ts), big and outlined as the things are,
// and the journal's Story tab (src/features/munchopedia/view.ts).
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

// THE SATCHEL

// NOTE: the satchel at the foot of the dare card opened from the HUD
// (src/features/dare/pocketCardView.ts), drawn at twice its size: its back
// wall, behind the things found, and its front, a buckled leather flap
// with a pocket, in front of them, so each thing pokes out of the top.
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

// NOTE: under a missing thing's outline on the opened card, beside its
// room's icon, on Dare and Double Dare: an eye with a gold glint, for a
// thing that lies in plain sight there.
export const PLAIN_SIGHT: Sprite = spriteShapes(
  ['..ooo..', '.owwwo.', 'owwkwwo', '.owwwo.', '..ooo..'],
  { o: '#4a4038', w: '#ffe066', k: '#140c10' },
  TOP_LEFT,
)

// THE BIG KEY

// NOTE: Uncle Chunk's big skeleton key, twice a house key's size, gold with
// a dark outline: in flight to the front door (src/features/dare/dareView.ts)
// and hung on the Proof Shelf once he is felled (src/features/proof/).
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
