import { type Palette, TRANSPARENT } from '../sprite'
import {
  type FramePixels,
  type Patch,
  applyPatches,
  patch,
  wornThrough,
} from './wear'

// BOSS

export const BOSS_PALETTE: Palette = {
  P: '#b49ab0',
  Q: '#86708a',
  W: '#e6dfc0',
  S: '#b9b08c',
  Y: '#c9a83a',
  R: '#d8423a',
  B: '#4a5a8a',
  C: '#36426a',
  K: '#26262e',
  E: '#ffd23f',
  M: '#2a1418',
  T: '#f4f1de',
  D: '#a8262c',
  N: '#5fd35a',
  O: '#ffd23f',
  J: '#f28fb0',
  G: '#c0587a',
  V: '#9be36a',
}

// NOTE: an enraged boss draws as his "lit" frames: flushed red skin and a
// hot yellow stare.
export const BOSS_ENRAGED_PALETTE: Palette = {
  ...BOSS_PALETTE,
  P: '#d9707a',
  Q: '#a8464f',
  E: '#fff27a',
}

export const BOSS_WIDTH = 26

const BOSS_UPPER: ReadonlyArray<string> = [
  '............O.............',
  '...........NON............',
  '..........NONON...........',
  '.........QPPPPPPQ.........',
  '.........PEEPPEEP.........',
  '.........PPPPPPPP.........',
  '.........PMTTTTMP.........',
  '.......QPPMMMMMMPPQ.......',
  '....QPPPPPPPPPPPPPPPPQ....',
  '..QPPPPPWWWWWWWWWWPPPPPQ..',
  '.QPPPPPRWWWWWWWWWWRPPPPPQ.',
  '.PPPP.PRWWWWWWWWWWRP.PPPP.',
  '.PPPP.WRWWWWWWWWWWRW.PPPP.',
  '.PPPPWWRWWWWWWWWWWRWWPPPP.',
  '.PPPPWWRWWWWWWWWWWRWWPPPP.',
  '.PPPPWWRWWWWWWYWWWRWWPPPP.',
  '.PPPPWWRWWWWWMWWWWRWWPPPP.',
  '.PPPPWWRWWWWWWWWWWRWWPPPP.',
  '.PPPPSSRSSSSSSSSSSRSSPPPP.',
  'PPPPP.SRSSSSSSSSSSRS.PPPPP',
  'PPPPP.BBBBBBBBBBBBBB.PPPPP',
  '.QQQ..BBBBBBBBBBBBBB..QQQ.',
]

const BOSS_GAPE_MOUTH: ReadonlyArray<Patch> = [
  patch(10, 5, 'M', 6),
  patch(10, 6, 'M', 6),
  patch(11, 6, 'V', 4),
  patch(12, 7, 'V', 2),
  patch(12, 8, 'V'),
]

export const BOSS_LEGS_PLANTED: ReadonlyArray<string> = [
  '......BBBBBCCCCBBBBB......',
  '......BBBBB....BBBBB......',
  '......BBBBB....BBBBB......',
  '.....KKKKKK....KKKKKK.....',
]

const BOSS_LEGS_LEFT_UP: ReadonlyArray<string> = [
  '......BBBBBCCCCBBBBB......',
  '......BBBBB....BBBBB......',
  '.....KKKKKK....BBBBB......',
  '...............KKKKKK.....',
]

const BOSS_LEGS_RIGHT_UP: ReadonlyArray<string> = [
  '......BBBBBCCCCBBBBB......',
  '......BBBBB....BBBBB......',
  '......BBBBB....KKKKKK.....',
  '.....KKKKKK...............',
]

export const BOSS_WEAR: ReadonlyArray<ReadonlyArray<Patch>> = [
  [patch(0, 11, TRANSPARENT, 5, 11), patch(1, 11, 'D', 3), patch(2, 12, 'D')],
  [patch(9, 0, TRANSPARENT, 7, 3), patch(10, 3, 'J', 6), patch(14, 4, 'D', 2)],
  [
    patch(21, 11, TRANSPARENT, 5, 11),
    patch(22, 11, 'D', 3),
    patch(23, 12, 'D'),
  ],
  [
    patch(11, 13, 'D', 4),
    patch(10, 14, 'D', 6, 4),
    patch(11, 14, 'J', 2),
    patch(13, 14, 'G'),
    patch(10, 15, 'J', 3),
    patch(13, 15, 'J', 2),
    patch(11, 16, 'G'),
    patch(12, 16, 'J', 3),
    patch(12, 17, 'J'),
    patch(12, 18, 'D'),
    patch(14, 18, 'D'),
    patch(12, 19, 'D'),
  ],
]

export const bossPixels = (
  legs: ReadonlyArray<string>,
  stage: number,
  isGaping: boolean,
): ReadonlyArray<string> =>
  applyPatches(
    [...BOSS_UPPER, ...legs],
    [...(isGaping ? BOSS_GAPE_MOUTH : []), ...wornThrough(BOSS_WEAR, stage)],
  )

export const bossWalkPixels = (stage: number): FramePixels => [
  bossPixels(BOSS_LEGS_PLANTED, stage, false),
  bossPixels(BOSS_LEGS_LEFT_UP, stage, false),
  bossPixels(BOSS_LEGS_PLANTED, stage, false),
  bossPixels(BOSS_LEGS_RIGHT_UP, stage, false),
]

export const BOSS_ICON_PIXELS: ReadonlyArray<string> = [
  '...O...',
  '..NON..',
  '.QPPPQ.',
  '.PEPEP.',
  '.PMTMP.',
  'QPPPPPQ',
]
