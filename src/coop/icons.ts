import { Option } from 'effect'

import { appearanceKey, playerPalette, playerPixels } from '../appearance'
import { pixelIconUrl } from '../icons'
import type { Appearance } from '../model'
import type { Calling } from '../playerData'

// NOTE: co-op's own pixel icons, the same chunky SVG pixels as the home
// menu's (src/icons.ts).

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

export const KICK_ICON = icon([
  '..RRR...',
  '..RRR...',
  '..RRR...',
  '..RRRR..',
  '.RRRRRRR',
  'RRRRRRRR',
])

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

// NOTE: the teammate bot's head, for the lobby's + BOT tiles and the mark
// beside a bot's name.
export const BOT_ICON = icon([
  '.....Y.....',
  '.....X.....',
  '.XXXXXXXXX.',
  'XXXXXXXXXXX',
  'XXTTXXXTTXX',
  'XXTTXXXTTXX',
  'XXXXXXXXXXX',
  'XXOXOXOXOXX',
  '.XXXXXXXXX.',
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
export const portraitOf = (
  look: Appearance,
  calling: Calling = 'You',
): string => {
  const key = appearanceKey(look, calling)
  return Option.getOrElse(Option.fromNullishOr(portraits.get(key)), () => {
    const url = pixelIconUrl(
      playerPixels(look, calling).idle[0],
      playerPalette(look),
    )
    portraits.set(key, url)
    return url
  })
}
