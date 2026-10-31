import { Array, Option } from 'effect'

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

export const ZOMBIE_PALETTE: Palette = {
  G: '#8ed65e',
  F: '#5fa83f',
  R: '#fff3a6',
  M: '#2a1a14',
  T: '#7a5a8c',
  U: '#5b4170',
  D: '#8c1f24',
  P: '#3b3a46',
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
  '.TTTTTTGGG',
  '.TUTTDTT..',
  '.TTTUTTGG.',
]

const ZOMBIE_UPPER_ARMS_LOW: ReadonlyArray<string> = [
  '..GGGG....',
  '.GFGGGG...',
  '.GRGGRG...',
  '.GGMMGG...',
  '..GFGG....',
  '.TTTTTTT..',
  '.TUTTDTGGG',
  '.TTTUTTTGG',
]

const ZOMBIE_LEGS_PLANTED: ReadonlyArray<string> = [
  '..PP..PP....',
  '..PP..PP....',
]

const ZOMBIE_LEGS_FRONT_DRAG: ReadonlyArray<string> = [
  '...PP.PP....',
  '...PP..PP...',
]

const ZOMBIE_LEGS_BACK_DRAG: ReadonlyArray<string> = [
  '..PP.PP.....',
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

export const RUNNER_PALETTE: Palette = {
  H: '#3a2418',
  S: '#dcee7a',
  W: '#ffffff',
  M: '#5a1418',
  O: '#ff7a2e',
  Q: '#ffe066',
  B: '#2f5fb3',
  K: '#1b1b2a',
  N: '#f28fb0',
  J: '#c0587a',
}

const RUNNER_HEAD: ReadonlyArray<string> = [
  '...HHHH...',
  '..HSSSSH..',
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
    '...S..S...',
    '..KK...KK.',
  ],
  [
    ...head,
    '..SOOOOS..',
    '.S.OQOO.S.',
    '...OOOO...',
    '...BBBB...',
    '....SS....',
    '....KK....',
  ],
  [
    'S.........',
    ...head,
    '.SSOOOO...',
    '...OQOO.S.',
    '...OOOOS..',
    '...BBBB...',
    '...S..S...',
    '.KK...KK..',
  ],
  [
    ...head,
    '.SSOOOOSS.',
    '...OQOO...',
    '...OOOO...',
    '...BBBB...',
    '....SS....',
    '...KK.....',
  ],
]

export const runnerWalkPixels = (stage: number): FramePixels =>
  runnerFramesWith(
    applyPatches(RUNNER_HEAD, wornThrough(RUNNER_HEAD_WEAR, stage)),
  )

// NOTE: the Big Lug is a scrawny zombie in junk armor: a bucket helmet with
// eye holes, a pot lid on one shoulder, and a stop sign chained to his chest.
// His wear stages knock the armor off one piece at a time, pot lid, stop
// sign, then bucket, until only the bony zombie underneath is left. The
// armor is laid over his bare frames, so each walk frame keeps its arms and
// legs.
export const TANK_PALETTE: Palette = {
  G: '#8a9bb5',
  F: '#5f6f8a',
  S: '#2a1a14',
  E: '#ffd23f',
  M: '#5a1418',
  O: '#8a5a2b',
  Y: '#f2c14e',
  P: '#5c3a1a',
  K: '#26262e',
  D: '#a8262c',
  A: '#c3ccd6',
  a: '#7e8895',
  H: '#59616c',
  L: '#b4bcc6',
  l: '#6c7480',
  n: '#2a2a32',
  R: '#d43c3a',
  W: '#f4f1de',
  C: '#9aa3ad',
}

const TANK_HEAD: ReadonlyArray<string> = [
  '..................',
  '..................',
  '.......GGGG.......',
  '......GSGGSG......',
  '......GEGGEG......',
  '......GGMMGG......',
  '.......GDGG.......',
  '.....GGGGGGGG.....',
]

const TANK_ARMS_LOW: ReadonlyArray<string> = [
  '....GG.OOOO.GG....',
  '....G..OYOO..G....',
  '....G..OODO..G....',
  '....G..OOOO..G....',
  '...FF..OOOO..FF...',
  '...FF..PPPP..FF...',
]

const TANK_ARMS_SWING: ReadonlyArray<string> = [
  '....GG.OOOO.GG....',
  '....G..OYOO..G....',
  '...FF..OODO..G....',
  '...FF..OOOO..G....',
  '.......OOOO..FF...',
  '.......PPPP..FF...',
]

const TANK_ARMS_SWING_BACK: ReadonlyArray<string> = [
  '....GG.OOOO.GG....',
  '....G..OYOO..G....',
  '....G..OODO..FF...',
  '....G..OOOO..FF...',
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
  '....CRRRRRRRRC....',
  '....RRRRRRRRRR....',
  '....RWWWWWWWWR....',
  '....RRRRRRRRRR....',
  '....RRRRRRRRRR....',
  '.....RRRRRRRR.....',
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
  '....aAAAAAAAAa....',
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
            const top = coverRow.charAt(x)
            return top === '' || top === TRANSPARENT ? pixel : top
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

// NOTE: the Kaboomer is a hunched, grinning zombie hugging a big round
// cartoon bomb. The fuse and its sparks are drawn over the sprite each frame
// in zombieView.ts, since they shorten as he closes in. His lit frames turn
// the bomb red-hot for the last moments before it goes off.
export const EXPLODER_PALETTE: Palette = {
  G: '#c4f08a',
  g: '#8cc85e',
  W: '#fffbe6',
  E: '#1a1014',
  T: '#fff3c8',
  M: '#5a1a20',
  U: '#d26a3c',
  u: '#9a4426',
  K: '#22203a',
  k: '#55508a',
  H: '#ffffff',
  h: '#9a96cc',
  N: '#aaa6bc',
  n: '#6c6884',
  L: '#4a3a5a',
  F: '#2a2026',
  R: '#a8262c',
  c: '#6e6a84',
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
  '.gGGGg.......',
  'gGGGGGg......',
  'GWEGWEg.nn...',
  'GTTTTMgKNNK..',
  '.gMMMgKhHKKK.',
  'gUUUUKhHKKKKG',
  'GUUUUKKKKKKgG',
  'GGGGGGGGGGKk.',
  '.UUUUKKKKKKk.',
  '..uuu.kkkkk..',
]

export const EXPLODER_WEAR: ReadonlyArray<ReadonlyArray<Patch>> = [
  [
    patch(0, 5, TRANSPARENT, 1, 3),
    patch(1, 5, 'R'),
    patch(1, 7, 'U', 4),
    patch(5, 7, 'K', 5),
    patch(12, 5, TRANSPARENT, 1, 2),
    patch(11, 6, 'k'),
  ],
  [
    patch(10, 4, 'c'),
    patch(11, 5, 'O'),
    patch(10, 6, 'c'),
    patch(10, 8, 'O'),
    patch(2, 0, 'S', 3),
    patch(1, 1, 'S', 2),
    patch(4, 3, 'M'),
  ],
]

export const exploderWalkPixels = (stage: number): FramePixels => {
  const body = applyPatches(EXPLODER_BODY, wornThrough(EXPLODER_WEAR, stage))
  return [
    [...swayRows(body, 0), '....LL..LL.....', '...FFF..FFF....'],
    [...swayRows(body, 1), '.....LL..LL....', '....FFF..FFF...'],
    [...swayRows(body, 0), '....LL..LL.....', '...FFF..FFF....'],
    [...swayRows(body, -1), '...LL..LL......', '..FFF..FFF.....'],
  ]
}

export const EXPLODER_FUSE_BASE = { x: 8, y: 1 }

// BIG LEAGUER

// NOTE: the Big Leaguer is a lanky zombie pitcher in a torn pinstripe jersey
// and a backwards cap. His long arms drag his knuckles along the floor. His
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
  S: '#f2ecd8',
  s: '#c8bea4',
  b: '#a9b8e6',
  B: '#3a5ab0',
  n: '#d8463e',
  P: '#b0aca0',
  W: '#3a5ab0',
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
    '.cCSnnnbSCc.',
    '.CCSbSnbSCC.',
    '.CCSbnSbSCC.',
    '.C.sSsSSs.C.',
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
    '.cCSnnnbSCc.',
    '.CCSbSnbSCC.',
    '.CCSbnSbS.C.',
    '.C.sSsSSs.C.',
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
    '.cCSnnnbSCc.',
    '.CCSbSnbSCC.',
    '.CCSbnSbSCC.',
    '.C.sSsSSs.C.',
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
    '.cCSnnnbSCc.',
    '.CCSbSnbSCC.',
    '.C.SbnSbSCC.',
    '.C.sSsSSs.C.',
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
  '...SnnnbS...',
  '...SbSnbS...',
  '...SbnSbS...',
  '...sSsSSsPP.',
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
  '.cCSnnnbS...',
  '.CCSbSnbS...',
  '.CCSbnSbS...',
  '.C.sSsSSs...',
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

export const CRAWLER_PALETTE: Palette = {
  w: '#dcf5b8',
  c: '#9ec786',
  E: '#2a1418',
  M: '#a8262c',
  r: '#c2ad8a',
  q: '#8a7558',
  k: '#4a3c30',
  N: '#f28fb0',
  J: '#c0587a',
}

const CRAWLER_HEAD: ReadonlyArray<string> = [
  '.......cww..',
  '......cwwww.',
  '......wEwEw.',
  '......wwMMw.',
  '..rrr..www..',
  '.rrrrrrcw...',
]

const CRAWLER_FRAMES: Array.NonEmptyReadonlyArray<ReadonlyArray<string>> = [
  [...CRAWLER_HEAD, 'kkrrqrrrwww.', 'k......w..w.'],
  [...CRAWLER_HEAD, 'kkrrqrrrww..', '.k......ww.w'],
  [...CRAWLER_HEAD, 'kkrrqrrrwww.', 'k.......w..w'],
  [...CRAWLER_HEAD, 'kkrrqrrrww..', '.k.....w.w..'],
]

export const CRAWLER_WEAR: ReadonlyArray<ReadonlyArray<Patch>> = [
  [patch(8, 0, 'N', 2), patch(7, 1, 'J', 4), patch(9, 2, 'M')],
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
  '.TTTTT.',
]

export const RUNNER_ICON_PIXELS: ReadonlyArray<string> = [
  '.HHHHH.',
  'HSSSSSH',
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
  'LLlRWWR',
]

export const EXPLODER_ICON_PIXELS: ReadonlyArray<string> = [
  '.....O.',
  '....n..',
  '.GKKKG.',
  'GKHKKKG',
  '.KKKKK.',
  '..KKK..',
]

export const CHUCKER_ICON_PIXELS: ReadonlyArray<string> = [
  '..RRRR.',
  'rrRRRRR',
  '.CECCE.',
  '.CCMMC.',
  '.SbnbS.',
  'CSbSnSC',
]

export const CRAWLER_ICON_PIXELS: ReadonlyArray<string> = [
  '....cw.',
  '...cwww',
  '...wEwE',
  'r..wMMw',
  'rrr.ww.',
  'krrrcww',
]
