import { Record } from 'effect'

import type { PickupKind } from '../model'
import { type Palette, type Sprite, spriteShapes } from '../sprite'
import { HEART_PALETTE, HEART_PIXELS } from './hearts'

// PICKUPS

const PICKUP_OUTLINE = '#2a1418'

const PICKUP_PIXELS: Readonly<
  Record<
    PickupKind,
    Readonly<{ pixels: ReadonlyArray<string>; palette: Palette }>
  >
> = {
  RapidFire: {
    pixels: [
      '...G...',
      '..KGK..',
      '..KWK..',
      '.KRRRK.',
      '.KRWRK.',
      '.KRRRK.',
      '.KRRRK.',
      '..KKK..',
    ],
    palette: { K: PICKUP_OUTLINE, G: '#5fd35a', W: '#fff4d6', R: '#ff4a2e' },
  },
  Damage: {
    pixels: [
      '.KKKKK.',
      'KSSSSSK',
      'KPPPPPK',
      'KPBPBPK',
      'KPPBPPK',
      'KPPPPPK',
      'KSSSSSK',
      '.KKKKK.',
    ],
    palette: { K: PICKUP_OUTLINE, S: '#c9d3c0', P: '#9c4ae0', B: '#ffd23f' },
  },
  Speed: {
    pixels: [
      '..KKKK.',
      '..KWWK.',
      '..KCCK.',
      '..KWWK.',
      '..KCCK.',
      'KKKWWK.',
      'KCCCCK.',
      'KKKKKK.',
    ],
    palette: { K: PICKUP_OUTLINE, W: '#f4f1de', C: '#5fe0ff' },
  },
  Pierce: {
    pixels: [
      '...W...',
      '..RRR..',
      '..RRR..',
      '..GGG..',
      '..GGG..',
      '..YYY..',
      '...L...',
      '...L...',
    ],
    palette: {
      W: '#e8e2d0',
      R: '#ff4a4f',
      G: '#7fd04b',
      Y: '#ffd23f',
      L: '#8a5a2b',
    },
  },
  Burp: {
    pixels: [
      '.W...W.',
      '...W...',
      '.KKKKK.',
      'KLLLLLK',
      'KLDLDLK',
      'KLLLLLK',
      'KLLLLLK',
      '.KKKKK.',
    ],
    palette: { K: PICKUP_OUTLINE, L: '#d6f25c', D: '#4a6a1c', W: '#ffffff' },
  },
  Heart: {
    pixels: HEART_PIXELS,
    palette: HEART_PALETTE,
  },
}

export const PICKUP_SPRITES: Readonly<Record<PickupKind, Sprite>> = Record.map(
  PICKUP_PIXELS,
  ({ pixels, palette }) => spriteShapes(pixels, palette),
)
