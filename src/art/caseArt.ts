import type { CaseLook } from '#world/feats/caseSpots.ts'
import type { CasePrize, Feat } from '#world/schema/worldSchema.ts'

import { type Palette, type Sprite, TOP_LEFT, spriteShapes } from './sprite.ts'
import { gunIcon } from './sprites/guns.ts'

const INK = '#140c10'

const CASE_PALETTE: Palette = {
  K: INK,
  D: '#4a2a14',
  W: '#7a4a24',
  w: '#a86a34',
  g: '#6aa8c0',
  S: '#d8f4ff',
  Y: '#ffd23f',
  y: '#c98a1a',
  L: '#c9c3b0',
  l: '#8a8a96',
  c: '#9a9488',
  v: '#7fb2c2',
  V: '#a8d4e0',
  r: '#8a2c3c',
  R: '#b04656',
}

export const CASE_WIDTH = 14
export const CASE_HEIGHT = 17

type CaseArt = Readonly<{
  body: Sprite
  front: Sprite
  prizeDropPx: number
}>

const art = (pixels: ReadonlyArray<string>): Sprite =>
  spriteShapes(pixels, CASE_PALETTE, TOP_LEFT)

const RACK: CaseArt = {
  body: art([
    '..DDDDDDDDDD..',
    '.DwwwwwwwwwwD.',
    '.DwWWWWWWWWwD.',
    '.DWKWWWWWWKWD.',
    '.DWKWWWWWWKWD.',
    '.DWWWWWWWWWWD.',
    '.DWWWWWWWWWWD.',
    '.DWKWWWWWWKWD.',
    '.DWKWWWWWWKWD.',
    '.DWWWWWWWWWWD.',
    '.DDDDDDDDDDDD.',
    '..D........D..',
    '..D........D..',
    '..D........D..',
    '..D........D..',
    '.DDD......DDD.',
    '.KKK......KKK.',
  ]),
  front: art([
    '..............',
    '..............',
    '..............',
    '..............',
    '..............',
    '.c.c.c.LL.c.c.',
    '..c.c.cLlLc.c.',
    '.......LLL....',
  ]),
  prizeDropPx: 6,
}

const GLASS: CaseArt = {
  body: art([
    '..............',
    'gggggggggggggg',
    'gVVVVVVVVVVVVg',
    'gvvvvvvvvvvvvg',
    'gvvvvvvvvvvvvg',
    'gvvvvvvvvvvvvg',
    'gvvvvvvvvvvvvg',
    'gvvvvvvvvvvvvg',
    'gvvvvvvvvvvvvg',
    'gggggggggggggg',
    'KwwwwwwwwwwwwK',
    'KWWWWWWWWWWWWK',
    'KWWWWWWWWWWWWK',
    'KWWWWWWWWWWWWK',
    'KDDDDDDDDDDDDK',
    '.K..........K.',
    '.K..........K.',
  ]),
  front: art([
    '..............',
    '..............',
    '..S...........',
    '...S......S...',
    '....S......S..',
    '..............',
    '..............',
    '..........S...',
    '..............',
    '..............',
    '..............',
    '......LL......',
    '.....LllL.....',
    '......LL......',
  ]),
  prizeDropPx: 5,
}

const TROPHY: CaseArt = {
  body: art([
    '.YYYYYYYYYYYY.',
    'YyyyyyyyyyyyyY',
    'YDRRRRRRRRRRDY',
    'YDrrrrrrrrrrDY',
    'YDrrrrrrrrrrDY',
    'YDrrrrrrrrrrDY',
    'YDrrrrrrrrrrDY',
    'YDrrrrrrrrrrDY',
    'YDDDDDDDDDDDDY',
    'YDrrrrrrrrrrDY',
    'YDrrrrrrrrrrDY',
    'YDDDDDDDDDDDDY',
    'YWWWWWWWWWWWWY',
    'YWWWWwwwWWWWWY',
    'YWWWWWWWWWWWWY',
    'yyyyyyyyyyyyyy',
    '.K..........K.',
  ]),
  front: art([
    '..............',
    '..............',
    '..S....g......',
    '...S...g...S..',
    '.......g....S.',
    '.......g......',
    '......LgL.....',
    '.....LllL.....',
    '......LL......',
    '.......g......',
    '..S....g......',
  ]),
  prizeDropPx: 6,
}

export const CASE_ART: Readonly<Record<CaseLook, CaseArt>> = {
  Rack: RACK,
  Glass: GLASS,
  Trophy: TROPHY,
}

const SIGHT_PRIZE: Sprite = spriteShapes(
  ['.KKKKKKK.', 'KccccccRK', 'KcKKKKKrK', 'KccccccRK', '.KKKKKKK.'],
  { K: INK, c: '#9a9aa6', R: '#e0482a', r: '#ff9a7a' },
)

export const PRIZE_SPRITES: Readonly<Record<CasePrize, Sprite>> = {
  Shotgun: gunIcon('Shotgun', 0),
  Smg: gunIcon('Smg', 0),
  Rifle: gunIcon('Rifle', 0),
  Blunderbuss: gunIcon('Blunderbuss', 0),
  LaserSight: SIGHT_PRIZE,
}

export const LOCK_NOTCH: Sprite = spriteShapes(['KYYYK', '.KYK.', '..K..'], {
  K: INK,
  Y: '#ffd23f',
})

export const CARD_ARROW: Sprite = spriteShapes(
  [
    '....K...',
    '....KK..',
    'KKKKKYK.',
    'KYYYYYYK',
    'KKKKKYK.',
    '....KK..',
    '....K...',
  ],
  { K: INK, Y: '#ffd23f' },
)

const ICON_PALETTE: Palette = {
  K: INK,
  W: '#f4f1de',
  R: '#e8333a',
  r: '#ff8a8f',
  Y: '#ffe066',
  O: '#ff9a2a',
  n: '#c9c3b0',
  H: '#5a5a66',
  D: '#4a2a14',
  w: '#a86a34',
  B: '#7a4a24',
  l: '#d9dde3',
  G: '#8d96a3',
  g: '#c9ced6',
}

const icon = (pixels: ReadonlyArray<string>): Sprite =>
  spriteShapes(pixels, ICON_PALETTE)

const SKULL = icon([
  '.WWWWW.',
  'WWWWWWW',
  'WKKWKKW',
  'WKKWKKW',
  'WWWKWWW',
  '.WWWWW.',
  '.W.W.W.',
])

const HEART = icon([
  '.RR.RR.',
  'RrRRRRR',
  'RRRRRRR',
  'RRRRRRR',
  '.RRRRR.',
  '..RRR..',
  '...R...',
])

const BOLT = icon([
  '...YYY.',
  '..YYY..',
  '.YYY...',
  'YYYYYY.',
  '...YYY.',
  '..YY...',
  '.Y.....',
])

const BOMB = icon([
  '....O.Y',
  '...n...',
  '..KKK..',
  '.KKKKK.',
  '.KHKKK.',
  '.KKKKK.',
  '..KKK..',
])

const DOOR = icon([
  '.DDDDD.',
  'DBBBBBD',
  'DBwwwBD',
  'DBBBBYD',
  'DBwwwBD',
  'DBBBBBD',
  'DBBBBBD',
])

const FLAME = icon([
  '...Y...',
  '..YO...',
  '..YOY..',
  '.YORO..',
  '.ORROY.',
  'YORWROY',
  '.ORRRO.',
])

const KEY = icon([
  '.......',
  '.YY....',
  'Y..Y...',
  'Y..YYYY',
  '.YY..Y.',
  '.....Y.',
  '.......',
])

const POT = icon([
  '..lll..',
  '.lllll.',
  'K.....K',
  'GGGGGGG',
  '.GgGGG.',
  '.GGGGG.',
  '..GGG..',
])

export const FEAT_ICONS: Readonly<Record<Feat['_tag'], Sprite>> = {
  Kills: SKULL,
  KillsWith: SKULL,
  KillsOf: SKULL,
  NoHitWave: HEART,
  Streak: BOLT,
  OwnBlast: BOMB,
  OpenedRoom: DOOR,
  LitFire: FLAME,
  KeyFromMarked: KEY,
  KitchenKills: POT,
  KitchenStandKills: POT,
}

export const FEAT_FLAME = FLAME
