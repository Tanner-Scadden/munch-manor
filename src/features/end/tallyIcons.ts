import { KEY_SPRITE } from '#art/font.ts'
import { type Sprite, spriteShapes } from '#art/sprite.ts'
import { ZOMBIE_SPRITES } from '#art/sprites/zombies.ts'
import type { CrewAward } from '#world/names.ts'

export type TallyIcon = 'Wave' | 'Time' | 'Kills' | 'Streak' | 'Aim' | 'Keys'

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
  Revive: [
    '.WWWWW.',
    'WWWRWWW',
    'WWWRWWW',
    'WRRRRRW',
    'WWWRWWW',
    'WWWRWWW',
    '.WWWWW.',
  ],
  Down: [
    '.RR.R..',
    'RRRR...',
    'RRRRR..',
    'RRRRRR.',
    '.RRRRR.',
    '..RRR..',
    '...R...',
  ],
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
  Keys: KEY_SPRITE,
}

export const ICON_SHIFT: Readonly<Record<TallyIcon, number>> = {
  Wave: 0,
  Time: 0,
  Kills: 0,
  Streak: 0,
  Aim: 0,
  Keys: 3,
}

export const REVIVE_ICON = sprite(PIXELS.Revive)
export const DOWN_ICON = sprite(PIXELS.Down)
export const CROWN = sprite(PIXELS.Crown)

export const AWARD_ICONS: Readonly<Record<CrewAward, Sprite>> = {
  Mvp: CROWN,
  Medic: REVIVE_ICON,
  Sharpshooter: TALLY_ICONS.Aim,
  KeyKeeper: sprite(PIXELS.Bag),
  MostMunched: DOWN_ICON,
}
