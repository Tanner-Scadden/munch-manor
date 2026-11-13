import { Record } from 'effect'

import type { ProofEnding } from '../shared/proofData'
import { BIG_KEY_PALETTE, BIG_KEY_PIXELS } from './dareArt'
import { pixelIconUrl } from './icons'
import type { Palette } from './sprite'

// The Proof Shelf's pixel art (src/features/proof/), a first draft for the
// owner and Demi in Munch Studio: the treehouse's planks and brackets, the
// stamp each slot wears for how its run ended, the empty hook Uncle
// Chunk's big key hangs on, and the calendar's gold star for a day of
// missions done. The things themselves are the dare card's own pictures
// (DARE_ICON_URLS and DARE_SILHOUETTE_URLS in src/art/dareArt.ts).

type Pixels = ReadonlyArray<string>

export const PROOF_PALETTE: Palette = {
  o: '#2a1a12',
  W: '#c58a52',
  w: '#8a5a3a',
  d: '#5c3a24',
  n: '#9aa3b5',
  g: '#8fdc5a',
  G: '#3f7a2a',
  y: '#ffd23f',
  r: '#ff6b5e',
  R: '#a8322a',
  k: '#140c10',
  c: '#f4f1de',
}

// NOTE: one board of the shelf, stretched across its row, with a grain
// line and a dark lip under it.
export const PLANK_PIXELS: Pixels = [
  'WWWWWWWWWWWWWWWWWWWWWWWW',
  'wwwwwwwwwdwwwwwwwwwwwwww',
  'wwwwdwwwwwwwwwwwwwwwdwww',
  'dddddddddddddddddddddddd',
  'oooooooooooooooooooooooo',
]

// NOTE: the bracket nailed under each end of a board.
export const BRACKET_PIXELS: Pixels = [
  'oooooo',
  'oWwwwo',
  'oWwwo.',
  'oWwo..',
  'oWo...',
  'oo....',
]

// NOTE: the bent nail Uncle Chunk's big key hangs on, bare until he falls
// on that shelf's difficulty.
export const HOOK_PIXELS: Pixels = [
  '.nn..',
  'n..n.',
  '...n.',
  '..n..',
  '.nn..',
  '.n...',
  'kk...',
]

// NOTE: how the run that found a thing ended, one stamp each: the front
// door open on the night (ESCAPED), a chicken's head (CHICKEN, out the
// kitchen's back door), and a zombie's bite (MUNCHED).
export const STAMP_PIXELS: Readonly<Record<ProofEnding, Pixels>> = {
  Escaped: [
    'ooooooo..',
    'oddddgo..',
    'oddddggo.',
    'oddddgggo',
    'odydddggo',
    'oddddgggo',
    'oddddggo.',
    'oddddgo..',
    'ooooooo..',
  ],
  Chicken: [
    '...rr....',
    '..rrr....',
    '.ocCcco..',
    'occcccco.',
    'ockcccyy.',
    'occcccyyy',
    'occcccco.',
    '.occcco..',
    '..oooo...',
  ],
  Munched: [
    '..ooooo..',
    '.oRRRRRo.',
    'oRcRcRcRo',
    'oRrrrrrRo',
    'oRrrrrrRo',
    'oRrrrrrRo',
    'oRcRcRcRo',
    '.oRRRRRo.',
    '..ooooo..',
  ],
}

// NOTE: a day of missions done, stamped on the shelf's calendar.
export const DAY_STAR_PIXELS: Pixels = [
  '...y...',
  '..yyy..',
  'yyyyyyy',
  '.yyyyy.',
  '..yyy..',
  '.yy.yy.',
  'y.....y',
]

const CHICKEN_PALETTE: Palette = { ...PROOF_PALETTE, C: '#ffffff' }

export const PLANK_URL = pixelIconUrl(PLANK_PIXELS, PROOF_PALETTE, 'Stretch')

export const BRACKET_URL = pixelIconUrl(BRACKET_PIXELS, PROOF_PALETTE)

export const HOOK_URL = pixelIconUrl(HOOK_PIXELS, PROOF_PALETTE)

export const BIG_KEY_URL = pixelIconUrl(BIG_KEY_PIXELS, BIG_KEY_PALETTE)

export const DAY_STAR_URL = pixelIconUrl(DAY_STAR_PIXELS, PROOF_PALETTE)

export const STAMP_PALETTES: Readonly<Record<ProofEnding, Palette>> = {
  Escaped: PROOF_PALETTE,
  Chicken: CHICKEN_PALETTE,
  Munched: PROOF_PALETTE,
}

export const STAMP_URLS: Readonly<Record<ProofEnding, string>> = Record.map(
  STAMP_PIXELS,
  (pixels, ending) => pixelIconUrl(pixels, STAMP_PALETTES[ending]),
)
