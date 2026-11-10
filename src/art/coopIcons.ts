import { Function, Option } from 'effect'

import { isObjectFirst } from '../shared/dualArgs'
import type { Appearance, Calling } from '../shared/playerData'
import { appearanceKey, playerPalette, playerPixels } from './appearance'
import { pixelIconUrl } from './icons'

// NOTE: co-op's own pixel icons, the same chunky SVG pixels as the home
// menu's (src/art/icons.ts).

const LIGHT = '#f4f1de'
const SHADE = '#140c10'

const PALETTE = {
  X: LIGHT,
  O: SHADE,
  P: '#ff9df0',
  T: '#5fd4c8',
  Y: '#ffe066',
  G: '#9be36a',
  R: '#ff6b5e',
  B: '#8a5a3c',
  D: '#4a2f22',
}

const icon = (pixels: ReadonlyArray<string>): string =>
  pixelIconUrl(pixels, PALETTE)

export const COOP_ICON = icon([
  '..PPP....TTT..',
  '.PPPPP..TTTTT.',
  '.POPOP..TOTOT.',
  '.PPPPP..TTTTT.',
  '..PPP....TTT..',
  '..............',
  'PPPPPPP.TTTTTT',
  'PPPPPPP.TTTTTT',
  'PPPPPPP.TTTTTT',
])

export const QUICK_ICON = icon([
  '....YYY',
  '...YYY.',
  '..YYY..',
  '.YYYYYY',
  '....YY.',
  '...YY..',
  '..YY...',
  '.Y.....',
])

export const CODE_ICON = icon([
  'XX.XX.XX',
  'XX.XX.XX',
  '........',
  'XX.XX.XX',
  'XX.XX.XX',
  '........',
  'XX.XX.XX',
  'XX.XX.XX',
])

export const NEW_ROOM_ICON = icon([
  'BBBBBB....',
  'BDDDDB....',
  'BDDDDB..Y.',
  'BDDDDB.YYY',
  'BDDDYB..Y.',
  'BDDDDB....',
  'BDDDDB....',
  'BBBBBB....',
])

// NOTE: the door a new room opens, its leaf alone: the frame and the light
// behind it are the stylesheet's, so the leaf can swing.
export const DOOR_ICON = icon([
  'BBBBBBB',
  'BDDBDDB',
  'BDDBDDB',
  'BDDBDDB',
  'BBBBBBB',
  'BDDDDDB',
  'BDDDDYB',
  'BDDDDDB',
  'BBBBBBB',
  'BDDBDDB',
  'BDDBDDB',
  'BBBBBBB',
])

// NOTE: a puff of dust where a player lands in a seat or leaves it.
export const POOF_ICON = icon([
  '....XX.......',
  '..XXXXX..XX..',
  '.XXXXXXXXXXX.',
  'XXXX..XXXXXXX',
  '.XXXXXXX..XX.',
  '..XX..XXXXX..',
  '.......XX....',
])

export const CROWN_ICON = icon([
  'Y..Y..Y',
  'YY.Y.YY',
  'YYYYYYY',
  'YRYYYRY',
  'YYYYYYY',
])

export const CHECK_ICON = icon([
  '.......G',
  '......GG',
  'G....GG.',
  'GG..GG..',
  '.GGGG...',
  '..GG....',
])

// NOTE: a door with an arrow out of it: the host shows a player the door.
export const KICK_ICON = icon([
  'XXXXX.......',
  'XDDDX....R..',
  'XDDDX.....R.',
  'XDDYXRRRRRRR',
  'XDDDX.....R.',
  'XDDDX....R..',
  'XDDDX.......',
  'XXXXX.......',
])

// NOTE: a ping as a WiFi signal: a dot and three arcs, as many lit in the
// grade's color as the connection is good (the thresholds are the view's).
const WIFI_PIXELS = [
  '.AAAAAAA.',
  'A.......A',
  '..BBBBB..',
  '.B.....B.',
  '...CCC...',
  '..C...C..',
  '....D....',
]

const WIFI_OFF = '#4a3f52'

const wifiIcon = (lit: string, arcs: number): string =>
  pixelIconUrl(WIFI_PIXELS, {
    A: arcs >= 3 ? lit : WIFI_OFF,
    B: arcs >= 2 ? lit : WIFI_OFF,
    C: lit,
    D: lit,
  })

export const WIFI_ICONS = {
  Good: wifiIcon('#8cff5a', 3),
  Ok: wifiIcon('#ffe066', 2),
  Bad: wifiIcon('#ff4a4f', 1),
} as const

export const LEAVE_ICON = icon([
  'XXXX.....',
  'X..X..X..',
  'X..X..XX.',
  'X..XXXXXX',
  'X..X..XX.',
  'X..X..X..',
  'XXXX.....',
])

export const AWAY_ICON = icon([
  'XXXX....',
  '..X.....',
  '.X..XXX.',
  'XXXX..X.',
  '.....X..',
  '....XXX.',
])

export const WAIT_ICON = icon(['XXXXX', '.XXX.', '..X..', '.X.X.', 'XXXXX'])

// THE DARE CARD (the single player lobby, LORE.md "PLAY is the dare")

// NOTE: who you drag along: a wind-up tin robot from the nursery, a dented
// silver head with a gold key in its side, for the lobby's + BOT tiles and
// the mark beside a bot's name.
export const TIN_BOT_ICON = pixelIconUrl(
  [
    '......R.........',
    '......D.........',
    '..SSSSSSSSS.....',
    '.SSSSSSSSSSS.Y.Y',
    '.SSTTSSSTTSSDYYY',
    '.SSTTSSSTTSS.Y.Y',
    '.SSSSSSSSSSS....',
    '.SSDODODODSS....',
    '.SSSSSSSSSSS....',
    '..DDDDDDDDD.....',
  ],
  {
    S: '#c9d1d9',
    D: '#5b6570',
    O: SHADE,
    T: '#5fd4c8',
    R: '#ff6b5e',
    Y: '#ffe066',
  },
)

// NOTE: SHAKE ON IT: two hands clasped, in START's dark ink.
export const SHAKE_ICON = icon([
  'OO.........OO',
  'OOO.......OOO',
  'OOOOO.OOOOOOO',
  'OOO.OO.O.OOOO',
  '.OOO.OO.O.OO.',
  '..OOO.OOOOO..',
  '...OOOOOOO...',
  '.....OOO.....',
])

// NOTE: CHICKEN OUT: a white hen inked in outline, with a red comb, a gold
// beak, and gold legs, so it reads on the napkin.
export const CHICKEN_ICON = icon([
  '...RR.......',
  '..RRRO......',
  '..OXXXO.....',
  '.OXOXXO.....',
  'YYOXXXO..OO.',
  '.YOXXXXOOXO.',
  '..OXXXXXXXO.',
  '..OXXXXXXXO.',
  '...OXXXXXO..',
  '....OOOOO...',
  '....Y..Y....',
  '...YY.YY....',
])

export const BACK_ICON = icon([
  '...X....',
  '..XX....',
  '.XXXXXXX',
  'XXXXXXXX',
  '.XXXXXXX',
  '..XX....',
  '...X....',
])

export const LINK_ICON = icon([
  '.XXX....',
  'X...X...',
  'X..XXX..',
  'X.X.X.X.',
  '..XXX..X',
  '....X..X',
  '.....XX.',
])

export const OFFLINE_ICON = icon([
  'R.....R',
  '.R...R.',
  '..R.R..',
  '...R...',
  '..R.R..',
  '.R...R.',
  'R.....R',
])

// PORTRAITS

const portraits = new Map<string, string>()

// NOTE: a player's look, standing, as an image for the lobby and the queue.
// Each look is drawn once and kept.
export const portraitOf: {
  (calling?: Calling): (look: Appearance) => string
  (look: Appearance, calling?: Calling): string
} = Function.dual(
  isObjectFirst,
  (look: Appearance, calling: Calling = 'You'): string => {
    const key = appearanceKey(look, calling)
    return Option.getOrElse(Option.fromNullishOr(portraits.get(key)), () => {
      const url = pixelIconUrl(
        playerPixels(look, calling).idle[0],
        playerPalette(look),
      )
      portraits.set(key, url)
      return url
    })
  },
)

// NOTE: a pencil by your own name in the lobby: the name is a button.
export const PENCIL_ICON = icon([
  '......OO.',
  '.....OPPO',
  '....OYYO.',
  '...OYYO..',
  '..OYYO...',
  '.OYYO....',
  '.OBYO....',
  'OBO.O....',
  'OO.......',
])
