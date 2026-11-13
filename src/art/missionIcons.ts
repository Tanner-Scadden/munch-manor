import { Record } from 'effect'
import type { Canvas } from 'foldkit'

import type { MissionId } from '../shared/missionData'
import { pixelIconUrl } from './icons'
import { type Palette, spriteShapes } from './sprite'

// The daily missions' pixel art (src/features/missions/), one picture each,
// as an icon for the home menu's card and its panel, and as a sprite for the
// end card's bars. Show,
// don't explain: the picture is the mission, its name is for a screen
// reader and the panel.

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
  // NOTE: a Hotfoot's green foot, on fire.
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
  // NOTE: the fridge, its handle red.
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
  // NOTE: a teammate bot's tin head.
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
  // NOTE: the Handyman's hammer.
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
  // NOTE: a heart with a white cross: a friend got up.
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
  // NOTE: a magnifying glass over a gold glint: the dare's things.
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
  // NOTE: the cellar's bare bulb on its chain.
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
  // NOTE: a cog: the room tools that set up and fire.
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
  // NOTE: a display case, its prize gold behind glass.
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
  // NOTE: the chandelier, candles lit, coming down.
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
  // NOTE: the Barn Buster's double barrel and stock.
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
  // NOTE: a gold star with a 2 on it: a gun to its second tier, DELUXE.
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
  // NOTE: the front door open, the night outside.
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
  // NOTE: a Groaner's head: zombies, any kind.
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

// NOTE: the three of a day done: a gold rosette, for the bonus.
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

// NOTE: a done mission's check, over its picture.
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

const sprite = (pixels: Pixels): ReadonlyArray<Canvas.Shape> =>
  spriteShapes(pixels, MISSION_PALETTE)

export const MISSION_ICONS: Readonly<Record<MissionId, string>> = Record.map(
  MISSION_PIXELS,
  icon,
)
export const ALL_THREE_ICON = icon(ALL_THREE_PIXELS)
export const MISSION_DONE_ICON = icon(DONE_PIXELS)

// NOTE: the same pictures on the end card's canvas, centered on their spot.
export const MISSION_SPRITES: Readonly<
  Record<MissionId, ReadonlyArray<Canvas.Shape>>
> = Record.map(MISSION_PIXELS, sprite)
export const ALL_THREE_SPRITE = sprite(ALL_THREE_PIXELS)
export const MISSION_DONE_SPRITE = sprite(DONE_PIXELS)
