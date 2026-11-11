import { Array, Function, Record, String, pipe } from 'effect'
import type { Option } from 'effect'

import type { BadgeTier } from '../world/heroes/rank'
import {
  type ArtImage,
  type Palette,
  type Sprite,
  spriteImage,
  spriteShapes,
} from './sprite'

// The rank badge and the Bone as pixel art, original to the game (the
// end card's strip in src/features/end/rankStripView.ts, the home menu's and the
// Profile's badge in src/ui/rankBadgeView.ts). Chunky arcade badges: every
// tier has its own silhouette and its own metal, so the tiers read apart at
// a glance, even in grayscale. Each has a dark outline, a bright top-left
// edge, and a shaded bottom-right edge, like the health bars. The ladder is
// a wood tag, a tin bolt plate, a bronze notched shield, a silver gem crest,
// a gold winged shield, and last a skull crest over crossed bones. Built
// once at module scope, with the shine frames baked beside them.

const WOOD = [
  '.OOOOOOOOOOO.',
  'OLLLLLLLLLLDO',
  'OLFFDFKFDFFDO',
  'OLFFDFFFDFFDO',
  'OLFFDFKFDFFDO',
  'OLFFDKKKDFFDO',
  'OLFFDFKFDFFDO',
  'OLFFDFFFDFFDO',
  '.OFFDFKFDFDO.',
  '..OFDFFFDFO..',
  '...ODFFFDO...',
  '....ODFDO....',
  '.....OOO.....',
]

const TIN = [
  '......O......',
  '.....OLO.....',
  '....OLFDO....',
  'OOOOOLFDOOOOO',
  'OLLLLLFFFDDDO',
  '.OLFFFFFFFDO.',
  '..OLFFKFFDO..',
  '...OLFFFDO...',
  '..OLFOOOFDO..',
  '.OLFFO.OFFDO.',
  '.ODDO...ODDO.',
  '.OOO.....OOO.',
  '.............',
]

const BRONZE = [
  '.OOOOO.OOOOO.',
  'OLLLLLOLLLLDO',
  'OLFFFFFFFFFDO',
  'OLFFFFFFFFFDO',
  'OLFDDFFFDDFDO',
  'OLFFDDFDDFFDO',
  'OLFFFDDDFFFDO',
  '.OFFFFDFFFDO.',
  '.OFFFFFFFDDO.',
  '..ODFFFFFDO..',
  '...ODFFFDO...',
  '....ODFDO....',
  '.....OOO.....',
]

const SILVER = [
  '....OOOOO....',
  '..OOLLLLLOO..',
  '.OLLFFFFFFDO.',
  'OLFFFFOFFFFDO',
  'OLFFFOCGOFFDO',
  'OLFFOCCGGOFDO',
  'OLFFFOCGOFFDO',
  'OLFFFFOFFFFDO',
  '.OFFFFFFFFDO.',
  '.ODFFFFFFDDO.',
  '..ODFFFFFDO..',
  '...OODDDOO...',
  '.....OOO.....',
]

const GOLD = [
  '......O......',
  'O....OLO....O',
  'OO..OLFDO..OO',
  'OLOOLFFFDOOLO',
  'OLLOLFYFDOLLO',
  '.OLOLFFFDOLO.',
  '..OOLFFFDOO..',
  '...OLFFFDO...',
  '...ODFFFDO...',
  '....ODFDO....',
  '.....ODO.....',
  '......O......',
  '.............',
]

const SKULL = [
  '.............',
  '.............',
  'OBO.OOOOO.OBO',
  'OBOOGGGGGOOBO',
  'OBOLLWWWWDOBO',
  'OBOWKKWKKDOBO',
  'OBOWKKWKKDOBO',
  'OBOWWWKWWDOBO',
  'OBOOWWWWDOOBO',
  'OBOWOWOWOWOBO',
  'OBO.OOOOO.OBO',
  '.............',
  '.............',
]

const metal = (
  edge: string,
  light: string,
  fill: string,
  shade: string,
  extra: Palette = {},
): Palette => ({ O: edge, L: light, F: fill, D: shade, ...extra })

const TIERS: Readonly<
  Record<
    BadgeTier,
    Readonly<{ pixels: ReadonlyArray<string>; palette: Palette }>
  >
> = {
  Wood: {
    pixels: WOOD,
    palette: metal('#2e1a10', '#d9a46c', '#9a643c', '#62391f', {
      K: '#1a0f08',
    }),
  },
  Tin: {
    pixels: TIN,
    palette: metal('#1c2430', '#eef4fa', '#a4b2c2', '#657386', {
      K: '#2e3846',
    }),
  },
  Bronze: {
    pixels: BRONZE,
    palette: metal('#3e1c0a', '#ffb878', '#d07a36', '#8a4418'),
  },
  Silver: {
    pixels: SILVER,
    palette: metal('#1c2234', '#ffffff', '#d4dcec', '#8c98b4', {
      C: '#a6f4ff',
      G: '#2b8ec0',
    }),
  },
  Gold: {
    pixels: GOLD,
    palette: metal('#4e2e04', '#fff6b0', '#ffd23f', '#c4860e', {
      Y: '#ffffff',
    }),
  },
  Skull: {
    pixels: SKULL,
    palette: metal('#4a2c06', '#ffffff', '#fffbe8', '#b8ad8c', {
      W: '#fffbe8',
      B: '#d2bf86',
      K: '#2a1a10',
      G: '#ffd23f',
    }),
  },
}

// THE SHINE

// NOTE: a glint sweeps over a badge corner to corner: each frame turns the
// lit pixels on three slanted lines of the badge white. The outline and the
// dark details stay, so the shape never changes.
const SHINE_FRAMES = 9
const SHINE_STEP = 3
const SHINE_WIDTH = 1
const UNSHINED = '.OK'

const shinedRows = (
  pixels: ReadonlyArray<string>,
  frame: number,
): ReadonlyArray<string> => {
  const line = frame * SHINE_STEP - 2
  return Array.map(pixels, (row, y) =>
    pipe(
      String.split('')(row),
      Array.map((cell, x) =>
        !String.includes(cell)(UNSHINED) &&
        Math.abs(x + y - line) <= SHINE_WIDTH
          ? 'S'
          : cell,
      ),
      cells => Array.join(cells, ''),
    ),
  )
}

const BADGES: Readonly<Record<BadgeTier, Sprite>> = Record.map(
  TIERS,
  ({ pixels, palette }) => spriteShapes(pixels, palette),
)

const SHINES: Readonly<Record<BadgeTier, ReadonlyArray<Sprite>>> = Record.map(
  TIERS,
  ({ pixels, palette }) =>
    Array.makeBy(SHINE_FRAMES, frame =>
      spriteShapes(shinedRows(pixels, frame), { ...palette, S: '#ffffff' }),
    ),
)

export const badgeSprite = (tier: BadgeTier): Sprite => BADGES[tier]

// NOTE: the badge with the glint at `frame`, 0 to SHINE_FRAMES - 1; before
// and after the sweep, the plain badge.
export const shineSprite: {
  (frame: number): (tier: BadgeTier) => Sprite
  (tier: BadgeTier, frame: number): Sprite
} = Function.dual(
  2,
  (tier: BadgeTier, frame: number): Sprite =>
    SHINES[tier][frame] ?? BADGES[tier],
)

// NOTE: the badge as an image for HTML, which cannot crop the atlas.
export const badgeImage = (tier: BadgeTier): Option.Option<ArtImage> =>
  spriteImage(BADGES[tier])

export const BONE_SIZE = { width: 11, height: 6 }

export const BONE: Sprite = spriteShapes(
  [
    '.OOO...OOO.',
    'OLWWOOOWWWO',
    'OLWWWWWWWDO',
    'OWWWWWWWDDO',
    'ODWWOOOWDDO',
    '.OOO...OOO.',
  ],
  { O: '#2a1408', L: '#ffffff', W: '#f4f1de', D: '#b8ad8c' },
)

export const BONE_IMAGE = spriteImage(BONE)
