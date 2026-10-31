import { COIN_SPRITE } from './font'
import type { CrewAward } from './names'
import { type Sprite, spriteShapes } from './sprite'
import { ZOMBIE_SPRITES } from './sprites/zombies'

// The end card's pixel icons: the solo tally's rows (src/endView.ts), and
// the crew board's rows and award badges (src/crewBoardView.ts). Built once
// at module scope.

export type TallyIcon = 'Wave' | 'Time' | 'Kills' | 'Streak' | 'Aim' | 'Cash'

const PALETTE = {
  X: '#8a5a3a',
  O: '#3a2418',
  Y: '#ffd23f',
  D: '#a87a1e',
  W: '#f4f1de',
  R: '#ff4a4f',
  F: '#ffa04d',
  K: '#140c10',
  G: '#9be36a',
  B: '#7a4a24',
  P: '#c98a1a',
}

const PIXELS = {
  Wave: [
    '.XXXXX.',
    'XOOOOOX',
    'XOOOOOX',
    'XOOOYOX',
    'XOOOOOX',
    'XOOOOOX',
    'XXXXXXX',
  ],
  Time: [
    '.WWWWW.',
    'WKKWKKW',
    'WKKWKKW',
    'WKKWWWW',
    'WKKKKKW',
    'WKKKKKW',
    '.WWWWW.',
  ],
  Streak: [
    '...R...',
    '..RR...',
    '.RRFR..',
    '.RFFRR.',
    'RRFYFRR',
    'RFYYYFR',
    '.RFYFR.',
  ],
  Aim: [
    '...R...',
    '.RRRRR.',
    '.R...R.',
    'RR.R.RR',
    '.R...R.',
    '.RRRRR.',
    '...R...',
  ],
  // NOTE: a teammate picked up off the floor: a first aid cross.
  Revive: [
    '.WWWWW.',
    'WWWRWWW',
    'WWWRWWW',
    'WRRRRRW',
    'WWWRWWW',
    'WWWRWWW',
    '.WWWWW.',
  ],
  // NOTE: going down: a heart with a bite out of it.
  Down: [
    '.RR.R..',
    'RRRR...',
    'RRRRR..',
    'RRRRRR.',
    '.RRRRR.',
    '..RRR..',
    '...R...',
  ],
  // NOTE: Big Spender's money bag.
  Bag: [
    '..BBB..',
    '...B...',
    '.PPPPP.',
    'PPYYYPP',
    'PPYPPPP',
    'PPPYYPP',
    '.PPPPP.',
  ],
  Crown: ['Y..Y..Y', 'YY.Y.YY', 'YYYYYYY', 'YDYDYDY'],
}

const sprite = (pixels: ReadonlyArray<string>): Sprite =>
  spriteShapes(pixels, PALETTE)

export const TALLY_ICONS: Readonly<Record<TallyIcon, Sprite>> = {
  Wave: sprite(PIXELS.Wave),
  Time: sprite(PIXELS.Time),
  Streak: sprite(PIXELS.Streak),
  Aim: sprite(PIXELS.Aim),
  Kills: ZOMBIE_SPRITES.Shambler.icon,
  Cash: COIN_SPRITE,
}

// NOTE: the coin is drawn from its top left, the rest from their middle.
export const ICON_SHIFT: Readonly<Record<TallyIcon, number>> = {
  Wave: 0,
  Time: 0,
  Kills: 0,
  Streak: 0,
  Aim: 0,
  Cash: 3,
}

export const REVIVE_ICON = sprite(PIXELS.Revive)
export const DOWN_ICON = sprite(PIXELS.Down)
export const CROWN = sprite(PIXELS.Crown)

// NOTE: each award's badge, the icon of the row it was won on, so a title
// reads at a glance. Big Spender's bag is its own: the board shows money
// earned, and the bag is money spent.
export const AWARD_ICONS: Readonly<Record<CrewAward, Sprite>> = {
  Mvp: CROWN,
  Medic: REVIVE_ICON,
  Sharpshooter: TALLY_ICONS.Aim,
  BigSpender: sprite(PIXELS.Bag),
  MostMunched: DOWN_ICON,
}
