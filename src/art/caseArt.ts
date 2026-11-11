import type { CaseLook } from '../world/feats/caseSpots'
import type { CasePrize, Feat } from '../world/schema/worldSchema'
import { type Palette, type Sprite, TOP_LEFT, spriteShapes } from './sprite'
import { gunIcon } from './sprites/guns'

// The display cases' pixel art (src/world/feats/cases.ts): a gun rack on the
// wall, a glass display case, and a trophy cabinet, each a body drawn behind
// its prize and a front of glass glints and a padlock drawn over it while
// it is locked; the Laser Sight as a prize; and the feats' icons that hang
// on each lock (src/world/feats/feats.ts). Show, don't explain: a skull, a
// heart, a bolt, a bomb, a door, a flame, a key, a crate, or a pot says what
// a feat asks.

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
  // NOTE: the lit backs the prize stands against, light enough that a gun's
  // dark outline reads behind the glass (owner's playtest, 2026-11-10).
  v: '#7fb2c2',
  V: '#a8d4e0',
  r: '#8a2c3c',
  R: '#b04656',
}

// NOTE: every case is 14 by 17 pixels, drawn from its top left corner, its
// foot on the floor tile's bottom edge.
export const CASE_WIDTH = 14
export const CASE_HEIGHT = 17

type CaseArt = Readonly<{
  body: Sprite
  front: Sprite
  prizeDropPx: number
}>

const art = (pixels: ReadonlyArray<string>): Sprite =>
  spriteShapes(pixels, CASE_PALETTE, TOP_LEFT)

// NOTE: a board on two posts with pegs the prize rests on; locked, a chain
// runs across it to a padlock.
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

// NOTE: a glass box on a wooden stand, lit inside, a padlock on the stand's
// front.
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

// NOTE: a tall cabinet trimmed in gold, a shelf of red velvet behind two
// glass doors.
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

// NOTE: the Laser Sight as a prize: a grey scope with a red lens.
const SIGHT_PRIZE: Sprite = spriteShapes(
  ['.KKKKKKK.', 'KccccccRK', 'KcKKKKKrK', 'KccccccRK', '.KKKKKKK.'],
  { K: INK, c: '#9a9aa6', R: '#e0482a', r: '#ff9a7a' },
)

// NOTE: what each case's prize looks like behind its glass, and on the
// display case card (src/features/onboarding/caseCardView.ts).
export const PRIZE_SPRITES: Readonly<Record<CasePrize, Sprite>> = {
  Shotgun: gunIcon('Shotgun', 0),
  Smg: gunIcon('Smg', 0),
  Rifle: gunIcon('Rifle', 0),
  Blunderbuss: gunIcon('Blunderbuss', 0),
  LaserSight: SIGHT_PRIZE,
}

// NOTE: the notch under a case's lock that points down at the case, so the
// lock reads as the case's own tag.
export const LOCK_NOTCH: Sprite = spriteShapes(['KYYYK', '.KYK.', '..K..'], {
  K: INK,
  Y: '#ffd23f',
})

// NOTE: the arrow on the display case card from the feat to the case: do
// this, win that.
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

// FEAT ICONS

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

// NOTE: the icon for a feat that names no gun or zombie; KillsWith and
// KillsOf show the gun's or the zombie's own icon (src/render/featLockView.ts).
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
