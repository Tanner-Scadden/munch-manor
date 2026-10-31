import { Array, Record, Schema } from 'effect'

import { pixelIconUrl } from './icons'
import {
  FixedShopItemId,
  type ShopCategory,
  type ShopItemId,
  type TrapKind,
  type WeaponKind,
} from './model'
import {
  MOOD_FACES,
  type Mood,
  RATTLES_BUST_ROWS,
  RATTLES_PALETTE,
  rattlesPixels,
} from './shopkeeper'
import type { Palette } from './sprite'
import { HEART_PIXELS } from './sprites/hearts'

// NOTE: the shop's pictures are pixel maps turned into SVG once, at module
// scope, like the HTML buttons' icons. Each keeps its size in pixels so CSS
// can draw it at a whole multiple and the pixels stay square.
export type ShopArt = Readonly<{ url: string; width: number; height: number }>

const artOf = (pixels: ReadonlyArray<string>, palette: Palette): ShopArt => ({
  url: pixelIconUrl(pixels, palette),
  width: Array.reduce(pixels, 0, (widest, row) => Math.max(widest, row.length)),
  height: pixels.length,
})

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
}

const GUN_TRIMS: ReadonlyArray<Palette> = [
  {},
  { H: '#9be3ff' },
  { H: '#ff9df0', M: '#7a3fa0' },
  { G: '#e0a92e', H: '#fff3a0', M: '#a8741a' },
]

const trimmed = (tier: number): Palette =>
  Record.union(
    GUN_BASE,
    GUN_TRIMS[Math.min(tier, GUN_TRIMS.length - 1)] ?? {},
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
}

const PEA_COLORS: Palette = { P: '#4f9a32', Q: '#9be36a' }

const GUN_ART: Readonly<Record<WeaponKind, ReadonlyArray<ShopArt>>> =
  Record.map(GUN_PIXELS, pixels =>
    Array.makeBy(GUN_TRIMS.length, tier =>
      artOf(
        pixels,
        Record.union(trimmed(tier), PEA_COLORS, (_a, b) => b),
      ),
    ),
  )

export const gunArt = (weapon: WeaponKind, tier: number): ShopArt =>
  GUN_ART[weapon][Math.min(tier, GUN_TRIMS.length - 1)] ??
  artOf(GUN_PIXELS[weapon], GUN_BASE)

// GOODS

const SACK_ART = artOf(
  [
    '....RR.RR.....',
    '....RY.RY.RR..',
    '...KKKKKKKKRY.',
    '..KbBBBBBBBKK.',
    '.KbBBBBBBBBBK.',
    '.KbBBbBBbBBBK.',
    '.KbBBBBBBBBBK.',
    '.KbBBBBBBbBBK.',
    '.KbbBBBBBBBBK.',
    '..KbbbbbbbbK..',
    '...KKKKKKKK...',
  ],
  { K: INK, R: '#d8423a', Y: '#e0a92e', B: '#c9a26a', b: '#8a6a3c' },
)

const DRUM_ART = artOf(
  [
    '....KKKK....',
    '..KKGGGGKK..',
    '.KGGHHHHGGK.',
    '.KGHGGGGHGK.',
    'KGHGKKKKGHGK',
    'KGHGKYYKGHGK',
    'KGHGKYYKGHGK',
    'KGHGKKKKGHGK',
    '.KGHGGGGHGK.',
    '.KGGHHHHGGK.',
    '..KKGGGGKK..',
    '....KKKK....',
  ],
  { K: INK, G: '#5a6170', H: '#a9b2bf', Y: '#e0a92e' },
)

const JAR_ART = artOf(
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

const GLUE_ART = artOf(
  [
    '....KK.........',
    '...KOOK........',
    '...KOOK........',
    '..KKKKKK.......',
    '..KWWWWK.KKK...',
    '..KWYYWK..G....',
    '..KWYYWK..G.KKK',
    '..KWWWWK..G..G.',
    '..KWWWWK..G..G.',
    '..KKKKKK.....G.',
  ],
  { K: INK, O: '#ff8a3d', W: '#f4f1de', Y: '#ffd23f', G: '#a9b2bf' },
)

export const UPGRADE_ART = artOf(
  [
    '....K....',
    '...KYK...',
    '..KYYYK..',
    '.KYYYYYK.',
    'KKKYYYKKK',
    '..KYYYK..',
    '..KYYYK..',
    '..KKKKK..',
  ],
  { K: INK, Y: '#ffd23f' },
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

// NOTE: a stack of pot lids, knobs up, for the Cooker's ammo row.
const LID_STACK_ART = artOf(
  [
    '.....KKKK.....',
    '..KKKKHHKKKK..',
    '.KGHHHHHHHHGK.',
    'KKKKKKKKKKKKKK',
    '.KGHHHHHHHHGK.',
    'KKKKKKKKKKKKKK',
    '.KGHHHHHHHHGK.',
    'KKKKKKKKKKKKKK',
  ],
  GUN_BASE,
)

const ITEM_ART: Readonly<Record<FixedShopItemId, ShopArt>> = {
  Shotgun: gunArt('Shotgun', 0),
  ShotgunShells: SACK_ART,
  ShotgunUpgrade: gunArt('Shotgun', 1),
  Smg: gunArt('Smg', 0),
  SmgRounds: DRUM_ART,
  SmgUpgrade: gunArt('Smg', 1),
  Pistol: gunArt('Pistol', 0),
  PistolUpgrade: gunArt('Pistol', 1),
  LaserSight: SIGHT_ART,
  Heart: JAR_ART,
  Barricade: PLANK_ART,
  Turret: GNOME_ART,
  CookerUpgrade: gunArt('Cooker', 1),
  LidStack: LID_STACK_ART,
  PanUpgrade: gunArt('Pan', 1),
}

export const itemArt = (id: ShopItemId): ShopArt =>
  Schema.is(FixedShopItemId)(id) ? ITEM_ART[id] : GLUE_ART

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
export const HEART_EMPTY = artOf(HEART_PIXELS, { R: '#4a2a33', W: '#4a2a33' })

// TABS

export const TAB_ART: Readonly<Record<ShopCategory, ShopArt>> = {
  Guns: gunArt('Pistol', 0),
  Health: HEART_FULL,
  Traps: GNOME_ART,
}

// RATTLES

// NOTE: his portrait is his own sprite from the stall, scaled up by the CSS
// and cropped at his bow tie (see src/shopkeeper.ts).
export const RATTLES_ART: Readonly<Record<Mood, ShopArt>> = Record.map(
  MOOD_FACES,
  face =>
    artOf(rattlesPixels(face).slice(0, RATTLES_BUST_ROWS), RATTLES_PALETTE),
)
