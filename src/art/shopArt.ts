import { Array, Function, Record } from 'effect'

import type { TrapKind, WeaponKind } from '../world/schema/entitySchema'
import type { ShopCategory, ShopItemId } from '../world/schema/worldSchema'
import { pixelIconUrl } from './icons'
import {
  MOOD_FACES,
  type Mood,
  RATTLES_BUST_ROWS,
  RATTLES_PALETTE,
  rattlesPixels,
} from './rattlesArt'
import type { Palette } from './sprite'
import { GUN_TIER_TRIMS } from './sprites/guns'
import { HEART_PIXELS } from './sprites/hearts'

// NOTE: the shop's pictures are pixel maps turned into SVG once, at module
// scope, like the HTML buttons' icons. Each keeps its size in pixels so CSS
// can draw it at a whole multiple and the pixels stay square.
// NOTE: the segments a stat bar has, in the shop's rows and the guide's
// cards.
export const BAR_SEGMENTS = 5

export type ShopArt = Readonly<{ url: string; width: number; height: number }>

export const artOf: {
  (palette: Palette): (pixels: ReadonlyArray<string>) => ShopArt
  (pixels: ReadonlyArray<string>, palette: Palette): ShopArt
} = Function.dual(
  2,
  (pixels: ReadonlyArray<string>, palette: Palette): ShopArt => ({
    url: pixelIconUrl(pixels, palette),
    width: Array.reduce(pixels, 0, (widest, row) =>
      Math.max(widest, row.length),
    ),
    height: pixels.length,
  }),
)

// PALETTE

const INK = '#140c10'

const GUN_BASE: Palette = {
  K: INK,
  G: '#8d96a3',
  H: '#d9dde3',
  W: '#a8703a',
  V: '#5c3a1a',
  M: '#4a4f5a',
  R: '#d8423a',
  D: '#2e2e36',
  B: '#4ab8f0',
  C: '#c8f4ff',
  N: '#ff7ab8',
  Y: '#c9962b',
  J: '#f0cf6a',
}

const trimmed = (tier: number): Palette =>
  Record.union(
    GUN_BASE,
    GUN_TIER_TRIMS[Math.min(tier, GUN_TIER_TRIMS.length - 1)] ?? {},
    (_base, trim) => trim,
  )

// GUNS

const GUN_PIXELS: Readonly<Record<WeaponKind, ReadonlyArray<string>>> = {
  Pistol: [
    '.KKKKKKKKKKKK.',
    'KHHHHHHHHHHHGK',
    'KGGGGGGGGGGGGK',
    'KKKKKKGKKKKKK.',
    '..KWWKRK......',
    '..KWWKKK......',
    '.KWWK.........',
    '.KWWK.........',
    '.KKKK.........',
  ],
  Shotgun: [
    '.......KKKKKKKKKKKKKKKKK',
    'VV....KGHHHHHHHHHHHHHHHK',
    'VWW..KGGGGGGGGGGGGGGGGGK',
    'VWWWWWKKKKKKKKKKKKKKKKK.',
    'VWWWWWKRK.KMMMMMMMMK....',
    '.VVWWK.K..KKKKKKKKKK....',
    '...VVV..................',
  ],
  Smg: [
    '..KKKKKKKKKKKKKKK.',
    '.KGHHHHHHHHHHHHHGK',
    'KKGGGGGGGGGGGGGKK.',
    'KMKKKKKKKKKKKK....',
    'KM.KWK.KMMK.......',
    'KK.KWK.KMMK.......',
    '...KKK.KMMK.......',
    '.......KMMK.......',
    '.......KKKK.......',
  ],
  Peashooter: ['.KKKKKKK', 'KVPPPPQK', 'KVPQQQPQ', 'KVPPPPQK', '.KKKKKKK'],
  Cooker: [
    '......KKKK......',
    '.....KHHHHK.....',
    '..KKKKKKKKKKKK..',
    '.KGHHHHHHHHHHGK.',
    'KKKKKKKKKKKKKKKK',
    'RRKMMMMMMMMMMKRR',
    'RRKMGMMMMMMGMKRR',
    '..KMMMMMMMMMMK..',
    '..KMMMMMMMMMMK..',
    '...KKKKKKKKKK...',
  ],
  Pan: [
    '..........KKKKKK..',
    '........KKDDDDDDKK',
    '.......KDDDDDDDDDK',
    'VVWWWWWKDDDHHDDDDK',
    'VWWWWWWKDDDHDDDDDK',
    '.......KDDDDDDDDDK',
    '........KKDDDDDDKK',
    '..........KKKKKK..',
  ],
  Freeze: [
    '.....NN.......',
    '.....NN.......',
    '...KKKKKK.....',
    '..KCCCCCBK....',
    '.KBBBBBBBKKKK.',
    'KKBBCBBBBGGGNN',
    '.KBBBBBBBKKKK.',
    '..KBBBBBBK....',
    '...KKKKKK.....',
  ],
  // NOTE: the display cases' two: Old Thunder, a long hunting rifle with a
  // brass band, and the Big Blunder, a brass barrel flaring to a bell.
  Rifle: [
    '........KKKKKKKKKKKKKKKKKKKK',
    'VV.....KGHHHHHHHHHHHHHHHHHHK',
    'VWW...KKGGGGGGGGGGGGGGGGGGK.',
    'VWWWWWWWWWWWWYYWWWWWWKKKKK..',
    'VWWWWWKMKWWWWYYWWWWWK.......',
    '.VVWWK.K..VVVVVVVVVK........',
    '...VVV......................',
  ],
  Blunderbuss: [
    '..................KKKK',
    '.................KYJJK',
    'VV.......KKKKKKKKYYYJK',
    'VWW.....KYJJJJJJJJYYJK',
    'VWWWWWWWKYYYYYYYYYYYJK',
    'VWWWWWKMKKKKKKKKKYYYJK',
    '.VVWWK.K.........KYJJK',
    '...VVV............KKKK',
  ],
}

const PEA_COLORS: Palette = { P: '#4f9a32', Q: '#9be36a' }

const GUN_ART: Readonly<Record<WeaponKind, ReadonlyArray<ShopArt>>> =
  Record.map(GUN_PIXELS, pixels =>
    Array.makeBy(GUN_TIER_TRIMS.length, tier =>
      artOf(
        pixels,
        Record.union(trimmed(tier), PEA_COLORS, (_a, b) => b),
      ),
    ),
  )

export const gunArt: {
  (tier: number): (weapon: WeaponKind) => ShopArt
  (weapon: WeaponKind, tier: number): ShopArt
} = Function.dual(
  2,
  (weapon: WeaponKind, tier: number): ShopArt =>
    GUN_ART[weapon][Math.min(tier, GUN_TIER_TRIMS.length - 1)] ??
    artOf(GUN_PIXELS[weapon], GUN_BASE),
)

// GOODS

// NOTE: the Pickled Heart's jar, the shop guide's picture of a found heart.
export const JAR_ART = artOf(
  [
    '..KKKKKKKK..',
    '..KLLLLLLK..',
    '.KKKKKKKKKK.',
    '.KCCCCCCCCK.',
    'KCPPPPPPPPCK',
    'KCPRRPRRPPCK',
    'KCRWRRRRRPCK',
    'KCRRRRRRRPCK',
    'KCPRRRRRPPCK',
    'KCPPRRRPPPCK',
    'KCPPPRPPPPCK',
    'KCPPPPPPPPCK',
    '.KCCCCCCCCK.',
    '..KKKKKKKK..',
  ],
  {
    K: INK,
    L: '#8d96a3',
    C: '#bfe6e0',
    P: '#6fae4a',
    R: '#e8333a',
    W: '#ff8a8f',
  },
)

const PLANK_ART = artOf(
  [
    '..KKKKKKKKKKKK..',
    '.KDDDDDDDDDDDDK.',
    '.KDdDDDNDDDdDDK.',
    'KKKKKKKKKKKKKKKK',
    'KDDDDDDDDDDDDDDK',
    'KDdDDNDDDDDNDDdK',
    'KKKKKKKKKKKKKKKK',
    '.KDDDDDDDDDDDDK.',
    '.KDDdDDNDDDDdDK.',
    '..KKKKKKKKKKKK..',
  ],
  { K: INK, D: '#b8813f', d: '#8a5a2b', N: '#d9dde3' },
)

const GNOME_ART = artOf(
  [
    '.....KK.....',
    '....KRRK....',
    '....KRRK....',
    '...KRRRRK...',
    '...KRRRRK...',
    '..KRRRRRRK..',
    '.KKKKKKKKKK.',
    '.KSKKSSKKSK.',
    '.KSSKSSKSSK.',
    '.KSSSOOSSSK.',
    '.KWWWWWWWWK.',
    'KBWWWWWWWWBK',
    'KBBWWWWWWBBK',
    'KBBBWWWWBBBK',
    '.KKKKKKKKKK.',
  ],
  {
    K: INK,
    R: '#d8423a',
    S: '#f0b48a',
    O: '#e07a6a',
    W: '#f4f1de',
    B: '#3f6fb0',
  },
)

// NOTE: the laser sight: a grey scope with a red lens, and the red dot it
// throws on the floor below.
const SIGHT_ART = artOf(
  [
    '..KKKKKKKKKK..',
    '.KMMMMMMMMMMK.',
    'KMMKKKKKKKKMMK',
    'KMKRRRRRRRRKMK',
    'KMKRLRRRRRRKMK',
    'KMKRRRRRRRRKMK',
    'KMMKKKKKKKKMMK',
    '.KMMMMMMMMMMK.',
    '..KKKKKKKKKK..',
    '......RR......',
    '......RR......',
    '.....RRRR.....',
  ],
  { K: INK, M: '#4a4f5a', R: '#ff3a3f', L: '#ffb3b6' },
)

const ITEM_ART: Readonly<Record<ShopItemId, ShopArt>> = {
  Shotgun: gunArt('Shotgun', 0),
  Smg: gunArt('Smg', 0),
  Pistol: gunArt('Pistol', 0),
  LaserSight: SIGHT_ART,
}

export const itemArt = (id: ShopItemId): ShopArt => ITEM_ART[id]

export const TRAP_ART: Readonly<Record<TrapKind, ShopArt>> = {
  Barricade: PLANK_ART,
  Turret: GNOME_ART,
}

// STATS

const STAT_PALETTE: Palette = { X: '#f4f1de', O: '#8a5a2b' }

export const HIT_ICON = artOf(
  ['X..X..X', '.X.X.X.', '..XXX..', 'XXXXXXX', '..XXX..', '.X.X.X.', 'X..X..X'],
  STAT_PALETTE,
)

export const RATE_ICON = artOf(
  ['X..X...', '.X..X..', '..X..X.', '.X..X..', 'X..X...'],
  STAT_PALETTE,
)

export const LOAD_ICON = artOf(
  ['.X.', 'XXX', 'XXX', 'XXX', 'OOO', 'XXX'],
  STAT_PALETTE,
)

export const SWAP_ICON = artOf(
  [
    '..X......',
    '.XXXXXXX.',
    '..X......',
    '.........',
    '......X..',
    '.XXXXXXX.',
    '......X..',
  ],
  { X: '#ff8a3d' },
)

export const HEART_FULL = artOf(HEART_PIXELS, { R: '#e8333a', W: '#ff8a8f' })

// TABS

export const TAB_ART: Readonly<Record<ShopCategory, ShopArt>> = {
  Guns: gunArt('Pistol', 0),
}

// RATTLES

// NOTE: his portrait is his own sprite from the stall, scaled up by the CSS
// and cropped at his bow tie (see src/art/rattlesArt.ts).
export const RATTLES_ART: Readonly<Record<Mood, ShopArt>> = Record.map(
  MOOD_FACES,
  face =>
    artOf(rattlesPixels(face).slice(0, RATTLES_BUST_ROWS), RATTLES_PALETTE),
)

// NOTE: the Shop tile on the Munchopedia's list wears Rattles' face.
export const SHOP_TILE_ART: ShopArt = RATTLES_ART.Grinning
