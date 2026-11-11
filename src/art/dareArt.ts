import { Array, Record, String } from 'effect'

import type { DareKind } from '../world/dare/dareSchema'
import { pixelIconUrl } from './icons'
import { type Palette, type Sprite, TOP_LEFT, spriteShapes } from './sprite'

// The dare's things as 7 by 7 pixel icons, for the dare card on the HUD and
// for the things themselves in the house: the silver spoon, the family
// portrait, a page of the guest book, Grandma Munch's recipe, the music box,
// the butler's bell, and Uncle Chunk's party hat. Each has a light
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
  PartyHat: [
    '...W...',
    '...M...',
    '..MYM..',
    '..YMY..',
    '.MYMYM.',
    '.YMYMY.',
    'MMMMMMM',
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
  M: '#d84ab0',
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
  M: '#9a8eb0',
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
// one pixel wide. An empty slot has a dim rim and the silhouette, the hat's
// a party pink one, since it closes the list; a found one a gold rim and
// the thing in color, with a green check (DARE_CHECK) on its corner.
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
const HAT_RIM = '#9a4a86'
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
  kind => (kind === 'PartyHat' ? HAT_RIM : EMPTY_RIM),
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
