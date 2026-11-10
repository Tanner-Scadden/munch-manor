import { Array, Option, Record, String, pipe } from 'effect'

import type { TrapStage } from '../../world/gear/traps'
import type { TrapKind } from '../../world/schema/entitySchema'
import {
  type Palette,
  type Sprite,
  type SpriteSet,
  TRANSPARENT,
  type Tone,
  flashPalette,
  spriteSet,
  spriteShapes,
  spriteWidth,
} from '../sprite'

// TRAPS

export const GNOME_PALETTE: Palette = {
  R: '#d8423a',
  D: '#a8302a',
  S: '#f2c39b',
  K: '#2a1418',
  N: '#ff8a8f',
  W: '#f4f1de',
  B: '#3d7bd9',
  F: '#2a5aa8',
}

export const GNOME_PIXELS: ReadonlyArray<string> = [
  '.....R...',
  '....RR...',
  '...RRR...',
  '..RRRRR..',
  '.DDDDDDD.',
  '..SKSSK..',
  '..SKSSKN.',
  '..WSSSNN.',
  '.WWWWWWW.',
  '.BWWWWWB.',
  '..FBBBF..',
  '..KK.KK..',
]

export const GNOME_HEIGHT = GNOME_PIXELS.length

export const GNOME_SPRITES: SpriteSet = spriteSet(
  GNOME_PALETTE,
  4,
)(GNOME_PIXELS)

const PLANK_PALETTE: Palette = {
  D: '#4f311a',
  P: '#c99a5b',
  L: '#a87a45',
  N: '#d9dde3',
  C: '#21140c',
}

const BARRICADE_PIXELS: Readonly<Record<TrapStage, ReadonlyArray<string>>> = {
  Sturdy: [
    'DDDDDDDDDDDDDDDDDDDDDD..',
    'DPPPPPPPPPPPPPPPPPPPPD..',
    'DLLLLLLLLLLLLLLLLLLLLD..',
    '.DDDDDDDDDDDDDDDDDDDDDD.',
    '.DPPNPPPPPPPPPPPPPPNPPD.',
    '.DLLLLLLLLLLLLLLLLLLLLD.',
    '..DDDDDDDDDDDDDDDDDDDDDD',
    '..DPPPPPPPPPPPPPPPPPPPPD',
    '..DLLLLLLLLLLLLLLLLLLLLD',
    '..DDDDDDDDDDDDDDDDDDDDDD',
  ],
  Cracked: [
    'DDDDDDDDDDDDDD..........',
    'DPPPPPPPPPPPPC..........',
    'DLLLLLLLLLLLCD..........',
    '.DDDDDDDDDDDDDDDDDDDDDD.',
    '.DPPNPPPPCPPPPPPPPPNPPD.',
    '.DLLLLLLLLCLLLLLLLLLLLD.',
    '..DDDDDDDDDDDDDDDDDDDDDD',
    '..DPPPPPPPPPPPPPPPPPPPPD',
    '..DLLLLLLLLLLLLLLLLLLLLD',
    '..DDDDDDDDDDDDDDDDDDDDDD',
  ],
  Splintered: [
    '........................',
    '........................',
    '........................',
    '.DDDDDDDD..........DDDD.',
    '.DPPNPPPC..........CNPD.',
    '.DLLLLLCD..........DCLD.',
    '..DDDDDDDDDDDDDDDDDDDDDD',
    '..DPPPPPPCPPPPPPPCPPPPPD',
    '..DLLLLLLLCLLLLLLCLLLLLD',
    '..DDDDDDDDDDDDDDDDDDDDDD',
  ],
}

export type Lay = 'Across' | 'Upright'

const transposeRows = (pixels: ReadonlyArray<string>): ReadonlyArray<string> =>
  Array.makeBy(spriteWidth(pixels), column =>
    pipe(
      pixels,
      Array.map(row =>
        Option.getOrElse(String.at(row, column), () => TRANSPARENT),
      ),
      Array.join(''),
    ),
  )

const LAID_ROWS: Readonly<
  Record<Lay, (pixels: ReadonlyArray<string>) => ReadonlyArray<string>>
> = {
  Across: pixels => pixels,
  Upright: transposeRows,
}

type ToneSprites = Readonly<Record<Tone, Sprite>>

const toneSprites = (
  pixels: ReadonlyArray<string>,
  palette: Palette,
): ToneSprites => ({
  Normal: spriteShapes(pixels, palette),
  Flash: spriteShapes(pixels, flashPalette(palette)),
})

export const BARRICADE_SPRITES: Readonly<
  Record<Lay, Readonly<Record<TrapStage, ToneSprites>>>
> = Record.map(LAID_ROWS, lay =>
  Record.map(BARRICADE_PIXELS, pixels =>
    toneSprites(lay(pixels), PLANK_PALETTE),
  ),
)

export const TRAP_ICON_PIXELS: Readonly<
  Record<
    TrapKind,
    Readonly<{ pixels: ReadonlyArray<string>; palette: Palette }>
  >
> = {
  Barricade: {
    pixels: ['DDDDDDD', 'DPPNPPD', 'DDDDDDD', 'DPPNPPD', 'DDDDDDD'],
    palette: PLANK_PALETTE,
  },
  Turret: {
    pixels: ['...R...', '..RRR..', '.DDDDD.', '.SKSKS.', '.WWWWW.', '..BBB..'],
    palette: GNOME_PALETTE,
  },
}

export const TRAP_ICONS: Readonly<Record<TrapKind, Sprite>> = Record.map(
  TRAP_ICON_PIXELS,
  ({ pixels, palette }) => spriteShapes(pixels, palette),
)

// TRAP CRATES

// NOTE: the trap crate (src/world/gear/crates.ts), baked once: Shut through
// a wave and before traps are found, Open in a break, its lid leaned up
// behind and the dark inside showing (the find peeks out of it). Both are
// drawn from their bottom middle, where the crate stands.
export type CrateLook = 'Shut' | 'Open'

const CRATE_PIXELS: Readonly<Record<CrateLook, ReadonlyArray<string>>> = {
  Shut: [
    'DDDDDDDDDDDD',
    'DPPPPPPPPPPD',
    'DDDDDDDDDDDD',
    'DLPLLLLLLPLD',
    'DLPLLNLLLPLD',
    'DDDDDDDDDDDD',
    'DLPLLLLLLPLD',
    'DLPLLLLNLPLD',
    'DDDDDDDDDDDD',
  ],
  Open: [
    '.DDDDDDDDDD.',
    '.DPPPPPPPPD.',
    '.DDDDDDDDDD.',
    'DDDDDDDDDDDD',
    'DCCCCCCCCCCD',
    'DDDDDDDDDDDD',
    'DLPLLLLLLPLD',
    'DLPLLLLNLPLD',
    'DDDDDDDDDDDD',
  ],
}

const CRATE_WIDTH = 12

export const CRATE_SPRITES: Readonly<Record<CrateLook, Sprite>> = Record.map(
  CRATE_PIXELS,
  pixels =>
    spriteShapes(pixels, PLANK_PALETTE, {
      x: CRATE_WIDTH / 2,
      y: pixels.length,
    }),
)

// NOTE: how far into the crate the find's icon sits, from its floor up.
export const CRATE_FIND_RISE = 9
