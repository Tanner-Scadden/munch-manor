import { Array, Record, String } from 'effect'

import type { DareKind } from '../world/dare/dareSchema'
import { type Palette, type Sprite, TOP_LEFT, spriteShapes } from './sprite'

// The dare's things as 7 by 7 pixel icons, for the dare card on the HUD and
// for the things themselves in the house: the silver spoon, the family
// portrait, a page of the guest book, Grandma Munch's recipe, the music box,
// the butler's bell, and Uncle Chunk's party hat. Each has a silhouette too,
// the shape alone in one dim tone, for a dare card slot still empty.

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

const SILHOUETTE_TONE = '#6b6070'

const SILHOUETTE_PALETTE: Palette = Record.map(
  DARE_PALETTE,
  () => SILHOUETTE_TONE,
)

export const DARE_ICONS: Readonly<Record<DareKind, Sprite>> = Record.map(
  DARE_PIXELS,
  pixels => spriteShapes(pixels, DARE_PALETTE, TOP_LEFT),
)

// NOTE: a dare card slot, one sprite: a rim one pixel wide around the icon
// on a dark fill. An empty slot has a pale rim and the silhouette; a found
// one a gold rim and the thing in color.
export const DARE_SLOT_SIZE = DARE_ICON_SIZE + 2

const RIM = 'o'
const FILL = 'f'

const slotPixels = (pixels: ReadonlyArray<string>): ReadonlyArray<string> => {
  const edge = Array.join(
    Array.makeBy(DARE_SLOT_SIZE, () => RIM),
    '',
  )
  return [
    edge,
    ...Array.map(
      pixels,
      row => `${RIM}${String.replaceAll('.', FILL)(row)}${RIM}`,
    ),
    edge,
  ]
}

const SLOT_FILL_COLOR = 'rgba(8, 10, 12, 0.7)'

const DARE_EMPTY_RIM = '#8d8496'
const DARE_FOUND_RIM = '#ffe066'

const slotSprites = (
  palette: Palette,
  rim: string,
): Readonly<Record<DareKind, Sprite>> =>
  Record.map(DARE_PIXELS, pixels =>
    spriteShapes(
      slotPixels(pixels),
      { ...palette, [RIM]: rim, [FILL]: SLOT_FILL_COLOR },
      TOP_LEFT,
    ),
  )

export const DARE_EMPTY_SLOTS: Readonly<Record<DareKind, Sprite>> = slotSprites(
  SILHOUETTE_PALETTE,
  DARE_EMPTY_RIM,
)

export const DARE_FOUND_SLOTS: Readonly<Record<DareKind, Sprite>> = slotSprites(
  DARE_PALETTE,
  DARE_FOUND_RIM,
)
