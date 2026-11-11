import { Array, Option, String } from 'effect'

import { type Palette, TRANSPARENT, padRow } from '../sprite'
import {
  type FramePixels,
  type Patch,
  applyPatches,
  firstFrame,
  patch,
  wornThrough,
} from './wear'

// PIXEL MAPS

export const FRENZY_EYE = '#ff2b2b'

// NOTE: the Groaner is a party guest a hundred years late to leave: a
// tattered tailcoat over a white shirt front, a black bow tie, and a dinner
// napkin still tucked in at the collar. The coat's tails flap behind his
// legs as he shambles.
export const ZOMBIE_PALETTE: Palette = {
  G: '#8ed65e',
  F: '#5fa83f',
  R: '#fff3a6',
  M: '#2a1a14',
  T: '#4a4258',
  U: '#332d40',
  W: '#d9d4c4',
  B: '#141018',
  N: '#f7f2e4',
  D: '#8c1f24',
  P: '#2c2a36',
  K: '#f28fb0',
  J: '#c0587a',
}

export const ZOMBIE_SWAY_ROOM = 1
export const ZOMBIE_BODY_WIDTH = 8

const ZOMBIE_UPPER_ARMS_HIGH: ReadonlyArray<string> = [
  '..GGGG....',
  '.GFGGGG...',
  '.GRGGRG...',
  '.GGMMGG...',
  '..GFGG....',
  '.TWBBWTGGG',
  '.TUNNDTT..',
  '.TTNNUTGG.',
]

const ZOMBIE_UPPER_ARMS_LOW: ReadonlyArray<string> = [
  '..GGGG....',
  '.GFGGGG...',
  '.GRGGRG...',
  '.GGMMGG...',
  '..GFGG....',
  '.TWBBWTT..',
  '.TUNNDTGGG',
  '.TTNNUTTGG',
]

const ZOMBIE_LEGS_PLANTED: ReadonlyArray<string> = [
  '.TPP..PP....',
  '..PP..PP....',
]

const ZOMBIE_LEGS_FRONT_DRAG: ReadonlyArray<string> = [
  '..TPP.PP....',
  '...PP..PP...',
]

const ZOMBIE_LEGS_BACK_DRAG: ReadonlyArray<string> = [
  '.TPP.PP.....',
  '.PP..PP.....',
]

const GROANER_SCALP: ReadonlyArray<Patch> = [
  patch(2, 0, 'K', 4),
  patch(2, 1, 'K', 3),
  patch(5, 2, 'M'),
]

export const GROANER_HIGH_WEAR: ReadonlyArray<ReadonlyArray<Patch>> = [
  [patch(8, 5, TRANSPARENT, 2), patch(7, 5, 'D'), patch(7, 6, 'D')],
  GROANER_SCALP,
]

const GROANER_LOW_WEAR: ReadonlyArray<ReadonlyArray<Patch>> = [
  [patch(8, 6, TRANSPARENT, 2), patch(7, 6, 'D'), patch(7, 7, 'D')],
  GROANER_SCALP,
]

const swayRows = (
  rows: ReadonlyArray<string>,
  sway: number,
): ReadonlyArray<string> =>
  Array.map(rows, row =>
    padRow(row, ZOMBIE_SWAY_ROOM + sway, ZOMBIE_SWAY_ROOM - sway),
  )

export const groanerWalkPixels = (stage: number): FramePixels => {
  const high = applyPatches(
    ZOMBIE_UPPER_ARMS_HIGH,
    wornThrough(GROANER_HIGH_WEAR, stage),
  )
  const low = applyPatches(
    ZOMBIE_UPPER_ARMS_LOW,
    wornThrough(GROANER_LOW_WEAR, stage),
  )
  return [
    [...swayRows(high, 0), ...ZOMBIE_LEGS_PLANTED],
    [...swayRows(low, 1), ...ZOMBIE_LEGS_FRONT_DRAG],
    [...swayRows(high, 0), ...ZOMBIE_LEGS_PLANTED],
    [...swayRows(low, -1), ...ZOMBIE_LEGS_BACK_DRAG],
  ]
}

// NOTE: the Hotfoot was the fastest kid in school, dared to run straight
// through the house in 1984: a red sweatband, a gold track singlet with a
// red stripe, blue running shorts, and white tube socks to the shorts.
export const RUNNER_PALETTE: Palette = {
  H: '#3a2418',
  S: '#dcee7a',
  W: '#ffffff',
  M: '#5a1418',
  R: '#e8452e',
  O: '#ffcf3a',
  Q: '#e8452e',
  B: '#2f5fb3',
  T: '#f4f1de',
  K: '#1b1b2a',
  N: '#f28fb0',
  J: '#c0587a',
}

const RUNNER_HEAD: ReadonlyArray<string> = [
  '...HHHH...',
  '..HRRRRH..',
  '...SWSW...',
  '...SSSS...',
  '....SMS...',
]

export const RUNNER_HEAD_WEAR: ReadonlyArray<ReadonlyArray<Patch>> = [
  [patch(3, 0, 'N', 4), patch(3, 1, 'N', 4), patch(5, 2, 'M')],
]

const runnerFramesWith = (head: ReadonlyArray<string>): FramePixels => [
  [
    '.........S',
    ...head,
    '...OOOOSS.',
    '.S.OQOO...',
    '..SOOOO...',
    '...BBBB...',
    '...T..T...',
    '..KK...KK.',
  ],
  [
    ...head,
    '..SOOOOS..',
    '.S.OQOO.S.',
    '...OOOO...',
    '...BBBB...',
    '....TT....',
    '....KK....',
  ],
  [
    'S.........',
    ...head,
    '.SSOOOO...',
    '...OQOO.S.',
    '...OOOOS..',
    '...BBBB...',
    '...T..T...',
    '.KK...KK..',
  ],
  [
    ...head,
    '.SSOOOOSS.',
    '...OQOO...',
    '...OOOO...',
    '...BBBB...',
    '....TT....',
    '...KK.....',
  ],
]

export const runnerWalkPixels = (stage: number): FramePixels =>
  runnerFramesWith(
    applyPatches(RUNNER_HEAD, wornThrough(RUNNER_HEAD_WEAR, stage)),
  )

// NOTE: the Big Lug is a party guest who ate everything, his waistcoat
// burst at the buttons, still wearing the kitchen for armor: a stock pot
// helmet with eye holes, a pot lid on one shoulder, and a cutting board
// strapped to his chest. His wear stages knock the armor off one piece at a
// time, pot lid, cutting board, then stock pot, until only the guest in his
// burst waistcoat is left. The armor is laid over his bare frames, so each
// walk frame keeps its arms and legs. The pieces keep their old part names
// (PotLid, StopSign, Bucket) on the co-op wire.
export const TANK_PALETTE: Palette = {
  G: '#8a9bb5',
  F: '#5f6f8a',
  S: '#2a1a14',
  E: '#ffd23f',
  M: '#5a1418',
  O: '#7a2a3a',
  Y: '#f2c14e',
  W: '#e8e0cc',
  b: '#a9b6cc',
  B: '#141018',
  P: '#2c2a36',
  K: '#26262e',
  D: '#a8262c',
  A: '#c3ccd6',
  a: '#7e8895',
  H: '#59616c',
  L: '#b4bcc6',
  l: '#6c7480',
  n: '#2a2a32',
  R: '#c8955a',
  r: '#9a6a3a',
  C: '#5a3a22',
}

const TANK_HEAD: ReadonlyArray<string> = [
  '..................',
  '..................',
  '.......GGGG.......',
  '......GSGGSG......',
  '......GEGGEG......',
  '......GGMMGG......',
  '.......GDGG.......',
  '.....GGWBBWGG.....',
]

const TANK_ARMS_LOW: ReadonlyArray<string> = [
  '....GG.OWWO.GG....',
  '....G..YbbO..G....',
  '....G..ObDb..G....',
  '....G..YbbO..G....',
  '...FF..OOOO..FF...',
  '...FF..PPPP..FF...',
]

const TANK_ARMS_SWING: ReadonlyArray<string> = [
  '....GG.OWWO.GG....',
  '....G..YbbO..G....',
  '...FF..ObDb..G....',
  '...FF..YbbO..G....',
  '.......OOOO..FF...',
  '.......PPPP..FF...',
]

const TANK_ARMS_SWING_BACK: ReadonlyArray<string> = [
  '....GG.OWWO.GG....',
  '....G..YbbO..G....',
  '....G..ObDb..FF...',
  '....G..YbbO..FF...',
  '...FF..OOOO.......',
  '...FF..PPPP.......',
]

const TANK_LEGS_PLANTED: ReadonlyArray<string> = [
  '.......PPPP.......',
  '......PP..PP......',
  '......PP..PP......',
  '......PP..PP......',
  '.....KKK..KKK.....',
]

const TANK_LEGS_LEFT_UP: ReadonlyArray<string> = [
  '.......PPPP.......',
  '......PP..PP......',
  '......PP..PP......',
  '.....KKK..PP......',
  '..........KKK.....',
]

const TANK_LEGS_RIGHT_UP: ReadonlyArray<string> = [
  '.......PPPP.......',
  '......PP..PP......',
  '......PP..PP......',
  '......PP..KKK.....',
  '.....KKK..........',
]

const TANK_STOP_SIGN: ReadonlyArray<string> = [
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '....nRRRRRRRRn....',
  '....RrRRRRRRRR....',
  '....RRRRrrRRRR....',
  '....RRRRRRRRrR....',
  '....RRrRRRRRRR....',
  '....CRRRRRRRRC....',
]

const TANK_POT_LID: ReadonlyArray<string> = [
  '',
  '',
  '',
  '',
  '',
  '...n..............',
  '.lLLLLl...........',
  'lLLLLLLLl.........',
  '.lllllll..........',
]

const TANK_BUCKET: ReadonlyArray<string> = [
  '.....aAAAAAAa.....',
  '...naAAAAAAAAan...',
  '....aAAAAAAAAa....',
  '....aAEaAAaEAa....',
  '...HHHHHHHHHHHH...',
]

export const TANK_ARMOR: ReadonlyArray<ReadonlyArray<string>> = [
  TANK_POT_LID,
  TANK_STOP_SIGN,
  TANK_BUCKET,
]

const overlayRows = (
  rows: ReadonlyArray<string>,
  cover: ReadonlyArray<string>,
): ReadonlyArray<string> =>
  Array.map(rows, (row, y) =>
    Option.match(Array.get(cover, y), {
      onNone: () => row,
      onSome: coverRow =>
        Array.join(
          Array.map(Array.fromIterable(row), (pixel, x) => {
            const top = Option.getOrElse(
              String.charAt(coverRow, x),
              () => TRANSPARENT,
            )
            return top === TRANSPARENT ? pixel : top
          }),
          '',
        ),
    }),
  )

const armored = (
  rows: ReadonlyArray<string>,
  stage: number,
): ReadonlyArray<string> =>
  Array.reduce(Array.reverse(Array.drop(TANK_ARMOR, stage)), rows, overlayRows)

export const tankWalkPixels = (stage: number): FramePixels => [
  armored([...TANK_HEAD, ...TANK_ARMS_LOW, ...TANK_LEGS_PLANTED], stage),
  armored([...TANK_HEAD, ...TANK_ARMS_SWING, ...TANK_LEGS_LEFT_UP], stage),
  armored([...TANK_HEAD, ...TANK_ARMS_LOW, ...TANK_LEGS_PLANTED], stage),
  armored(
    [...TANK_HEAD, ...TANK_ARMS_SWING_BACK, ...TANK_LEGS_RIGHT_UP],
    stage,
  ),
]

// NOTE: the Kaboomer is the kid who brought fireworks to scare everyone: a
// grinning zombie kid in a striped tee with a big round firework shell
// strapped on his back like a backpack, its fuse in the cap on top. The fuse
// and its sparks are drawn over the sprite each frame in zombieView.ts, since
// they shorten as he closes in. His lit frames turn the shell red-hot for the
// last moments before it goes off.
export const EXPLODER_PALETTE: Palette = {
  G: '#c4f08a',
  g: '#8cc85e',
  W: '#fffbe6',
  E: '#1a1014',
  T: '#fff3c8',
  M: '#5a1a20',
  U: '#d26a3c',
  u: '#f2d45a',
  K: '#3e3c56',
  k: '#1e1c2a',
  h: '#b4b2d4',
  y: '#ffd23f',
  L: '#4a3a5a',
  F: '#2a2026',
  R: '#a8262c',
  c: '#8a8698',
  O: '#ff9d2e',
  S: '#3a3430',
}

export const EXPLODER_LIT_PALETTE: Palette = {
  ...EXPLODER_PALETTE,
  K: '#c8323a',
  k: '#ff6a4a',
  h: '#ffb0a0',
}

const EXPLODER_BODY: ReadonlyArray<string> = [
  '.......gGGGg.',
  '......gGGGGGg',
  '..cc..gWEGWEg',
  '.kKKk.gWEGWEg',
  'kKhKKkgGGGGGg',
  'khKKKkgGMTMGg',
  'kKKKKk.gMMMg.',
  'kKKKKkUUUUUGg',
  '.kKKk.uuuuuGg',
  '......UUUUU..',
]

export const EXPLODER_WEAR: ReadonlyArray<ReadonlyArray<Patch>> = [
  [
    patch(11, 7, TRANSPARENT, 2, 2),
    patch(10, 7, 'R'),
    patch(10, 8, 'R'),
    patch(6, 9, 'R', 2),
  ],
  [
    patch(3, 4, 'c'),
    patch(2, 5, 'O'),
    patch(3, 6, 'c'),
    patch(8, 0, 'S', 3),
    patch(7, 1, 'S', 2),
    patch(11, 5, 'M'),
  ],
]

export const exploderWalkPixels = (stage: number): FramePixels => {
  const body = applyPatches(EXPLODER_BODY, wornThrough(EXPLODER_WEAR, stage))
  return [
    [...swayRows(body, 0), '......LL..LL...', '.....FFF..FFF..'],
    [...swayRows(body, 1), '.......LL..LL..', '......FFF..FFF.'],
    [...swayRows(body, 0), '......LL..LL...', '.....FFF..FFF..'],
    [...swayRows(body, -1), '.....LL..LL....', '....FFF..FFF...'],
  ]
}

export const EXPLODER_FUSE_BASE = { x: 2, y: 1 }

// BIG LEAGUER

// NOTE: the Big Leaguer is the jock who took the dare to prove a point: a
// lanky zombie in a blue letterman jacket with cream ribbing and a big gold
// letter, jeans, and a red cap on backwards. His long arms drag his knuckles along the floor. His
// wind-up holds a Groaner overhead with a high leg kick, and after a throw he
// pumps his fist.
export const CHUCKER_PALETTE: Palette = {
  C: '#80dcb4',
  c: '#4fae8c',
  E: '#fff3a6',
  M: '#2a1418',
  T: '#fff3c8',
  R: '#d8463e',
  r: '#9a2a26',
  S: '#2f4fa8',
  s: '#22387a',
  b: '#f2ecd8',
  B: '#f2ecd8',
  n: '#ffd23f',
  P: '#4a5a80',
  W: '#2a3450',
  K: '#26262e',
  D: '#a8262c',
}

const CHUCKER_HEAD: ReadonlyArray<string> = [
  '....RRRR....',
  '.rrrRRRRRR..',
  '...cCCCCCc..',
  '...CCECCEC..',
  '...CCCMMTC..',
  '....cCCCc...',
]

const CHUCKER_FRAMES: Array.NonEmptyReadonlyArray<ReadonlyArray<string>> = [
  [
    ...CHUCKER_HEAD,
    '..cBSSSSBc..',
    '.cCnnSbSSCc.',
    '.CCnnSbSSCC.',
    '.CCSSSbSSCC.',
    '.C.BsBsBs.C.',
    '.C..PPPP..C.',
    '.C..PPPP..C.',
    'cCc.P..P.cCc',
    'cCc.P..P.cCc',
    '....W..W....',
    '...KK..KK...',
  ],
  [
    ...CHUCKER_HEAD,
    '..cBSSSSBc..',
    '.cCnnSbSSCc.',
    '.CCnnSbSSCC.',
    '.CCSSSbSS.C.',
    '.C.BsBsBs.C.',
    'cCc.PPPP..C.',
    'cCc.PPPP..C.',
    '....P..P..C.',
    '...PP...PcCc',
    '...W....WcCc',
    '..KK....KK..',
  ],
  [
    ...CHUCKER_HEAD,
    '..cBSSSSBc..',
    '.cCnnSbSSCc.',
    '.CCnnSbSSCC.',
    '.CCSSSbSSCC.',
    '.C.BsBsBs.C.',
    '.C..PPPP..C.',
    '.C..PPPP..C.',
    'cCc.P..P.cCc',
    'cCc.P..P.cCc',
    '....W..W....',
    '...KK..KK...',
  ],
  [
    ...CHUCKER_HEAD,
    '..cBSSSSBc..',
    '.cCnnSbSSCc.',
    '.CCnnSbSSCC.',
    '.C.SSSbSSCC.',
    '.C.BsBsBs.C.',
    '.C..PPPP.cCc',
    '.C..PPPP.cCc',
    '.C..P..P....',
    'cCc.P...PP..',
    'cCc.W....W..',
    '...KK....KK.',
  ],
]

const CHUCKER_HEFT: ReadonlyArray<string> = [
  'cCc......cCc',
  '.C..RRRR..C.',
  'rrrRRRRRRrC.',
  '.C.cCCCCCcC.',
  '.CCCCECCECC.',
  '...CCCMMMC..',
  '....cCCCc...',
  '...BSSSSB...',
  '...nnSbSS...',
  '...nnSbSS...',
  '...SSSbSS...',
  '...BsBsBsPP.',
  '...PPPPPPP..',
  '...PP...WK..',
  '...PP.......',
  '...WW.......',
  '..KK........',
]

const CHUCKER_TAUNT: ReadonlyArray<string> = [
  '....RRRR.cCc',
  '.rrrRRRRRRC.',
  '...cCCCCCcC.',
  '...CCECCECC.',
  '...CCMMMTC..',
  '....cCCCcC..',
  '..cBSSSSBC..',
  '.cCnnSbSS...',
  '.CCnnSbSS...',
  '.CCSSSbSS...',
  '.C.BsBsBs...',
  '.C..PPPP....',
  '.C..PPPP....',
  'cCc.P..P....',
  'cCc.P..P....',
  '....W..W....',
  '...KK..KK...',
]

const CAP_OFF: ReadonlyArray<Patch> = [
  patch(2, 0, TRANSPARENT, 8),
  patch(4, 0, 'c', 4),
  patch(1, 1, TRANSPARENT, 3),
  patch(4, 1, 'C', 5),
  patch(9, 1, 'c'),
  patch(6, 1, 'D'),
]

const LIMP_ARM: ReadonlyArray<Patch> = [
  patch(9, 7, TRANSPARENT, 1, 7),
  patch(10, 7, TRANSPARENT, 2, 9),
  patch(9, 6, 'D'),
  patch(10, 7, 'c', 1, 8),
  patch(10, 15, 'C'),
]

export const CHUCKER_WALK_WEAR: ReadonlyArray<ReadonlyArray<Patch>> = [
  CAP_OFF,
  LIMP_ARM,
]

const CHUCKER_HEFT_WEAR: ReadonlyArray<ReadonlyArray<Patch>> = [
  [
    patch(4, 1, 'c', 4),
    patch(0, 2, TRANSPARENT, 1),
    patch(1, 2, 'C'),
    patch(2, 2, TRANSPARENT, 2),
    patch(4, 2, 'C', 5),
    patch(9, 2, 'c'),
    patch(6, 2, 'D'),
  ],
  [
    patch(9, 0, TRANSPARENT, 3),
    patch(10, 1, TRANSPARENT, 2, 4),
    patch(9, 7, 'D'),
    patch(9, 8, 'c', 1, 4),
    patch(9, 12, 'C'),
  ],
]

const CHUCKER_TAUNT_WEAR: ReadonlyArray<ReadonlyArray<Patch>> = [
  [
    patch(4, 0, 'c', 4),
    patch(1, 1, TRANSPARENT, 3),
    patch(4, 1, 'C', 5),
    patch(9, 1, 'c'),
    patch(6, 1, 'D'),
  ],
]

export const chuckerWalkPixels = (stage: number): FramePixels =>
  Array.map(CHUCKER_FRAMES, frame =>
    applyPatches(frame, wornThrough(CHUCKER_WALK_WEAR, stage)),
  )

export const chuckerHeftPixels = (stage: number): ReadonlyArray<string> =>
  applyPatches(CHUCKER_HEFT, wornThrough(CHUCKER_HEFT_WEAR, stage))

// NOTE: with his throwing arm hanging limp he cannot pump his fist, so his
// taunt is just his standing frame.
export const chuckerTauntPixels = (stage: number): ReadonlyArray<string> =>
  stage >= CHUCKER_WALK_WEAR.length
    ? firstFrame(stage, chuckerWalkPixels)
    : applyPatches(CHUCKER_TAUNT, wornThrough(CHUCKER_TAUNT_WEAR, stage))

// ANKLE BITER

// NOTE: a zombie spider seen from above, facing right: a rotting abdomen
// with a bone skull on its back, four sick yellow eyes, red fangs, lime ooze
// dripping off it, and eight legs that skitter between the walk frames.
export const CRAWLER_PALETTE: Palette = {
  b: '#2c4423',
  g: '#6c9a47',
  G: '#a3d46b',
  s: '#ebe4c2',
  B: '#1c1418',
  h: '#4f6340',
  H: '#6b8256',
  E: '#eaff4d',
  k: '#241b27',
  j: '#6a5274',
  w: '#f4efd8',
  M: '#b0262c',
  o: '#b8ff3a',
  N: '#f28fb0',
  J: '#c0587a',
}

const CRAWLER_BODY_TOP = '..bbbbbkHHk.....'
const CRAWLER_BODY: ReadonlyArray<string> = [
  '.bGgsssbhEhEw...',
  'bgggBsBbhhhhM...',
  '.bgNsssbhEhEw...',
]
const CRAWLER_BODY_BOTTOM = '..bbobbkhhk.....'

const crawlerFrame = (
  top: ReadonlyArray<string>,
  bottom: ReadonlyArray<string>,
): ReadonlyArray<string> => [
  ...top,
  CRAWLER_BODY_TOP,
  ...CRAWLER_BODY,
  CRAWLER_BODY_BOTTOM,
  ...bottom,
]

const CRAWLER_LEGS_MID: ReadonlyArray<string> = [
  '...kk...kk......',
  '..k..k.k..k..kk.',
  '.k...jkj..jkk..k',
]

const CRAWLER_LEGS_FORWARD: ReadonlyArray<string> = [
  '....kk...kk.....',
  '...k..k.k..k.kk.',
  '..k...jkj..jkk.k',
]

const CRAWLER_LEGS_BACK: ReadonlyArray<string> = [
  '..kk...kk.......',
  '.k..k.k..k..kk..',
  'k...jkj..jkk..k.',
]

const CRAWLER_FRAMES: Array.NonEmptyReadonlyArray<ReadonlyArray<string>> = [
  crawlerFrame(CRAWLER_LEGS_MID, [
    '.k...jkj..jkk..k',
    '..k.o.k.k..k.kk.',
    '...kk...kk......',
  ]),
  crawlerFrame(CRAWLER_LEGS_FORWARD, [
    '..k...jkj..jkk.k',
    '...k..k.k..k.kk.',
    '....kk...kk.....',
  ]),
  crawlerFrame(CRAWLER_LEGS_MID, [
    '.k...jkj..jkk..k',
    '..k...k.k..k.kk.',
    '...kko..kk......',
  ]),
  crawlerFrame(CRAWLER_LEGS_BACK, [
    'k...jkj..jkk..k.',
    '.k..ok.k..k.kk..',
    '..kk...kk.......',
  ]),
]

// NOTE: hurt, the skull on its back cracks open in a pink gash.
export const CRAWLER_WEAR: ReadonlyArray<ReadonlyArray<Patch>> = [
  [patch(3, 4, 'N'), patch(4, 4, 'J'), patch(4, 5, 'M'), patch(3, 6, 'J')],
]

export const crawlerWalkPixels = (stage: number): FramePixels =>
  Array.map(CRAWLER_FRAMES, frame =>
    applyPatches(frame, wornThrough(CRAWLER_WEAR, stage)),
  )

export const SHAMBLER_ICON_PIXELS: ReadonlyArray<string> = [
  '.GGGGG.',
  'GFGGGGG',
  'GRGGGRG',
  'GGGMMGG',
  '.GFGGG.',
  '.TWBWT.',
]

export const RUNNER_ICON_PIXELS: ReadonlyArray<string> = [
  '.HHHHH.',
  'HRRRRRH',
  'SWSSSWS',
  'SSSMSSS',
  '.SSSSS.',
  '.OQOQO.',
]

export const TANK_ICON_PIXELS: ReadonlyArray<string> = [
  '.aAAAa.',
  'aAAAAAa',
  'aEaAaEa',
  'HHHHHHH',
  'lLGMMRR',
  'LLlRrrR',
]

export const EXPLODER_ICON_PIXELS: ReadonlyArray<string> = [
  '....TyO',
  '..ccT..',
  '.kKKKk.',
  'kKhKKKk',
  'kKKKKKk',
  '.kKKKk.',
]

export const CHUCKER_ICON_PIXELS: ReadonlyArray<string> = [
  '..RRRR.',
  'rrRRRRR',
  '.CECCE.',
  '.CCMMC.',
  '.BnSbB.',
  'CnSbSSC',
]

export const CRAWLER_ICON_PIXELS: ReadonlyArray<string> = [
  'k..k.k.',
  '.kbbkhk',
  'bsBshEE',
  'bgsbhhM',
  '.kbbkhk',
  'k..k.k.',
]
