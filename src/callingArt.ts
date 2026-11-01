import { Array } from 'effect'

import { pixelIconUrl } from './icons'
import type { Calling } from './playerData'
import type { Palette } from './sprite'

// The callings' pixel art for the menus (src/callingView.ts): each calling's
// prop, and the little pictures that say its quirk with no words. They are
// SVG icons from pixel maps, like the menus' other icons. The prop on the
// player in play is part of the player's own sprite (src/appearance.ts).

const PALETTE: Palette = {
  X: '#f4f1de',
  O: '#140c10',
  R: '#e8443a',
  W: '#ffb0a8',
  Y: '#ffd23f',
  y: '#b8861c',
  H: '#f2c230',
  h: '#b8861c',
  P: '#c28a4a',
  D: '#7a4e26',
  N: '#cfd3dc',
  M: '#9aa3ad',
  m: '#5e6674',
  B: '#3d7bd9',
  b: '#2a5aa8',
  V: '#2f9e57',
  v: '#1d6e3d',
  G: '#d9d4c0',
}

const icon = (pixels: ReadonlyArray<string>): string =>
  pixelIconUrl(pixels, PALETTE)

// THE PROPS

export const PROP_ICONS: Readonly<Record<Calling, string>> = {
  You: icon([
    '..XXX..',
    '.XXXXX.',
    '.XXXXX.',
    '..XXX..',
    '.XXXXX.',
    'XXXXXXX',
    'XXXXXXX',
  ]),
  Handyman: icon([
    '...hhh...',
    '..HHHHH..',
    '.HHXHHHH.',
    'HHHXHHHHH',
    'hhhhhhhhh',
    '.........',
  ]),
  TrackStar: icon([
    '.RRRRRRR.',
    'RRXXXXXRR',
    'RXXXXXXXR',
    'RRXXXXXRR',
    '.RRRRRRR.',
    '...R.R...',
    '..RR.RR..',
  ]),
  PennyPincher: icon([
    '..VVVVV..',
    '.VVVYYVV.',
    'VVVVYYVVV',
    'VVVVVVVVV',
    'vvvvvvvvv',
    '.........',
  ]),
  LineCook: icon([
    '.XX.XX.X.',
    'XXXXXXXXX',
    'XXXXXXXXX',
    '.XXXXXXX.',
    '.GGGGGGG.',
    '.XXXXXXX.',
  ]),
}

// THE QUIRKS

const HEART_ICON = icon([
  '.RR.RR.',
  'RWRRRRR',
  'RRRRRRR',
  '.RRRRR.',
  '..RRR..',
  '...R...',
])

const PLANK_ICON = icon(['PPPPPPPPP', 'PNPPPPPNP', 'PPPPPPPPP', 'DDDDDDDDD'])

// NOTE: a shield for the Handyman's longer breather after a bite: the
// flash that keeps the zombies off him lasts half again as long.
const SHIELD_ICON = icon([
  'bbbbbbbbb',
  'bXBBBBBBb',
  'bXBBBBBBb',
  'bXBBBBBBb',
  '.bBBBBBb.',
  '..bBBBb..',
  '...bBb...',
  '....b....',
])

const SHOE_ICON = icon([
  '.....BB..',
  '....BBBB.',
  '..BBBBBB.',
  'BBBBBBBBB',
  'XXXXXXXXX',
])

const MAGAZINE_ICON = icon([
  '.YYY.',
  'MMMMM',
  'MmmmM',
  'MMMMM',
  'MmmmM',
  'MMMMM',
  'MMMMM',
  '.MMM.',
])

const COIN_ICON = icon([
  '..YYY..',
  '.YXXYY.',
  'YXYYYYy',
  'YXYYYYy',
  'YYYYYyy',
  '.YyyyY.',
  '..YYY..',
])

const TAG_ICON = icon([
  '.XXXXXX.',
  'XXOXXXXX',
  'XXXXXXXX',
  'XXXXXXXX',
  '.XXXXXX.',
])

const POT_ICON = icon([
  '...MM....',
  '.MMMMMMM.',
  'MMMMMMMMM',
  '.MmmmmmM.',
  '.MmmmmmM.',
  '.MMMMMMM.',
])

// NOTE: a pistol with a red slash through it.
const PISTOL_PIXELS = [
  '.MMMMMMM.',
  '.MMMMMMMM',
  '.MMMMM...',
  '..MMM....',
  '..MMM....',
  '..MM.....',
]

const crossedOut = (pixels: ReadonlyArray<string>): ReadonlyArray<string> =>
  Array.map(pixels, (row, y) => {
    const x = Math.round((y * (row.length - 1)) / (pixels.length - 1))
    const slashed = `${row.slice(0, x)}R${row.slice(x + 1)}`
    const other = row.length - 1 - x
    return `${slashed.slice(0, other)}R${slashed.slice(other + 1)}`
  })

const NO_PISTOL_ICON = icon(crossedOut(PISTOL_PIXELS))

// NOTE: the picture beside each special's line on a card (src/callingView.ts,
// src/callingSpecials.ts): a heart, a plank, a shield for the longer
// breather, a shoe, a magazine, a price tag, a coin, the pot, and a pistol
// crossed out.
export const QUIRK_ICONS = {
  Heart: HEART_ICON,
  Plank: PLANK_ICON,
  Shield: SHIELD_ICON,
  Shoe: SHOE_ICON,
  Magazine: MAGAZINE_ICON,
  Tag: TAG_ICON,
  Coin: COIN_ICON,
  Pot: POT_ICON,
  NoPistol: NO_PISTOL_ICON,
} as const
