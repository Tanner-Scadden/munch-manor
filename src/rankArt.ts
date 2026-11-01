import { Array, Option, pipe } from 'effect'
import type { Canvas } from 'foldkit'

import type { BadgeTier } from './rank'
import {
  type Palette,
  type Sprite,
  spriteShapes,
  standaloneSource,
} from './sprite'

// The rank badge and the Bone as pixel art, original to the game (the
// end card's strip in src/rankStripView.ts, the home menu's and the
// Profile's badge in src/rankBadgeView.ts). Each tier is the same shield in
// the colors of its material, so a glance says how long someone has played;
// past gold the badge is a golden drumstick. Built once at module scope.

const SHIELD = [
  '.OOOOOOOOO.',
  'OLLLLLLLLLO',
  'OLFFFFFFFDO',
  'OLFFFFFFFDO',
  'OLFFFFFFFDO',
  'OLFFFFFFFDO',
  'OLFFFFFFFDO',
  '.OFFFFFFFO.',
  '.ODFFFFFDO.',
  '..ODFFFDO..',
  '...ODFDO...',
  '....OOO....',
]

const DRUMSTICK = [
  '...OOOOO...',
  '..OLLFFFO..',
  '.OLFFFFFDO.',
  '.OFFFFFFDO.',
  '.OFFFFFDDO.',
  '.OFFFFDDDO.',
  '..ODDDDDO..',
  '...ODDDO...',
  '....OFDO...',
  '...OWWWO...',
  '..OWWOWWO..',
  '..OO...OO..',
]

const metal = (
  edge: string,
  light: string,
  fill: string,
  shade: string,
): Palette => ({ O: edge, L: light, F: fill, D: shade })

const PALETTES: Readonly<Record<BadgeTier, Palette>> = {
  Wood: metal('#3a2418', '#b98a58', '#8a5a3a', '#5e3a22'),
  Tin: metal('#2a3038', '#e4ebf2', '#a8b4c0', '#707c88'),
  Bronze: metal('#4a2410', '#f2a868', '#c87a38', '#8a4a1c'),
  Silver: metal('#2a2e3a', '#ffffff', '#d6dce8', '#98a2b8'),
  Gold: metal('#5a3a08', '#fff2a8', '#ffd23f', '#c8921a'),
  Drumstick: {
    ...metal('#5a3a08', '#fff2a8', '#ffd23f', '#c8921a'),
    W: '#f4f1de',
  },
}

const BADGES: Readonly<Record<BadgeTier, Sprite>> = {
  Wood: spriteShapes(SHIELD, PALETTES.Wood),
  Tin: spriteShapes(SHIELD, PALETTES.Tin),
  Bronze: spriteShapes(SHIELD, PALETTES.Bronze),
  Silver: spriteShapes(SHIELD, PALETTES.Silver),
  Gold: spriteShapes(SHIELD, PALETTES.Gold),
  Drumstick: spriteShapes(DRUMSTICK, PALETTES.Drumstick),
}

export const badgeSprite = (tier: BadgeTier): Sprite => BADGES[tier]

type ArtImage = Readonly<{ src: string; width: number; height: number }>

const imageOf = (sprite: Sprite): Option.Option<ArtImage> =>
  pipe(
    Array.head(sprite),
    Option.flatMap((shape: Canvas.Shape) =>
      shape._tag === 'Image'
        ? Option.some({
            src: standaloneSource(shape),
            width: shape.width,
            height: shape.height,
          })
        : Option.none(),
    ),
  )

// NOTE: the badge as an image for HTML, which cannot crop the atlas.
export const badgeImage = (tier: BadgeTier): Option.Option<ArtImage> =>
  imageOf(BADGES[tier])

export const BONE_SIZE = { width: 11, height: 5 }

export const BONE: Sprite = spriteShapes(
  ['.OO.....OO.', 'OWWOOOOOWWO', 'OWWWWWWWWWO', 'OWWDDDDDWWO', '.OO.....OO.'],
  { O: '#3a2a1c', W: '#f4f1de', D: '#bdb59a' },
)

export const BONE_IMAGE = imageOf(BONE)
