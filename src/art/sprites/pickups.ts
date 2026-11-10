import { Record } from 'effect'

import type { PickupKind } from '../../world/schema/entitySchema'
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
      '.KK.KK.',
      'KYYKYYK',
      'KYWYWYK',
      '.KYYYK.',
      '..KYK..',
      '..KyK..',
      '.KyyK..',
      '..KK...',
    ],
    palette: { K: PICKUP_OUTLINE, Y: '#e8b84a', W: '#fff0a8', y: '#a8782a' },
  },
  Damage: {
    pixels: [
      '..KKK..',
      '.KWSSK.',
      '.KSSSK.',
      '.KSSsK.',
      '..KsK..',
      '..KSK..',
      '..KSK..',
      '..KKK..',
    ],
    palette: { K: PICKUP_OUTLINE, W: '#ffffff', S: '#d8e0ee', s: '#8a96aa' },
  },
  Speed: {
    pixels: [
      '.....NN',
      '.....N.',
      'KK..NN.',
      'KBK.NN.',
      'KBBKKK.',
      'KBWBBBK',
      'KBBBBWK',
      'RKKKKKK',
    ],
    palette: {
      K: PICKUP_OUTLINE,
      B: '#3a3446',
      W: '#ffffff',
      R: '#d8423a',
      N: '#ff8ad8',
    },
  },
  Pierce: {
    pixels: [
      '.R...P.',
      '.S.B.S.',
      '.S.S.S.',
      '.KKSKK.',
      'KCCCCCK',
      'KCcCcCK',
      'KCCCCCK',
      '.KKKKK.',
    ],
    palette: {
      K: PICKUP_OUTLINE,
      R: '#ff4a4f',
      P: '#fdfbf4',
      B: '#ffd23f',
      S: '#d8dce6',
      C: '#9a4ac0',
      c: '#6a2a8a',
    },
  },
  Burp: {
    pixels: [
      'DDDDDDD',
      'D.KKK.D',
      'DKYYYKD',
      'DKYWYKD',
      'DKYYYKD',
      'D.KKK.D',
      'D.....D',
      'D.....D',
    ],
    palette: { K: PICKUP_OUTLINE, D: '#8a5a2b', Y: '#f0b040', W: '#fff0a8' },
  },
  Heart: {
    pixels: HEART_PIXELS,
    palette: HEART_PALETTE,
  },
}

// NOTE: each pickup's own color, read off its art: the glow under it on the
// floor, its HUD chip, and the Dinner Gong's ring.
export const PICKUP_TINTS: Readonly<Record<PickupKind, string>> = {
  RapidFire: '#e8b84a',
  Damage: '#d8e0ee',
  Speed: '#ff8ad8',
  Pierce: '#b06ad8',
  Burp: '#f0b040',
  Heart: '#ff5d6c',
}

export const PICKUP_SPRITES: Readonly<Record<PickupKind, Sprite>> = Record.map(
  PICKUP_PIXELS,
  ({ pixels, palette }) => spriteShapes(pixels, palette),
)
