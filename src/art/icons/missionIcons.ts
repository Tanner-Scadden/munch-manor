import { Record } from 'effect'

import { type Palette, spriteShapes } from '#art/sprite.ts'
import type * as Draw from '#render/draw.ts'
import type { MissionId } from '#shared/records/missionData.ts'

import { pixelIconUrl } from './icons.ts'

const MISSION_PALETTE: Palette = {
  o: '#140c10',
  w: '#f4f1de',
  g: '#8fdc5a',
  G: '#3f7a2a',
  r: '#ff6b5e',
  y: '#ffd23f',
  f: '#ff9b3d',
  b: '#8a5a3a',
  s: '#9aa3b5',
  k: '#4a3f52',
  p: '#ff9df0',
  t: '#5ee0d0',
}

type Pixels = ReadonlyArray<string>

const MISSION_PIXELS: Readonly<Record<MissionId, Pixels>> = {
  HotfootKills: [
    '.....f....',
    '....fyf...',
    '...fyrf.f.',
    '...frrf.f.',
    '..oooooof.',
    '..ogggggo.',
    '.ogggggggo',
    '.ogGgGgggo',
    '.oooooooo.',
  ],
  PullFridge: [
    '.oooooooo.',
    '.owwwwwwo.',
    '.owwwwwro.',
    '.oooooooo.',
    '.owwwwwwo.',
    '.owwwwrwo.',
    '.owwwwrwo.',
    '.owwwwwwo.',
    '.owwwwwwo.',
    '.oooooooo.',
  ],
  RunWithBot: [
    '....r.....',
    '....o.....',
    '.oooooooo.',
    '.osssssso.',
    '.ostsstso.',
    '.osssssso.',
    '.osooooso.',
    '.osssssso.',
    '.oooooooo.',
    '..oo..oo..',
  ],
  PlayHandyman: [
    '.oooooo...',
    'osssssoo..',
    'osssssso..',
    '.ooobooo..',
    '...obo....',
    '...obo....',
    '...obo....',
    '...obo....',
    '...ooo....',
  ],
  ReviveFriend: [
    '.oo...oo.',
    'orro.orro',
    'orrrorrro',
    'orrrwrrro',
    'orrwwwrro',
    '.orrwrro.',
    '..orrro..',
    '...oro...',
    '....o....',
  ],
  FindDareThings: [
    '..oooo....',
    '.owwwwo...',
    'owwyywwo..',
    'owyyywwo..',
    'owwywwwo..',
    '.owwwwo...',
    '..ooooboo.',
    '.......bbo',
    '........bo',
    '.........o',
  ],
  OpenCellar: [
    '....o.....',
    '....o.....',
    '....o.....',
    '...ooo....',
    '..oyyyo...',
    '.oyywyyo..',
    '.oyyyyyo..',
    '..oyyyo...',
    '...ooo....',
  ],
  WorkRoomTools: [
    '...o..o...',
    '..osooso..',
    '.ossssssoo',
    'ossskksso.',
    '.osk..kso.',
    '.osk..kso.',
    'ossskksso.',
    '.ossssssoo',
    '..osooso..',
    '...o..o...',
  ],
  OpenCase: [
    'oooooooooo',
    'obbbbbbbbo',
    'otttttttto',
    'ottyyyttto',
    'otyyyyytto',
    'ottyyyttto',
    'otttttttto',
    'obbbbbbbbo',
    'oooooooooo',
    '.o......o.',
  ],
  ChandelierCrush: [
    '....oo....',
    '....oo....',
    '.f..oo..f.',
    '.y..oo..y.',
    '.o.oyyo.o.',
    '.ooyyyyoo.',
    '..oyyyyo..',
    '...oooo...',
    '.r..r...r.',
    'r.r...r..r',
  ],
  BarnBusterKills: [
    '..........',
    'oooooooo..',
    'ossssssoo.',
    'ossssssobo',
    'oooooooobbo',
    '.....obbbbo',
    '.....obbo.',
    '....obbo..',
    '....ooo...',
  ],
  GunToDeluxe: [
    '....o.....',
    '...oyo....',
    'oooyyyooo.',
    'oyyyoyyyyo',
    '.oyyyoyyo.',
    '..oyoyyo..',
    '.oyyooyyo.',
    '.oyo..oyo.',
    '.oo....oo.',
  ],
  EscapeDoubleDare: [
    '.oooooooo.',
    '.obbbbbbo.',
    '.obkkkkbo.',
    '.obkkkkbo.',
    '.obkyykbo.',
    '.obkkkkbo.',
    '.obkkkkbo.',
    '.obkkkkbo.',
    'oooooooooo',
  ],
  LeaveEarly: [
    '...rr.....',
    '..owwo....',
    'fowowwo...',
    '..owwwwoo.',
    '..owwwwwwo',
    '...owwwwo.',
    '....oooo..',
    '....f..f..',
    '...ff.ff..',
  ],
  SplatZombies: [
    '..ooooo...',
    '.oggggggo.',
    'oggggggggo',
    'ogoogooggo',
    'ogoogoogo.',
    'oggggggggo',
    'ogwogwoggo',
    '.oggggggo.',
    '..oGGGGo..',
  ],
}

const ALL_THREE_PIXELS: Pixels = [
  '..oooooo..',
  '.oyyyyyyo.',
  'oyywyyyyyo',
  'oyyyyyyyyo',
  'oyyyyyyyyo',
  '.oyyyyyyo.',
  '..oooooo..',
  '..oro.oro.',
  '..oro.oro.',
  '..oo...oo.',
]

const DONE_PIXELS: Pixels = [
  '.......oo',
  '......ogo',
  'oo...ogo.',
  'ogo.ogo..',
  '.ogogo...',
  '..ogo....',
  '...o.....',
]

const icon = (pixels: Pixels): string => pixelIconUrl(pixels, MISSION_PALETTE)

const sprite = (pixels: Pixels): ReadonlyArray<Draw.Shape> =>
  spriteShapes(pixels, MISSION_PALETTE)

export const MISSION_ICONS: Readonly<Record<MissionId, string>> = Record.map(
  MISSION_PIXELS,
  icon,
)
export const ALL_THREE_ICON = icon(ALL_THREE_PIXELS)
export const MISSION_DONE_ICON = icon(DONE_PIXELS)

export const MISSION_SPRITES: Readonly<
  Record<MissionId, ReadonlyArray<Draw.Shape>>
> = Record.map(MISSION_PIXELS, sprite)
export const ALL_THREE_SPRITE = sprite(ALL_THREE_PIXELS)
export const MISSION_DONE_SPRITE = sprite(DONE_PIXELS)
