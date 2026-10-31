import { Array, Option, String, pipe } from 'effect'

import { textPixels } from './font'
import type { HintIcon } from './onboarding'
import {
  type Palette,
  type Sprite,
  TOP_LEFT,
  bakeShapes,
  group,
  spriteRects,
} from './sprite'
import { GNOME_PALETTE, GNOME_PIXELS, TRAP_ICON_PIXELS } from './sprites/traps'

// NOTE: the tutorial's pictures. Each icon is a few frames of pixel art,
// every frame baked once into one sprite image as the game loads, and the
// hint picks the frame from how long it has been shown.

type Pixels = ReadonlyArray<string>

export type HintIconSprites = Readonly<{
  width: number
  height: number
  frameMs: number
  frames: Array.NonEmptyReadonlyArray<Sprite>
}>

export const ICON_PALETTE: Palette = {
  o: '#140c10',
  k: '#e9e3cf',
  s: '#8f8672',
  g: '#2a1418',
  y: '#ffe066',
  Y: '#c9a227',
  w: '#f4f1de',
  h: '#f2c39b',
  H: '#c98f6a',
  r: '#ff4a4f',
  R: '#a8302a',
  c: '#c9d3c0',
  b: '#ffd23f',
  m: '#b8c0cc',
  M: '#5d6672',
  d: '#21140c',
  f: '#6b4426',
  K: '#463a48',
  S: '#2a2030',
}

type Layer = Readonly<{
  pixels: Pixels
  x: number
  y: number
  palette?: Palette
}>

const layer = (
  pixels: Pixels,
  x: number,
  y: number,
  palette: Palette = ICON_PALETTE,
): Layer => ({ pixels, x, y, palette })

const frameOf = (layers: ReadonlyArray<Layer>): Sprite =>
  bakeShapes(
    Array.map(layers, ({ pixels, x, y, palette }) =>
      group({
        translate: { x, y },
        shapes: spriteRects(pixels, palette ?? ICON_PALETTE, TOP_LEFT),
      }),
    ),
  )

const iconOf = (
  width: number,
  height: number,
  frameMs: number,
  frames: Array.NonEmptyReadonlyArray<ReadonlyArray<Layer>>,
): HintIconSprites => ({
  width,
  height,
  frameMs,
  frames: Array.map(frames, frameOf),
})

export const hintIconFrame = (
  { frames, frameMs }: HintIconSprites,
  ageMs: number,
): Sprite =>
  Option.getOrElse(
    Array.get(frames, Math.floor(Math.max(0, ageMs) / frameMs) % frames.length),
    () => Array.headNonEmpty(frames),
  )

// KEYS

const KEY_GLYPH = '#'

const faceRow = (glyphRow: string, face: string, glyph: string): string =>
  pipe(
    String.split(glyphRow, ''),
    Array.map(symbol => (symbol === KEY_GLYPH ? glyph : face)),
    Array.join(''),
  )

const keyWidth = (label: string): number =>
  Array.reduce(textPixels(label), 0, (widest, row) =>
    Math.max(widest, row.length),
  ) + 4

// NOTE: light letters on a dark cap, and a press lights them yellow. Dark
// letters on a light cap read backwards at this size: the eye takes the
// light gaps between the strokes for the letters, and E turns into a 3.
export const keyPixels = (label: string, isPressed: boolean): Pixels => {
  const width = keyWidth(label)
  const edge = `.${'o'.repeat(width - 2)}.`
  const glyph = isPressed ? 'y' : 'w'
  const glyphRows = Array.map(
    textPixels(label),
    row => `oK${faceRow(row, 'K', glyph)}Ko`,
  )
  return isPressed
    ? ['.'.repeat(width), edge, ...glyphRows, edge]
    : [edge, ...glyphRows, `o${'S'.repeat(width - 2)}o`, edge]
}

const KEY_HEIGHT = 8
const KEY_FRAME_MS = 420

export const keyIcon = (label: string): HintIconSprites =>
  iconOf(keyWidth(label), KEY_HEIGHT, KEY_FRAME_MS, [
    [layer(keyPixels(label, false), 0, 0)],
    [layer(keyPixels(label, true), 0, 0)],
  ])

const WASD_KEYS = [
  { label: 'W', x: 7, y: 0 },
  { label: 'A', x: 0, y: 9 },
  { label: 'S', x: 8, y: 9 },
  { label: 'D', x: 16, y: 9 },
]

const wasdFrame = (pressed: string): ReadonlyArray<Layer> =>
  Array.map(WASD_KEYS, ({ label, x, y }) =>
    layer(keyPixels(label, label === pressed), x, y),
  )

const WASD = iconOf(23, 17, 300, [
  wasdFrame('W'),
  wasdFrame('D'),
  wasdFrame('S'),
  wasdFrame('A'),
])

// MOUSE

const mousePixels = (isClicked: boolean): Pixels => {
  const button = isClicked ? 'yyy' : 'kkk'
  return [
    '.ooooooo.',
    `o${button}okkko`,
    `o${button}okkko`,
    `o${button}okkko`,
    'ooooooooo',
    'okkkkkkko',
    'okkkkkkko',
    'okkkkkkko',
    'okkkkkkko',
    'oskkkkkso',
    '.ossssso.',
    '..ooooo..',
  ]
}

const RETICLE: Pixels = [
  'rr...rr',
  'r.....r',
  '.......',
  '...r...',
  '.......',
  'r.....r',
  'rr...rr',
]

const RETICLE_HIT: Pixels = [
  'rr...rr',
  'r..b..r',
  '...b...',
  '.bbybb.',
  '...b...',
  'r..b..r',
  'rr...rr',
]

const CLICK_SPARK: Pixels = ['y..', '.y.', '...']

const MOUSE = iconOf(19, 12, 260, [
  [layer(mousePixels(false), 0, 0), layer(RETICLE, 12, 5)],
  [
    layer(mousePixels(true), 0, 0),
    layer(RETICLE_HIT, 12, 5),
    layer(CLICK_SPARK, 9, 0),
  ],
  [layer(mousePixels(false), 0, 0), layer(RETICLE, 12, 1)],
  [
    layer(mousePixels(true), 0, 0),
    layer(RETICLE_HIT, 12, 1),
    layer(CLICK_SPARK, 9, 0),
  ],
])

// THUMB STICKS

const ring = (color: string): Pixels =>
  Array.map(
    [
      '...ccccc...',
      '..c.....c..',
      '.c.......c.',
      'c.........c',
      'c.........c',
      'c.........c',
      'c.........c',
      'c.........c',
      '.c.......c.',
      '..c.....c..',
      '...ccccc...',
    ],
    row => row.replaceAll('c', color),
  )

const THUMB: Pixels = ['.hhh.', 'hhhhh', 'hhhhh', 'hhhhH', '.HHH.']

const LEFT_CHEVRON: Pixels = ['.w', 'w.', '.w']
const RIGHT_CHEVRON: Pixels = ['w.', '.w', 'w.']

const RING_SIZE = 11
const THUMB_HOME = 3

const moveStickFrame = (shift: number): ReadonlyArray<Layer> => [
  layer(ring('c'), 2, 0),
  layer(LEFT_CHEVRON, 0, 4),
  layer(RIGHT_CHEVRON, RING_SIZE + 2, 4),
  layer(THUMB, 2 + THUMB_HOME + shift, THUMB_HOME),
]

const MOVE_STICK = iconOf(15, RING_SIZE, 300, [
  moveStickFrame(0),
  moveStickFrame(-3),
  moveStickFrame(0),
  moveStickFrame(3),
])

const BULLET: Pixels = ['bb']

const aimStickFrame = (step: number): ReadonlyArray<Layer> => [
  layer(ring('y'), 0, 0),
  layer(THUMB, THUMB_HOME + 3, THUMB_HOME - 1),
  layer(BULLET, RING_SIZE + 1 + step * 2, 4),
  ...(step < 2 ? [layer(BULLET, RING_SIZE + 5 + step * 2, 4)] : []),
]

const AIM_STICK = iconOf(RING_SIZE + 9, RING_SIZE, 140, [
  aimStickFrame(0),
  aimStickFrame(1),
  aimStickFrame(2),
])

// TAP

const HAND: Pixels = [
  '...oo.....',
  '..ohho....',
  '..ohho....',
  '..ohhoooo.',
  '.oohhohhoo',
  'ohohhhhhho',
  'ohhhhhhhho',
  'ohhhhhhhho',
  '.ohhhhhhho',
  '.ohhhhhhHo',
  '..oHHHHHo.',
  '...ooooo..',
]

const TAP_RIPPLE: Pixels = ['.y..yy..y.', '..y....y..']

const TAP = iconOf(10, 15, 380, [
  [layer(HAND, 0, 3)],
  [layer(HAND, 0, 2), layer(TAP_RIPPLE, 0, 0)],
])

// THINGS

const HEART_PALETTE: Palette = { r: '#e8333a', w: '#ff8a8f', o: '#140c10' }

const HEART: Pixels = [
  '.ooo.ooo.',
  'orrrorrro',
  'orwrrrrro',
  'orrrrrrro',
  '.orrrrro.',
  '..orrro..',
  '...oro...',
  '....o....',
]

const DOWN_ARROW: Pixels = ['wwwww', '.www.', '..w..']

const GOODIE = iconOf(9, 13, 300, [
  [layer(DOWN_ARROW, 2, 0), layer(HEART, 0, 5, HEART_PALETTE)],
  [layer(DOWN_ARROW, 2, 1), layer(HEART, 0, 5, HEART_PALETTE)],
])

const DOOR: Pixels = ['fffffffffff', ...Array.makeBy(11, () => 'fdddddddddf')]

const PLANK_PALETTE = TRAP_ICON_PIXELS.Barricade.palette
const PLANK: Pixels = ['DPNPPPPPPPNPD', 'DLLLLLLLLLLLD']

const PLANK_DOOR = iconOf(13, 12, 420, [
  [layer(DOOR, 1, 0)],
  [layer(DOOR, 1, 0), layer(PLANK, 0, 3, PLANK_PALETTE)],
  [
    layer(DOOR, 1, 0),
    layer(PLANK, 0, 3, PLANK_PALETTE),
    layer(PLANK, 0, 7, PLANK_PALETTE),
  ],
  [
    layer(DOOR, 1, 0),
    layer(PLANK, 0, 3, PLANK_PALETTE),
    layer(PLANK, 0, 7, PLANK_PALETTE),
  ],
])

const FLASH: Pixels = ['.b.', 'bwb', '.b.']

const GNOME = iconOf(16, 12, 200, [
  [layer(GNOME_PIXELS, 0, 0, GNOME_PALETTE)],
  [layer(GNOME_PIXELS, 0, 0, GNOME_PALETTE), layer(FLASH, 8, 7)],
  [layer(GNOME_PIXELS, 0, 0, GNOME_PALETTE), layer(BULLET, 11, 8)],
  [layer(GNOME_PIXELS, 0, 0, GNOME_PALETTE), layer(BULLET, 14, 8)],
])

const slot = (color: string): Pixels => [
  color.repeat(11),
  ...Array.makeBy(6, () => `${color}${'.'.repeat(9)}${color}`),
  color.repeat(11),
]

const PISTOL: Pixels = ['.mmmmmm', '.mMmmmm', '.MM....', 'MM.....']
const SMG: Pixels = ['..mmmmmm.', 'mmmmmmmmm', 'm..M.....', '...M.....']

const gunsFrame = (isFirstHeld: boolean): ReadonlyArray<Layer> => [
  layer(slot(isFirstHeld ? 'y' : 'M'), 0, 0),
  layer(slot(isFirstHeld ? 'M' : 'y'), 12, 0),
  layer(PISTOL, 2, 2),
  layer(SMG, 13, 2),
]

const GUNS = iconOf(23, 8, 500, [gunsFrame(true), gunsFrame(false)])

const STALL_BODY: Pixels = [
  'rwrwrwrwrwr',
  'rwrwrwrwrwr',
  '.R.R.R.R.R.',
  '.f.......f.',
  '.f.......f.',
  '.f.......f.',
  '.f.......f.',
  'fffffffffff',
  'fYYYYYYYYYf',
  'fffffffffff',
]

const DOLLAR: Pixels = ['.yyy.', 'yy...', '.yyy.', '...yy', '.yyy.']

const STALL = iconOf(11, 11, 300, [
  [layer(STALL_BODY, 0, 1), layer(DOLLAR, 3, 3)],
  [layer(STALL_BODY, 0, 1), layer(DOLLAR, 3, 2)],
])

// HOW TO PLAY DEMOS

// NOTE: tiny looping demos for the How to play cards whose action a still
// picture cannot show: charging the Pressure Cooker and letting go, pulling
// from the Mystery Leftovers fridge, and stabbing with the knife.

const meter = (filled: number): Pixels => {
  const color = filled >= 6 ? 'r' : 'y'
  const fill = `${color.repeat(filled)}${'g'.repeat(6 - filled)}`
  return ['oooooooo', `o${fill}o`, 'oooooooo']
}

const COOKER_LID: Pixels = ['..oo..', 'oMMMMo']
const COOKER_POT: Pixels = [
  'oooooooo',
  'rmmmmmmr',
  'omMMMMmo',
  'ommmmmmo',
  '.oooooo.',
]
const STEAM: Pixels = ['w.w', '.w.']
const LID_BURST: Pixels = ['b...b', '.bwb.', '.wyw.', '.bwb.', 'b...b']

const cookerFrame = (
  filled: number,
  lid: ReadonlyArray<Layer>,
): ReadonlyArray<Layer> => [
  layer(meter(filled), 0, 0),
  layer(COOKER_POT, 0, 7),
  ...lid,
]

const CHARGE_DEMO = iconOf(18, 12, 280, [
  cookerFrame(0, [layer(COOKER_LID, 1, 5)]),
  cookerFrame(2, [layer(COOKER_LID, 1, 5)]),
  cookerFrame(4, [layer(COOKER_LID, 1, 4), layer(STEAM, 7, 3)]),
  cookerFrame(6, [layer(COOKER_LID, 2, 4), layer(STEAM, 0, 3)]),
  cookerFrame(0, [layer(COOKER_LID, 9, 3)]),
  cookerFrame(0, [layer(LID_BURST, 13, 2)]),
])

const FRIDGE_PALETTE: Palette = {
  o: '#140c10',
  k: '#d6cfa4',
  G: '#9be36a',
  g: '#4e6a2a',
}

const FRIDGE_SHUT: Pixels = [
  '.oooooooo.',
  'okkkkkkkko',
  'okkkkkkoko',
  'oooooooooo',
  'okkkkkkkko',
  'okkkkkkkko',
  'okkokkkkko',
  'okkokkkkko',
  'okkkkkkkko',
  'oooooooooo',
  '.o......o.',
]

const FRIDGE_OPEN: Pixels = [
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
  '.o.....go.',
]

const FOG: Pixels = ['.G.G', 'G.G.']

const FRIDGE_DEMO = iconOf(12, 17, 320, [
  [layer(FRIDGE_SHUT, 1, 6, FRIDGE_PALETTE)],
  [layer(FRIDGE_SHUT, 2, 6, FRIDGE_PALETTE)],
  [layer(FRIDGE_SHUT, 0, 6, FRIDGE_PALETTE)],
  [layer(FRIDGE_OPEN, 1, 6, FRIDGE_PALETTE), layer(FOG, 7, 3, FRIDGE_PALETTE)],
  [layer(FRIDGE_OPEN, 1, 6, FRIDGE_PALETTE), layer(SMG, 2, 1)],
  [layer(FRIDGE_OPEN, 1, 6, FRIDGE_PALETTE), layer(SMG, 2, 0)],
])

const KNIFE_PALETTE: Palette = { X: '#e9e3cf', R: '#a8302a' }

const KNIFE: Pixels = [
  '.......XX',
  '......XXX',
  '.....XXX.',
  '....XXX..',
  '...XXX...',
  '.RXXX....',
  '..RR.....',
  '.RRR.....',
  'RR.R.....',
]

const SWISH: Pixels = ['..ww', '.w..', 'w...', 'w...', '.w..', '..ww']

const KNIFE_DEMO = iconOf(17, 11, 240, [
  [layer(KNIFE, 0, 2, KNIFE_PALETTE)],
  [layer(KNIFE, 3, 0, KNIFE_PALETTE), layer(SWISH, 13, 2)],
  [layer(KNIFE, 1, 1, KNIFE_PALETTE)],
])

export type HelpDemo = 'Charge' | 'Fridge' | 'Knife'

export const HELP_DEMO_SPRITES: Readonly<Record<HelpDemo, HintIconSprites>> = {
  Charge: CHARGE_DEMO,
  Fridge: FRIDGE_DEMO,
  Knife: KNIFE_DEMO,
}

export const HINT_ICON_SPRITES: Readonly<Record<HintIcon, HintIconSprites>> = {
  Wasd: WASD,
  Mouse: MOUSE,
  MoveStick: MOVE_STICK,
  AimStick: AIM_STICK,
  Tap: TAP,
  KeyT: keyIcon('T'),
  KeyQ: keyIcon('Q'),
  Goodie: GOODIE,
  PlankDoor: PLANK_DOOR,
  Gnome: GNOME,
  Guns: GUNS,
  Stall: STALL,
}
