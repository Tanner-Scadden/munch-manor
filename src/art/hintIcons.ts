import { Array, Function, Option, Schema, String, pipe } from 'effect'

import { textPixels } from './font'
import {
  type Palette,
  type Sprite,
  TOP_LEFT,
  bakeShapes,
  group,
  spriteRects,
} from './sprite'
import { GNOME_PALETTE, GNOME_PIXELS, TRAP_ICON_PIXELS } from './sprites/traps'

// NOTE: a hint shows instead of explaining: a small moving picture of the
// key, mouse, thumb, or thing to use, and at most three words. A part with no
// words is a picture that leads into the next part, such as the T key before
// the planks. How to play draws the same pictures (src/features/menus/pauseHelp.ts).
export const HintIcon = Schema.Literals([
  'Wasd',
  'Mouse',
  'MoveStick',
  'AimStick',
  'Tap',
  'KeyT',
  'KeyQ',
  'PlankDoor',
  'Gnome',
  'Guns',
])
export type HintIcon = typeof HintIcon.Type

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

export const hintIconFrame: {
  (ageMs: number): (self: HintIconSprites) => Sprite
  (self: HintIconSprites, ageMs: number): Sprite
} = Function.dual(
  2,
  ({ frames, frameMs }: HintIconSprites, ageMs: number): Sprite =>
    Option.getOrElse(
      Array.get(
        frames,
        Math.floor(Math.max(0, ageMs) / frameMs) % frames.length,
      ),
      () => Array.headNonEmpty(frames),
    ),
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
export const keyPixels: {
  (isPressed: boolean): (label: string) => Pixels
  (label: string, isPressed: boolean): Pixels
} = Function.dual(2, (label: string, isPressed: boolean): Pixels => {
  const width = keyWidth(label)
  const edge = `.${String.repeat(width - 2)('o')}.`
  const glyph = isPressed ? 'y' : 'w'
  const glyphRows = Array.map(
    textPixels(label),
    row => `oK${faceRow(row, 'K', glyph)}Ko`,
  )
  return isPressed
    ? [String.repeat(width)('.'), edge, ...glyphRows, edge]
    : [edge, ...glyphRows, `o${String.repeat(width - 2)('S')}o`, edge]
})

const KEY_HEIGHT = 8
const KEY_FRAME_MS = 420

const keyIcon = (label: string): HintIconSprites =>
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
    row => String.replaceAll('c', color)(row),
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
  String.repeat(11)(color),
  ...Array.makeBy(6, () => `${color}${String.repeat(9)('.')}${color}`),
  String.repeat(11)(color),
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

// HOW TO PLAY DEMOS

// NOTE: tiny looping demos for the How to play cards whose action a still
// picture cannot show: stabbing with the knife, and the dare's loop: a
// skeleton key dropping, a padlock opening the boards on a room's thing, a
// display case's lock ticking open, the dare card filling up, and walking
// out the front door in Uncle Chunk's party hat.

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

const SKELETON_KEY: Pixels = [
  '.ooo.......',
  'oyyyo......',
  'oy.Yooooooo',
  'oy.Yyyyyyyo',
  'oyyyooyoyoo',
  '.ooo..o.o..',
]

const SPARKLE: Pixels = ['..w..', '.....', 'w.y.w', '.....', '..w..']
const GROUND: Pixels = ['SSSSSSSSSSSSS']

const KEYS_DEMO = iconOf(13, 15, 260, [
  [layer(SKELETON_KEY, 1, 0), layer(GROUND, 0, 14)],
  [layer(SKELETON_KEY, 1, 4), layer(GROUND, 0, 14)],
  [layer(SKELETON_KEY, 1, 8), layer(GROUND, 0, 14)],
  [layer(SKELETON_KEY, 1, 7), layer(GROUND, 0, 14)],
  [layer(SKELETON_KEY, 1, 8), layer(SPARKLE, 8, 2), layer(GROUND, 0, 14)],
  [layer(SKELETON_KEY, 1, 8), layer(SPARKLE, 0, 1), layer(GROUND, 0, 14)],
])

const PADLOCK_SHUT: Pixels = [
  '.ooo.',
  'om.mo',
  'om.mo',
  'ooooo',
  'oyyyo',
  'oyoyo',
  'ooooo',
]

const PADLOCK_OPEN: Pixels = [
  '.ooo.',
  'om.mo',
  'om.m.',
  'om...',
  'ooooo',
  'oyyyo',
  'oyyyo',
  'ooooo',
]

const SMALL_KEY: Pixels = ['oyyoooo', 'oyyyyyo', '.oo..o.']
const STAR: Pixels = ['..y..', '.yby.', 'ybwby', '.yby.', '..y..']

const roomWithBoards = (lock: ReadonlyArray<Layer>): ReadonlyArray<Layer> => [
  layer(DOOR, 1, 0),
  layer(PLANK, 0, 3, PLANK_PALETTE),
  layer(PLANK, 0, 7, PLANK_PALETTE),
  ...lock,
]

const ROOMS_DEMO = iconOf(13, 12, 380, [
  roomWithBoards([layer(PADLOCK_SHUT, 4, 4)]),
  roomWithBoards([layer(PADLOCK_SHUT, 4, 4), layer(SMALL_KEY, 6, 9)]),
  roomWithBoards([layer(PADLOCK_OPEN, 4, 3)]),
  [layer(DOOR, 1, 0), layer(STAR, 4, 4)],
  [layer(DOOR, 1, 0), layer(STAR, 4, 3)],
])

const CASE_PALETTE: Palette = {
  ...ICON_PALETTE,
  g: '#9fd8e6',
  G: '#5b8fa3',
  k: '#3a3340',
  v: '#7ee07a',
}

const CASE_BASE: Pixels = ['fffffffffff', 'fdddddddddf', 'ff.......ff']
const CASE_GLASS: Pixels = [
  'fffffffffff',
  'fgggggggggf',
  'fgGgggggggf',
  'fgkkkkkmggf',
  'fggkkgggggf',
  'fgggkggggGf',
  'fgggggggggf',
]
const CASE_LOCK: Pixels = ['yyyyy', '.yYy.', '..y..']
const CASE_TICK: Pixels = ['....v', '...v.', 'v.v..', '.v...']
const CASE_GUN: Pixels = ['kkkkkm', '.kk...', '..k...']

const CASE_DEMO = iconOf(11, 17, 380, [
  [
    layer(CASE_LOCK, 3, 0, CASE_PALETTE),
    layer(CASE_GLASS, 0, 4, CASE_PALETTE),
    layer(CASE_BASE, 0, 11, CASE_PALETTE),
  ],
  [
    layer(CASE_TICK, 3, 0, CASE_PALETTE),
    layer(CASE_GLASS, 0, 4, CASE_PALETTE),
    layer(CASE_BASE, 0, 11, CASE_PALETTE),
  ],
  [layer(CASE_GUN, 2, 5, CASE_PALETTE), layer(CASE_BASE, 0, 11, CASE_PALETTE)],
  [
    layer(CASE_GUN, 2, 1, CASE_PALETTE),
    layer(SPARKLE, 6, 0),
    layer(CASE_BASE, 0, 11, CASE_PALETTE),
  ],
])

const LIST_PALETTE: Palette = {
  ...ICON_PALETTE,
  n: '#f4ead2',
  k: '#3a3340',
  L: '#8a5a2b',
  v: '#3fae49',
}

const DARE_CARD: Pixels = [
  'ooooooooooooo',
  'onnnnnnnnnnno',
  'onkknnrrnnYYo',
  'onkknnrrnnYYo',
  'onnnnnnnnnnno',
  'onyynnLLnnsso',
  'onyynnLLnnsso',
  'onnnnnnnnnnno',
  'ooooooooooooo',
]

const CARD_TICK: Pixels = ['...v', 'v.v.', '.v..']

const LIST_DEMO = iconOf(13, 9, 420, [
  [layer(DARE_CARD, 0, 0, LIST_PALETTE)],
  [layer(DARE_CARD, 0, 0, LIST_PALETTE), layer(CARD_TICK, 2, 2, LIST_PALETTE)],
  [
    layer(DARE_CARD, 0, 0, LIST_PALETTE),
    layer(CARD_TICK, 2, 2, LIST_PALETTE),
    layer(CARD_TICK, 6, 2, LIST_PALETTE),
  ],
  [
    layer(DARE_CARD, 0, 0, LIST_PALETTE),
    layer(CARD_TICK, 2, 2, LIST_PALETTE),
    layer(CARD_TICK, 6, 2, LIST_PALETTE),
    layer(CARD_TICK, 2, 5, LIST_PALETTE),
  ],
])

const EXIT_PALETTE: Palette = {
  ...ICON_PALETTE,
  P: '#ff5fa2',
  B: '#5b8fa3',
  n: '#fff3b0',
}

const FRONT_DOOR: Pixels = [
  'fffffff',
  'fnnnnnf',
  'fnnnnnf',
  'fnnnnnf',
  'fnnnnnf',
  'fnnnnnf',
  'fnnnnnf',
  'fnnnnnf',
  'fnnnnnf',
  'fnnnnnf',
]

const PARTY_HAT: Pixels = ['..y..', '.PPP.', 'PPyPP']
const WALKER: Pixels = ['.hh.', '.hh.', 'BBBB', '.BB.', '.d.d']
const WALKER_STEP: Pixels = ['.hh.', '.hh.', 'BBBB', '.BB.', 'd..d']

const walking = (x: number, isStepping: boolean): ReadonlyArray<Layer> => [
  layer(isStepping ? WALKER_STEP : WALKER, x, 6, EXIT_PALETTE),
  layer(PARTY_HAT, x - 1, 3, EXIT_PALETTE),
]

const EXIT_DEMO = iconOf(18, 12, 260, [
  [layer(FRONT_DOOR, 11, 1, EXIT_PALETTE), ...walking(1, false)],
  [layer(FRONT_DOOR, 11, 1, EXIT_PALETTE), ...walking(4, true)],
  [layer(FRONT_DOOR, 11, 1, EXIT_PALETTE), ...walking(7, false)],
  [layer(FRONT_DOOR, 11, 1, EXIT_PALETTE), ...walking(11, true)],
  [layer(FRONT_DOOR, 11, 1, EXIT_PALETTE), layer(SPARKLE, 12, 3)],
])

export type HelpDemo = 'Knife' | 'Keys' | 'Rooms' | 'Case' | 'List' | 'Exit'

export const HELP_DEMO_SPRITES: Readonly<Record<HelpDemo, HintIconSprites>> = {
  Knife: KNIFE_DEMO,
  Keys: KEYS_DEMO,
  Rooms: ROOMS_DEMO,
  Case: CASE_DEMO,
  List: LIST_DEMO,
  Exit: EXIT_DEMO,
}

export const HINT_ICON_SPRITES: Readonly<Record<HintIcon, HintIconSprites>> = {
  Wasd: WASD,
  Mouse: MOUSE,
  MoveStick: MOVE_STICK,
  AimStick: AIM_STICK,
  Tap: TAP,
  KeyT: keyIcon('T'),
  KeyQ: keyIcon('Q'),
  PlankDoor: PLANK_DOOR,
  Gnome: GNOME,
  Guns: GUNS,
}
