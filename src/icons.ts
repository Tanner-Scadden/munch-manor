import { Array, Record, pipe } from 'effect'

import type { Difficulty, TrapKind } from './model'
import { type Palette, pixelRuns } from './sprite'
import { TRAP_ICON_PIXELS } from './sprites/traps'

// PIXEL ICONS

const LIGHT = '#f4f1de'
const SHADE = '#140c10'
const ALERT = '#ff6b5e'

const ICON_PALETTE: Palette = { X: LIGHT, O: SHADE, R: ALERT }

const iconWidth = (pixels: ReadonlyArray<string>): number =>
  Array.reduce(pixels, 0, (widest, row) => Math.max(widest, row.length))

// NOTE: the icons are the game's own pixel maps turned into SVG, so the HTML
// buttons over the canvas use the same chunky pixels as the canvas HUD.
export const pixelIconUrl = (
  pixels: ReadonlyArray<string>,
  palette: Palette,
  fit: 'Keep' | 'Stretch' = 'Keep',
): string => {
  const rects = pipe(
    pixelRuns(pixels, palette),
    Array.map(
      ({ x, y, width, height, color }) =>
        `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${color}"/>`,
    ),
    Array.join(''),
  )
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${iconWidth(pixels)} ${pixels.length}"${fit === 'Stretch' ? ' preserveAspectRatio="none"' : ''} shape-rendering="crispEdges">${rects}</svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

const icon = (pixels: ReadonlyArray<string>): string =>
  pixelIconUrl(pixels, ICON_PALETTE)

export const PAUSE_ICON = icon([
  'XX.XX',
  'XX.XX',
  'XX.XX',
  'XX.XX',
  'XX.XX',
  'XX.XX',
])

export const SOUND_ON_ICON = icon([
  '...X.....',
  '..XX...X.',
  'XXXX.X..X',
  'XXXX..X.X',
  'XXXX.X..X',
  '..XX...X.',
  '...X.....',
])

export const SOUND_OFF_ICON = icon([
  '...X.....',
  '..XX.....',
  'XXXX.R.R.',
  'XXXX..R..',
  'XXXX.R.R.',
  '..XX.....',
  '...X.....',
])

export const MUSIC_ON_ICON = icon([
  '..XXXXXX',
  '..XXXXXX',
  '..X....X',
  '..X....X',
  '..X....X',
  'XXX..XXX',
  'XXX..XXX',
])

export const MUSIC_OFF_ICON = icon([
  'R.XXXXXX',
  '.RXXXXXX',
  '..R....X',
  '..XR...X',
  '..X.R..X',
  'XXX..RXX',
  'XXX..XRX',
])

export const FULLSCREEN_ICON = icon([
  'XXX...XXX',
  'X.......X',
  'X.......X',
  '.........',
  '.........',
  '.........',
  'X.......X',
  'X.......X',
  'XXX...XXX',
])

export const SHARE_ICON = icon([
  '....X....',
  '...XXX...',
  '..X.X.X..',
  '....X....',
  'XX..X..XX',
  'X...X...X',
  'X.......X',
  'X.......X',
  'X.......X',
  'XXXXXXXXX',
])

export const ADD_TO_HOME_SCREEN_ICON = icon([
  'XXXXXXXXX',
  'X.......X',
  'X...X...X',
  'X...X...X',
  'X.XXXXX.X',
  'X...X...X',
  'X...X...X',
  'X.......X',
  'XXXXXXXXX',
])

export const RELOAD_ICON = icon([
  '..XXXX.X.',
  '.X....XX.',
  'X....XXX.',
  'X........',
  'X.......X',
  'X.......X',
  '.X.....X.',
  '..XXXXX..',
])

export const PADLOCK_ICON = icon([
  '..XXX..',
  '.X...X.',
  '.X...X.',
  'XXXXXXX',
  'XXXOXXX',
  'XXXOXXX',
  'XXXXXXX',
])

export const NEXT_TRAP_ICON = icon([
  '.....X..',
  'XXXXXXX.',
  '.....X..',
  '........',
  '..X.....',
  '.XXXXXXX',
  '..X.....',
])

export const TRAP_BUTTON_ICONS: Readonly<Record<TrapKind, string>> = Record.map(
  TRAP_ICON_PIXELS,
  ({ pixels, palette }) => pixelIconUrl(pixels, palette),
)

// HOME RAIL

const RAIL_PALETTE: Palette = {
  X: LIGHT,
  O: SHADE,
  G: '#8fdc5a',
  Y: '#ffe066',
  P: '#ff9df0',
}

export const NEWS_ICON = pixelIconUrl(
  [
    'YYYYYYYY..',
    'Y......Y..',
    'Y.XXXX.YYY',
    'Y......Y.Y',
    'Y.XX.X.Y.Y',
    'Y......Y.Y',
    'Y.XXXX.Y.Y',
    'Y......Y.Y',
    'YYYYYYYYYY',
  ],
  RAIL_PALETTE,
)

export const MUNCHOPEDIA_ICON = pixelIconUrl(
  [
    'XXXXXXXXX.',
    'XGGGGGGGXX',
    'XGOGGGOGXX',
    'XGGGGGGGXX',
    'XGOOOOOGXX',
    'XGGOGOGGXX',
    'XGGGGGGGXX',
    'XXXXXXXXXX',
    '.XXXXXXXXX',
  ],
  RAIL_PALETTE,
)

export const CHARACTER_ICON = pixelIconUrl(
  [
    '...PPP...',
    '..PPPPP..',
    '..PPPPP..',
    '...PPP...',
    '.........',
    '.PPPPPPP.',
    'PPPPPPPPP',
    'PPPPPPPPP',
  ],
  RAIL_PALETTE,
)

export const HELP_ICON = pixelIconUrl(
  [
    '.XXXXX.',
    'XX...XX',
    '.....XX',
    '...XXX.',
    '...XX..',
    '.......',
    '...XX..',
    '...XX..',
  ],
  RAIL_PALETTE,
)

export const SETTINGS_ICON = pixelIconUrl(
  [
    '...X.X...',
    '.X.XXX.X.',
    '..XXXXX..',
    'XXXX.XXXX',
    '.XX...XX.',
    'XXXX.XXXX',
    '..XXXXX..',
    '.X.XXX.X.',
    '...X.X...',
  ],
  RAIL_PALETTE,
)

const COFFEE_PALETTE: Palette = {
  X: LIGHT,
  B: '#7a4a24',
  S: '#b8c2b0',
}

// NOTE: a steaming mug for the coffee pill on Victory.
export const COFFEE_ICON = pixelIconUrl(
  [
    '..S..S...',
    '.S..S....',
    '..S..S...',
    '.........',
    'XXXXXXX..',
    'XBBBBBXXX',
    'XBBBBBX.X',
    'XBBBBBX.X',
    'XBBBBBXXX',
    '.XXXXX...',
  ],
  COFFEE_PALETTE,
)

const COFFEE_CUP_PALETTE: Palette = {
  X: LIGHT,
  B: '#7a4a24',
  C: '#e0a46a',
  H: '#ff6b8b',
}

// NOTE: the home corner's coffee: Rattles' mug with a heart on it. Its steam
// is COFFEE_STEAM_ICON, drawn apart so the wisps can rise.
export const COFFEE_CUP_ICON = pixelIconUrl(
  [
    'XXXXXXXX..',
    'XCCCCCCXXX',
    'XBBBBBBX.X',
    'XBHBHBBX.X',
    'XBHHHBBX.X',
    'XBBHBBBXXX',
    'XBBBBBBX..',
    '.XXXXXX...',
  ],
  COFFEE_CUP_PALETTE,
)

// NOTE: one wisp of steam, rising over the coffee in the home corner.
export const COFFEE_STEAM_ICON = pixelIconUrl(['.S', 'S.', '.S', 'S.'], {
  S: '#e8eee0',
})

// THE MANOR HAND

// NOTE: three cards fanned out, the character's, the Munchopedia's, and
// What's New's, for the MORE button that deals the hand.
export const HAND_ICON = pixelIconUrl(
  [
    '.....GGGGGGG.....',
    '.....GOOOOOG.....',
    '.....GOOOOOG.....',
    'PPPPPGOGOGOGYYYYY',
    'POOOOGOOOOOGOOOOY',
    'POOPOGGOOOGGYYYOY',
    'POPPPGOGGGOGOOOOY',
    'POOPOGOOOOOGYYYOY',
    'POOOOGOOOOOGOOOOY',
    'POPPPGOOOOOGYYOOY',
    'PPPPPGGGGGGGOOOOY',
    'POOOOOP...YOYYYOY',
    'PPPPPPP...YYYYYYY',
  ],
  RAIL_PALETTE,
)

// SETTINGS

export const SHAKE_ICON = icon([
  'X.XXXXX.X',
  'X.X...X.X',
  '..X.X.X..',
  'X.X...X.X',
  'X.XXXXX.X',
])

export const STATS_ICON = icon([
  '.......XX',
  '.......XX',
  '....XX.XX',
  '....XX.XX',
  '.XX.XX.XX',
  '.XX.XX.XX',
  'XXXXXXXXX',
])

// CONTROLS

export const AIM_ICON = icon([
  '....X....',
  '..XXXXX..',
  '.X..X..X.',
  '.X.....X.',
  'XXX.R.XXX',
  '.X.....X.',
  '.X..X..X.',
  '..XXXXX..',
  '....X....',
])

// NOTE: a finger pressing down, for the touch HUD's hold-to-buy button.
export const HOLD_ICON = icon([
  '...OO.....',
  '..OXXO....',
  '..OXXO....',
  '..OXXOOO..',
  '..OXXXXXOO',
  'OOOXXXXXXO',
  'OXOXXXXXXO',
  'OXXXXXXXXO',
  '.OXXXXXXO.',
  '..OOOOOO..',
])

// NOTE: an upright phone with a little Groaner on its screen. The portrait
// home menu's turn hint tips it on its side with CSS.
export const TURN_PHONE_ICON = pixelIconUrl(
  [
    '.XXXXXXX.',
    'XOOOOOOOX',
    'XOGGGGGOX',
    'XOGOGOGOX',
    'XOGGGGGOX',
    'XOGOOOGOX',
    'XOGGGGGOX',
    'XOOOOOOOX',
    'XOOOOOOOX',
    'XOOOXOOOX',
    '.XXXXXXX.',
  ],
  RAIL_PALETTE,
)

// HOME BADGES

const BADGE_PALETTE: Palette = {
  X: LIGHT,
  O: SHADE,
  Y: '#ffe066',
  D: '#a87a1e',
  T: '#5fd4c8',
  U: '#b98cff',
  W: '#4a2a70',
}

// NOTE: the end card draws the trophy and the skulls on its canvas too
// (src/endView.ts), from the same pixel maps.
export const TROPHY_PIXELS: ReadonlyArray<string> = [
  'YYYYYYYYY',
  'Y.YYYYY.Y',
  'Y.YYYYD.Y',
  '.YYYYYD..',
  '..YYYD...',
  '...YD....',
  '....Y....',
  '..YYYYY..',
  '..DDDDD..',
]

export const TROPHY_PALETTE: Palette = BADGE_PALETTE

export const TROPHY_ICON = pixelIconUrl(TROPHY_PIXELS, BADGE_PALETTE)

export const CLOCK_ICON = icon([
  '..XXXXX..',
  '.X..X..X.',
  'X...X...X',
  'X...X...X',
  'X...XXX.X',
  'X.......X',
  'X.......X',
  '.X.....X.',
  '..XXXXX..',
])

type SkullFace = 'Sleepy' | 'Open' | 'Angry'

const SKULL_EYES: Readonly<Record<SkullFace, ReadonlyArray<string>>> = {
  Sleepy: ['XXXXXXXXX', 'XOOXXXOOX'],
  Open: ['XOOXXXOOX', 'XOOXXXOOX'],
  Angry: ['XOXXXXXOX', 'XOOXXXOOX'],
}

const skullPixels = (face: SkullFace): ReadonlyArray<string> => [
  '..XXXXX..',
  '.XXXXXXX.',
  'XXXXXXXXX',
  ...SKULL_EYES[face],
  'XXXXOXXXX',
  '.XXXXXXX.',
  '..X.X.X..',
  '..XXXXX..',
]

const tinted = (pixels: ReadonlyArray<string>, color: string): string =>
  pixelIconUrl(pixels, { X: color, O: SHADE })

export type PixelArt = Readonly<{
  pixels: ReadonlyArray<string>
  palette: Palette
}>

const tint = (pixels: ReadonlyArray<string>, color: string): PixelArt => ({
  pixels,
  palette: { X: color, O: SHADE },
})

// NOTE: one skull per difficulty, each in its level's color with its own
// face: sleepy Easy, plain Normal, angry Hard, and Nightmare in flames.
export const SKULL_ART: Readonly<Record<Difficulty, PixelArt>> = {
  Easy: tint(skullPixels('Sleepy'), '#9be36a'),
  Normal: tint(skullPixels('Open'), '#ffe066'),
  Hard: tint(skullPixels('Angry'), '#ffa04d'),
  Nightmare: {
    pixels: [
      'Y..F.Y..F',
      '.Y.FY.FY.',
      '..XXXXX..',
      '.XXXXXXX.',
      'XOXXXXXOX',
      'XOOXXXOOX',
      'XXXXOXXXX',
      '.XXXXXXX.',
      '..X.X.X..',
      '..XXXXX..',
    ],
    palette: { X: '#ff6b5e', O: SHADE, Y: '#ffe066', F: '#ffa04d' },
  },
}

export const SKULL_OFF_ART: PixelArt = tint(skullPixels('Open'), '#4a3f52')

export const SKULL_ICONS: Readonly<Record<Difficulty, string>> = Record.map(
  SKULL_ART,
  ({ pixels, palette }) => pixelIconUrl(pixels, palette),
)

export const SKULL_OFF_ICON = tinted(skullPixels('Open'), '#4a3f52')

export const KILLS_ICON = tinted(skullPixels('Open'), LIGHT)

// NOTE: Campaign is the manor's front door, Endless the infinity loop.
export const CAMPAIGN_ICON = pixelIconUrl(
  [
    '....U....',
    '...UUU...',
    '..UUUUU..',
    '.UUUUUUU.',
    'UUUUUUUUU',
    '.UWWUWWU.',
    '.UWWUWWU.',
    '.UUUUUUU.',
    '.UUWWWUU.',
    '.UUWWYUU.',
    '.UUWWWUU.',
  ],
  BADGE_PALETTE,
)

export const ENDLESS_ICON = pixelIconUrl(
  ['.TTT...TTT.', 'T...T.T...T', 'T....T....T', 'T...T.T...T', '.TTT...TTT.'],
  BADGE_PALETTE,
)

// NOTE: PLAY's only mark, so it is a full, nearly equilateral triangle that
// reads at a glance even small.
export const PLAY_ICON = pixelIconUrl(
  [
    'X.......',
    'XX......',
    'XXXX....',
    'XXXXX...',
    'XXXXXXX.',
    'XXXXXXXX',
    'XXXXXXX.',
    'XXXXX...',
    'XXXX....',
    'XX......',
    'X.......',
  ],
  { X: SHADE },
)

export const REWIND_ICON = icon([
  '...X...X',
  '..XX..XX',
  '.XXX.XXX',
  'XXXXXXXX',
  '.XXX.XXX',
  '..XX..XX',
  '...X...X',
])

// NOTE: GitHub's own mark (the Invertocat, from Primer's octicons), white and
// unchanged as GitHub's logo rules ask: never pixelated, recolored, or
// redrawn. The Code card in the MORE hand shows it.
const GITHUB_MARK_PATH =
  'M10.226 17.284c-2.965-.36-5.054-2.493-5.054-5.256 0-1.123.404-2.336 1.078-3.144-.292-.741-.247-2.314.09-2.965.898-.112 2.111.36 2.83 1.01.853-.269 1.752-.404 2.853-.404 1.1 0 1.999.135 2.807.382.696-.629 1.932-1.1 2.83-.988.315.606.36 2.179.067 2.942.72.854 1.101 2 1.101 3.167 0 2.763-2.089 4.852-5.098 5.234.763.494 1.28 1.572 1.28 2.807v2.336c0 .674.561 1.056 1.235.786 4.066-1.55 7.255-5.615 7.255-10.646C23.5 6.188 18.334 1 11.978 1 5.62 1 .5 6.188.5 12.545c0 4.986 3.167 9.12 7.435 10.669.606.225 1.19-.18 1.19-.786V20.63a2.9 2.9 0 0 1-1.078.224c-1.483 0-2.359-.808-2.987-2.313-.247-.607-.517-.966-1.034-1.033-.27-.023-.359-.135-.359-.27 0-.27.45-.471.898-.471.652 0 1.213.404 1.797 1.235.45.651.921.943 1.483.943.561 0 .92-.202 1.437-.719.382-.381.674-.718.944-.943'

export const GITHUB_MARK_ICON = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#ffffff" d="${GITHUB_MARK_PATH}"/></svg>`,
)}")`

// NOTE: the end screens' RETRY, a round arrow, and HOME, a little house.
export const RETRY_ICON = pixelIconUrl(
  [
    '...XXXX.X',
    '..X....XX',
    '.X....XXX',
    'X........',
    'X.......X',
    'X.......X',
    '.X.....X.',
    '..XXXXX..',
  ],
  { X: SHADE },
)

export const HOME_ICON = icon([
  '....X....',
  '...XXX...',
  '..XXXXX..',
  '.XXXXXXX.',
  'XXXXXXXXX',
  '.XX...XX.',
  '.XX.X.XX.',
  '.XX...XX.',
  '.XXXXXXX.',
])

// NOTE: the red pixel X on every menu's close button (closeButtonView).
export const CLOSE_ICON = pixelIconUrl(
  [
    'OOO...OOO',
    'ORRO.ORRO',
    'ORRRORRRO',
    '.ORRRRRO.',
    '..ORRRO..',
    '.ORRRRRO.',
    'ORRRORRRO',
    'ORRO.ORRO',
    'OOO...OOO',
  ],
  { O: SHADE, R: '#ff5a4e' },
)

// PROFILE

const PROFILE_PALETTE: Palette = {
  X: LIGHT,
  O: SHADE,
  Y: '#ffe066',
  D: '#a87a1e',
  T: '#5fd4c8',
  K: '#1f5c58',
  U: '#b98cff',
  W: '#4a2a70',
  G: '#9be36a',
  S: '#8a8f86',
}

// NOTE: a hello-my-name-is badge for the Name tab.
export const NAME_ICON = pixelIconUrl(
  [
    'YYYYYYYYYYY',
    'YDDDDDDDDDY',
    'YDDDDDDDDDY',
    'YXXXXXXXXXY',
    'YXOOXOXOOXY',
    'YXXXXXXXXXY',
    'YXXXXXXXXXY',
    'YYYYYYYYYYY',
  ],
  PROFILE_PALETTE,
)

// NOTE: a phone and a laptop joined by a spark, for the Account tab.
export const ACCOUNT_ICON = pixelIconUrl(
  [
    'TTTT........',
    'TKKT........',
    'TKKT..TTTTTT',
    'TKKT..TKKKKT',
    'TKKTYYTKKKKT',
    'TKKT..TTTTTT',
    'TTXT.TTTTTTTT',
  ],
  PROFILE_PALETTE,
)

// NOTE: a die showing five, for the dice that rolls a look or a name.
export const DICE_ICON = pixelIconUrl(
  [
    '.XXXXXXX.',
    'XOOXXXOOX',
    'XOOXXXOOX',
    'XXXXXXXXX',
    'XXXXOOXXX',
    'XXXXOOXXX',
    'XXXXXXXXX',
    'XOOXXXOOX',
    'XOOXXXOOX',
    '.XXXXXXX.',
    '.SSSSSSS.',
  ],
  PROFILE_PALETTE,
)

// NOTE: the devices on the Account tab: a phone and a laptop with a little
// Groaner on the screen.
export const PHONE_ICON = pixelIconUrl(
  [
    '.TTTTT.',
    'TKKKKKT',
    'TKGGGKT',
    'TKGOGKT',
    'TKGGGKT',
    'TKGOGKT',
    'TKKKKKT',
    'TTTXTTT',
    '.TTTTT.',
  ],
  PROFILE_PALETTE,
)

export const LAPTOP_ICON = pixelIconUrl(
  [
    '..TTTTTTTTT..',
    '..TKKKKKKKT..',
    '..TKKGGGKKT..',
    '..TKKGOGKKT..',
    '..TKKGGGKKT..',
    '..TKKGOGKKT..',
    '..TTTTTTTTT..',
    'TTTTTTTTTTTTT',
    '.SSSSSSSSSSS.',
  ],
  PROFILE_PALETTE,
)

// NOTE: a swirling portal, for summoning your other device with a code.
export const PORTAL_ICON = pixelIconUrl(
  [
    '...UUUUU...',
    '.UUWWWWWUU.',
    'UUWWUUUWWUU',
    'UWWUWWWUWWU',
    'UWUWWXWWUWU',
    'UWUWXXXWUWU',
    'UWWUWXWUWWU',
    'UUWWUUUWWUU',
    '.UUWWWWWUU.',
    '...UUUUU...',
  ],
  PROFILE_PALETTE,
)

// NOTE: a keypad, for typing in a code from your other device.
export const KEYPAD_ICON = pixelIconUrl(
  [
    'TTTTTTTTTT',
    'TXXTXXTXXT',
    'TXXTXXTXXT',
    'TTTTTTTTTT',
    'TXXTXXTXXT',
    'TXXTXXTXXT',
    'TTTTTTTTTT',
    'TXXTXXTXXT',
    'TXXTXXTXXT',
    'TTTTTTTTTT',
  ],
  PROFILE_PALETTE,
)

// NOTE: an arrow pouring into a phone, for the device that takes the other
// device's progress.
export const TAKES_PROGRESS_ICON = pixelIconUrl(
  [
    '...YYY...',
    '...YYY...',
    '.YYYYYYY.',
    '..YYYYY..',
    '...YYY...',
    'TTTTYTTTT',
    'TKKKKKKKT',
    'TKKKKKKKT',
    'TTTTTTTTT',
  ],
  PROFILE_PALETTE,
)

// NOTE: the zap between two devices once they are linked.
export const ZAP_ICON = pixelIconUrl(
  ['...YYY', '..YYY.', '.YYY..', 'YYYYYY', '..YYY.', '.YYY..', 'YYY...'],
  PROFILE_PALETTE,
)

// UPDATE GIFT

const GIFT_PALETTE: Palette = {
  X: LIGHT,
  O: SHADE,
  Y: '#ffe066',
  U: '#b98cff',
  P: '#ff9df0',
  W: '#4a2a70',
  G: '#8fdc5a',
  K: '#3f7a2a',
}

// NOTE: the update gift on the home menu comes in three layers, so CSS can
// rattle the box, fling the lid, and pop the Groaner out of it.
export const GIFT_LID_ICON = pixelIconUrl(
  [
    '..YYY.....YYY..',
    '.Y...YY.YY...Y.',
    '..YYYYYYYYYYY..',
    'WWWWWWWYWWWWWWW',
    'WPPPPPPYPPPPPPW',
    'WXPPPPPYPPPPPPW',
    'WWWWWWWYWWWWWWW',
  ],
  GIFT_PALETTE,
)

export const GIFT_BOX_ICON = pixelIconUrl(
  [
    'WXUUUUYUUUUUW',
    'WXUUUUYUUUUUW',
    'WUUUUUYUUUUUW',
    'WYYYYYYYYYYYW',
    'WUUUUUYUUUUUW',
    'WUUUUUYUUUUUW',
    'WUUUUUYUUUUUW',
    'WWWWWWWWWWWWW',
  ],
  GIFT_PALETTE,
)

export const GIFT_ZOMBIE_ICON = pixelIconUrl(
  [
    '..GGGGG..',
    '.GGGGGGG.',
    'GGOGGGOGG',
    'GGOGGGOGG',
    'GGGGGGGGG',
    'GOXOXOXOG',
    '.GGGGGGG.',
    '..KKKKK..',
  ],
  GIFT_PALETTE,
)

export const SPARKLE_ICON = pixelIconUrl(
  ['..Y..', '..Y..', 'YYXYY', '..Y..', '..Y..'],
  GIFT_PALETTE,
)

// INSTALL

// NOTE: a phone with a gold arrow dropping onto its home row, for the tile
// that puts the game on the Home Screen.
export const INSTALL_ICON = pixelIconUrl(
  [
    '.TTTTTTT.',
    'TKKKYKKKT',
    'TKKKYKKKT',
    'TKKKYKKKT',
    'TKYYYYYKT',
    'TKKYYYKKT',
    'TKKKYKKKT',
    'TKKKKKKKT',
    'TKGGGGGKT',
    'TTTTXTTTT',
    '.TTTTTTT.',
  ],
  PROFILE_PALETTE,
)

// NOTE: a Home Screen with Munch Manor's Groaner as the big app in the
// middle, for the last step of the picture guide.
export const HOME_SCREEN_APP_ICON = pixelIconUrl(
  [
    '.TTTTTTTTTT.',
    'TKKKKKKKKKKT',
    'TKSSKKKKSSKT',
    'TKSSKKKKSSKT',
    'TKKKGGGGKKKT',
    'TKKGOGGOGKKT',
    'TKKGGGGGGKKT',
    'TKKGOOOOGKKT',
    'TKKKGGGGKKKT',
    'TKSSKKKKSSKT',
    'TKSSKKKKSSKT',
    'TKKKKKKKKKKT',
    'TTTTTXXTTTTT',
    '.TTTTTTTTTT.',
  ],
  PROFILE_PALETTE,
)

// NOTE: three rounds, for the shop's ammo counts beside a gun.
export const ROUNDS_ICON = pixelIconUrl(
  [
    '.B...B...B.',
    'BBB.BBB.BBB',
    'YYY.YYY.YYY',
    'YYY.YYY.YYY',
    'YYY.YYY.YYY',
    'OOO.OOO.OOO',
  ],
  { B: '#c9a227', Y: '#ffe066', O: '#a87b1a' },
)

// NOTE: the guided first break's tracker (src/questView.ts): Rattles' stall,
// a coin above a Plank Pile to buy, and planks across a doorway to place.
const QUEST_PALETTE: Palette = {
  o: SHADE,
  r: '#ff4a4f',
  w: LIGHT,
  R: '#a8302a',
  f: '#6b4426',
  d: '#21140c',
  Y: '#c9a227',
  y: '#ffe066',
  P: '#c98a4a',
  L: '#8a5a2b',
}

export const QUEST_SHOP_ICON = pixelIconUrl(
  [
    'rwrwrwrwrwr',
    'rwrwrwrwrwr',
    '.R.R.R.R.R.',
    '.f..yyy..f.',
    '.f.yyYyy.f.',
    '.f.yyYyy.f.',
    '.f..yyy..f.',
    'fffffffffff',
    'fYYYYYYYYYf',
    'fffffffffff',
  ],
  QUEST_PALETTE,
)

export const QUEST_BUY_ICON = pixelIconUrl(
  [
    '....yyy....',
    '...yyYyy...',
    '...yyYyy...',
    '....yyy....',
    '...........',
    'ooooooooooo',
    'oPPPPLPPPPo',
    'ooooooooooo',
    'oPPPPLPPPPo',
    'ooooooooooo',
  ],
  QUEST_PALETTE,
)

export const QUEST_PLACE_ICON = pixelIconUrl(
  [
    'fffffffffff',
    'fdddddddddf',
    'oooooooooo.',
    'oPPPLPPPPPo',
    'oooooooooo.',
    'fdddddddddf',
    '.oooooooooo',
    'oPPPPPLPPPo',
    '.oooooooooo',
    'fdddddddddf',
  ],
  QUEST_PALETTE,
)

// NOTE: the kitchen tour's tracker: the break clock held (an hourglass with
// a pause mark), the kitchen's boards, the fridge, and its prize to take.
const TOUR_ICON_PALETTE: Palette = {
  o: SHADE,
  w: LIGHT,
  y: '#ffe066',
  Y: '#c9a227',
  f: '#6b4426',
  d: '#21140c',
  P: '#c98a4a',
  L: '#8a5a2b',
  k: '#d6cfa4',
  G: '#9be36a',
  g: '#4e6a2a',
  m: '#b8c0cc',
  M: '#5d6672',
}

export const TOUR_PAUSED_ICON = pixelIconUrl(
  [
    'ooooooo....',
    '.oyyyo.....',
    '..oyo..w.w.',
    '...o...w.w.',
    '..o.o..w.w.',
    '.oyyyo.....',
    'ooooooo....',
  ],
  TOUR_ICON_PALETTE,
)

export const TOUR_BOARDS_ICON = pixelIconUrl(
  [
    'fffffffffff',
    'fdddddddddf',
    'oooooooooo.',
    'oPPPLPPPPPo',
    'oooooooooo.',
    'fdddddddddf',
    '.oooooooooo',
    'oPPPPPLPPPo',
    '.oooooooooo',
    'fdddddddddf',
  ],
  TOUR_ICON_PALETTE,
)

export const TOUR_FRIDGE_ICON = pixelIconUrl(
  [
    '.oooooooo.',
    'okkkkkkkko',
    'okkkkkkoko',
    'oooooooooo',
    'okkkkoGGGo',
    'okkkkoGgGo',
    'okkokoGGGo',
    'okkokogGgo',
    'okkkkoGGGo',
    'oooooooooo',
  ],
  TOUR_ICON_PALETTE,
)

export const TOUR_PRIZE_ICON = pixelIconUrl(
  [
    '...yyy.....',
    '..y...y....',
    '......y....',
    '.....y.....',
    '....y......',
    '...........',
    '....y......',
    '..mmmmmmmm.',
    'mmmmmmmmmmm',
    'm..M.......',
  ],
  TOUR_ICON_PALETTE,
)
