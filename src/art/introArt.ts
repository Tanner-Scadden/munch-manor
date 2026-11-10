import { Array } from 'effect'
import { Canvas } from 'foldkit'

import { type Sprite, TOP_LEFT, bakeShapes, spriteShapes } from './sprite'

// The intro's pictures (src/features/intro/introView.ts): each beat is a
// fixed backdrop on a 160 by 90 picture, baked once into a sprite, and a
// few small sprites the view moves over it. Goofy first, scary second: the
// night is purple, not black, and every wrong detail is half a joke.

export const PICTURE_WIDTH = 160
export const PICTURE_HEIGHT = 90

const NIGHT = '#1b1230'
const NIGHT_LOW = '#2a1d45'
const STAR = '#f4f1de'
const MOON = '#f4e7b0'
const MOON_SHADE = '#d8c88a'
const HILL = '#141020'
const GRASS = '#1f2a24'
const ROAD = '#2b2630'
const ROAD_LINE = '#c9b458'
const MANOR = '#0d0a16'
const LIT = '#ffd23f'
const STONE = '#4a4452'
const STONE_LIGHT = '#6a6274'
const STONE_DARK = '#2e2a36'
const WOOD = '#5a3424'
const WOOD_LIGHT = '#7a4a30'
const WOOD_DARK = '#3a2018'
const IRON = '#8a8494'
const HALL = '#120c14'
const WALLPAPER = '#3a1e2e'
const WALLPAPER_STRIPE = '#4a2a3a'
const CLOTH = '#e8e0cc'
const CLOTH_SHADE = '#c4b89c'
const TABLE = '#4a2a1c'

type Rect = Readonly<[x: number, y: number, w: number, h: number, c: string]>

const rects = (list: ReadonlyArray<Rect>): ReadonlyArray<Canvas.Shape> =>
  Array.map(list, ([x, y, width, height, fill]) =>
    Canvas.Rect({ x, y, width, height, fill }),
  )

const STARS: ReadonlyArray<Rect> = Array.map(
  [
    [8, 6],
    [22, 14],
    [37, 4],
    [51, 19],
    [66, 9],
    [80, 3],
    [94, 16],
    [108, 7],
    [146, 24],
    [12, 30],
    [70, 27],
    [120, 30],
  ] as const,
  ([x, y]): Rect => [x, y, 1, 1, STAR],
)

const MOON_RECTS: ReadonlyArray<Rect> = [
  [127, 6, 8, 10, MOON],
  [125, 8, 12, 6, MOON],
  [130, 9, 2, 2, MOON_SHADE],
  [133, 12, 2, 1, MOON_SHADE],
]

const SKY: ReadonlyArray<Rect> = [
  [0, 0, PICTURE_WIDTH, PICTURE_HEIGHT, NIGHT],
  [0, 40, PICTURE_WIDTH, 30, NIGHT_LOW],
  ...STARS,
  ...MOON_RECTS,
]

// THE DRIVE

// NOTE: the road at night: hills, the verge, the road with its dashes.
export const DRIVE_BACKDROP: Sprite = bakeShapes(
  rects([
    ...SKY,
    [0, 52, 40, 18, HILL],
    [30, 56, 70, 14, HILL],
    [96, 50, 64, 20, HILL],
    [0, 66, PICTURE_WIDTH, 6, GRASS],
    [0, 72, PICTURE_WIDTH, 12, ROAD],
    [0, 84, PICTURE_WIDTH, 6, GRASS],
  ]),
)

export const ROAD_DASH: Sprite = bakeShapes(rects([[0, 0, 8, 1, ROAD_LINE]]))

// NOTE: your friends' car, a red hatchback with the crew in the windows.
const CAR_PIXELS: ReadonlyArray<string> = [
  '.........RRRRRRRRRR.........',
  '........RWWWRWWWRWWR........',
  '.......RRWHWRWHWRWHWR.......',
  '..RRRRRRRRRRRRRRRRRRRRRRRR..',
  '.RRRRRRRRRRRRRRRRRRRRRRRRRY.',
  'LRRRRRRRRRRRRRRRRRRRRRRRRRYY',
  'LRRRRDDDRRRRRRRRRRRRDDDRRRR.',
  '.DDDDKKKDDDDDDDDDDDDKKKDDDD.',
  '....KKKKK..........KKKKK....',
  '.....KKK............KKK.....',
]

const CAR_PALETTE = {
  R: '#c84a3c',
  D: '#8a2e26',
  W: '#5a7a9a',
  H: '#f2c49b',
  K: '#140c10',
  Y: '#ffe066',
  L: '#ff4a4f',
}

export const FRIENDS_CAR: Sprite = spriteShapes(
  CAR_PIXELS,
  CAR_PALETTE,
  TOP_LEFT,
)

// NOTE: the road sign to the manor: an arrow and a little house, and
// something has chewed its corner. No words: the only one is HELLO?.
const SIGN_PIXELS: ReadonlyArray<string> = [
  'GGGGGGGGGGGGGGGGGGGGGGGG..',
  'GWWWWWWWWWWWWWWWWWWWWWWG..',
  'GWGGGGGGGGGGGGGGGGGGGGWGG.',
  'GWGGGGGGGGGWGGGGGGGGGGWG..',
  'GWGGGGGGGGWWWGGGGGGGGGWGG.',
  'GWGGGGGGGWWWWWGGGGWGGGWG..',
  'GWGGWWWWGWWBWWGGGGWWGGWGG.',
  'GWGGWWWWGWWBWWGWWWWWWGWG..',
  'GWGGGGGGGWWWWWGGGGWWGGW...',
  'GWGGGGGGGGGGGGGGGGWGG.....',
  'GWWWWWWWWWWWWWWWWWWG......',
  'GGGGGGGGGGGGGGGGGGG.......',
  '........PP........PP......',
  '........PP........PP......',
  '........PP........PP......',
  '........PP........PP......',
  '........PP........PP......',
  '........PP........PP......',
]

export const MANOR_SIGN: Sprite = spriteShapes(
  SIGN_PIXELS,
  { G: '#3e6b3a', W: '#f4f1de', B: '#140c10', P: '#6b4a2e' },
  TOP_LEFT,
)

// NOTE: the radio drifting into static: a crackle over the car.
const STATIC_PIXELS: ReadonlyArray<ReadonlyArray<string>> = [
  ['W.W..W', '.W.WW.', 'W..W.W'],
  ['.W..W.', 'W.WW.W', '.W..W.'],
]

export const RADIO_STATIC: ReadonlyArray<Sprite> = Array.map(
  STATIC_PIXELS,
  pixels => spriteShapes(pixels, { W: '#c9d3c0' }, TOP_LEFT),
)

// THE DRIVEWAY

// NOTE: the manor on its hill, a few windows lit, over a gravel drive.
export const DRIVEWAY_BACKDROP: Sprite = bakeShapes(
  rects([
    ...SKY,
    [0, 58, PICTURE_WIDTH, 32, HILL],
    [70, 22, 70, 40, MANOR],
    [82, 12, 14, 12, MANOR],
    [116, 8, 10, 16, MANOR],
    [64, 30, 82, 4, MANOR],
    [78, 38, 6, 6, LIT],
    [96, 38, 6, 6, MANOR],
    [114, 38, 6, 6, LIT],
    [128, 38, 6, 6, LIT],
    [86, 16, 4, 4, LIT],
    [100, 48, 10, 14, WOOD_DARK],
    [0, 66, PICTURE_WIDTH, 24, '#2a2428'],
    [0, 66, PICTURE_WIDTH, 2, '#3a3238'],
  ]),
)

// NOTE: other daredevils' cars from every decade, parked and dusty: a
// fifties coupe with fins, a nineties minivan, and a bike.
export const COUPE: Sprite = spriteShapes(
  [
    '.....TTTTTTTT..........',
    '....TWWWTWWWWT.........',
    '.TTTTTTTTTTTTTTTTTTTT..',
    'TTTTTTTTTTTTTTTTTTTTTTF',
    'SSSSSSSSSSSSSSSSSSSSSSS',
    '...KKK..........KKK....',
  ],
  { T: '#3f8f8a', W: '#2a3a4a', F: '#e8333a', S: '#c9c3b0', K: '#140c10' },
  TOP_LEFT,
)

export const MINIVAN: Sprite = spriteShapes(
  [
    '..MMMMMMMMMMMMMMMMMM.',
    '.MWWWWMWWWWMWWWWMMMM.',
    '.MWWWWMWWWWMWWWWMMMMM',
    'MMMMMMMMMMMMMMMMMMMMM',
    'MMDDDDDDDDDDDDDDDDDMM',
    'MMMMMMMMMMMMMMMMMMMMM',
    '..KKK..........KKK...',
  ],
  { M: '#bfae8a', D: '#8a7a5e', W: '#2a3a4a', K: '#140c10' },
  TOP_LEFT,
)

export const BIKE: Sprite = spriteShapes(
  [
    '......HH....',
    '.....H......',
    '..SSSFFFF...',
    '.K..F...FK..',
    'K.K..F.FK.K.',
    '.K....F..K..',
  ],
  { H: '#c9c3b0', S: '#6b4a2e', F: '#ff8a3d', K: '#140c10' },
  TOP_LEFT,
)

// THE STEPS

// NOTE: the front steps up close, the door's foot at the top.
export const STEPS_BACKDROP: Sprite = bakeShapes(
  rects([
    [0, 0, PICTURE_WIDTH, PICTURE_HEIGHT, NIGHT],
    [20, 0, 120, 30, STONE_DARK],
    [50, 0, 60, 30, WOOD_DARK],
    [79, 0, 2, 30, '#24130e'],
    [10, 30, 140, 4, STONE_LIGHT],
    [10, 34, 140, 14, STONE],
    [0, 48, PICTURE_WIDTH, 4, STONE_LIGHT],
    [0, 52, PICTURE_WIDTH, 16, STONE],
    [0, 68, PICTURE_WIDTH, 4, STONE_LIGHT],
    [0, 72, PICTURE_WIDTH, 18, STONE_DARK],
  ]),
)

// NOTE: a party hat, trampled flat. Uncle Chunk's, the run says later.
export const PARTY_HAT: Sprite = spriteShapes(
  [
    '.....Y......',
    '....PPP.....',
    '..PPYPPPP...',
    'PPPPPPPYPPPP',
    'WWWWWWWWWWWW',
  ],
  { P: '#ff5fa2', Y: '#ffd23f', W: '#f4f1de' },
  TOP_LEFT,
)

export const FLASHLIGHT: Sprite = spriteShapes(
  ['KKKKKKSY', 'KGKKKKSY', 'KKKKKKSY'],
  { K: '#2a2a30', G: '#5a5a66', S: '#8a8494', Y: '#ffe066' },
  TOP_LEFT,
)

// NOTE: the flashlight's beam on the stone, still on.
export const BEAM: Sprite = bakeShapes(
  rects([
    [0, 1, 6, 4, '#ffe06655'],
    [6, 0, 8, 6, '#ffe06644'],
    [14, -1, 10, 8, '#ffe06633'],
  ]),
)

// NOTE: footprints that go in, and none that come out.
export const FOOTPRINT: Sprite = bakeShapes(
  rects([
    [0, 0, 2, 3, '#1c1820'],
    [3, 1, 2, 3, '#1c1820'],
  ]),
)

// THE DOOR

// NOTE: the front doors, closed, with the knocker; the view shakes them on
// each knock.
export const DOOR_FRAME: Sprite = bakeShapes(
  rects([
    [0, 0, PICTURE_WIDTH, PICTURE_HEIGHT, NIGHT],
    [24, 0, 112, 90, STONE],
    [24, 0, 112, 8, STONE_LIGHT],
    [36, 8, 88, 82, STONE_DARK],
  ]),
)

export const DOOR_HALF_WIDTH = 42
const DOOR_HEIGHT = 80

const doorHalf = (isLeft: boolean): Sprite => {
  const ringX = isLeft ? DOOR_HALF_WIDTH - 9 : 4
  return bakeShapes(
    rects([
      [0, 0, DOOR_HALF_WIDTH, DOOR_HEIGHT, WOOD],
      [4, 4, DOOR_HALF_WIDTH - 8, 32, WOOD_LIGHT],
      [6, 6, DOOR_HALF_WIDTH - 12, 28, WOOD],
      [4, 42, DOOR_HALF_WIDTH - 8, 32, WOOD_LIGHT],
      [6, 44, DOOR_HALF_WIDTH - 12, 28, WOOD],
      [isLeft ? DOOR_HALF_WIDTH - 1 : 0, 0, 1, DOOR_HEIGHT, WOOD_DARK],
      [ringX, 38, 5, 1, IRON],
      [ringX, 42, 5, 1, IRON],
      [ringX, 38, 1, 5, IRON],
      [ringX + 4, 38, 1, 5, IRON],
    ]),
  )
}

export const DOOR_LEFT: Sprite = doorHalf(true)
export const DOOR_RIGHT: Sprite = doorHalf(false)

// NOTE: your knuckles, from below the picture.
export const FIST: Sprite = spriteShapes(
  ['.HHHH.', 'HHHHHH', 'HHHHHH', '.HHHH.', '..SS..', '..SS..', '..SS..'],
  { H: '#f2c49b', S: '#3e6b9a' },
  TOP_LEFT,
)

export const DUST: Sprite = bakeShapes(rects([[0, 0, 1, 1, '#8a8494']]))

// THE COAT CHECK

// NOTE: inside the doors: the coat check, a hundred years of coats nobody
// came back for, on hooks along the wall.
const COAT_COLORS: ReadonlyArray<string> = [
  '#5a3424',
  '#3e6b3a',
  '#ff8a3d',
  '#2f4a6b',
  '#6b2a4a',
  '#8a7a5e',
  '#3a3a44',
  '#c84a3c',
  '#4a5a2a',
  '#6a4a8a',
]

const COATS: ReadonlyArray<Rect> = Array.flatMap(
  COAT_COLORS,
  (color, index) => {
    const x = 40 + index * 8
    const length = 22 + ((index * 7) % 9)
    return [
      [x + 2, 24, 3, 2, IRON],
      [x, 26, 7, length, color],
      [x + 3, 26, 1, length - 4, '#00000033'],
    ]
  },
)

export const COAT_CHECK: Sprite = bakeShapes(
  rects([
    [0, 0, PICTURE_WIDTH, PICTURE_HEIGHT, HALL],
    [36, 10, 88, 60, WALLPAPER],
    ...Array.map(Array.range(0, 10), (index): Rect => [
      38 + index * 8,
      10,
      2,
      60,
      WALLPAPER_STRIPE,
    ]),
    [36, 22, 88, 2, WOOD_DARK],
    ...COATS,
    [36, 62, 88, 8, WOOD],
    [36, 62, 88, 2, WOOD_LIGHT],
    [36, 70, 88, 20, '#1c1418'],
  ]),
)

// NOTE: a bony hand waving from between the coats, in two frames.
const HAND_PIXELS: ReadonlyArray<ReadonlyArray<string>> = [
  ['B.B.B.', 'B.B.B.', 'BBBBB.', 'BBBBBB', '.BBBB.', '..BB..', '..BB..'],
  ['.B.B.B', '.B.B.B', '.BBBBB', 'BBBBBB', '.BBBB.', '..BB..', '..BB..'],
]

export const BONY_HAND: ReadonlyArray<Sprite> = Array.map(HAND_PIXELS, pixels =>
  spriteShapes(pixels, { B: '#f4f1de' }, TOP_LEFT),
)

// THE DINING ROOM

// NOTE: the table set, a feast a hundred years old and still steaming.
export const DINING_ROOM: Sprite = bakeShapes(
  rects([
    [0, 0, PICTURE_WIDTH, PICTURE_HEIGHT, HALL],
    [0, 0, PICTURE_WIDTH, 52, WALLPAPER],
    ...Array.map(Array.range(0, 19), (index): Rect => [
      4 + index * 8,
      0,
      2,
      52,
      WALLPAPER_STRIPE,
    ]),
    [62, 8, 36, 24, WOOD_DARK],
    [64, 10, 32, 20, '#3a2a4a'],
    [74, 14, 12, 12, '#2a1d35'],
    [0, 52, PICTURE_WIDTH, 38, '#2a1a14'],
    [16, 50, 128, 18, CLOTH],
    [16, 66, 128, 3, CLOTH_SHADE],
    [20, 69, 6, 16, TABLE],
    [134, 69, 6, 16, TABLE],
    [64, 44, 32, 10, '#b8742a'],
    [66, 42, 28, 4, '#d8944a'],
    [60, 52, 40, 3, '#c9c3b0'],
    [28, 52, 14, 3, '#c9c3b0'],
    [118, 52, 14, 3, '#c9c3b0'],
    [30, 48, 10, 4, '#7a9a3a'],
    [120, 48, 10, 4, '#9a3a3a'],
  ]),
)

export const CANDLE: Sprite = bakeShapes(
  rects([
    [0, 0, 3, 10, '#f4f1de'],
    [-1, 10, 5, 2, '#8a8494'],
  ]),
)

const FLAME_PIXELS: ReadonlyArray<ReadonlyArray<string>> = [
  ['.Y.', 'YOY', '.O.'],
  ['Y..', 'YOY', '.O.'],
]

export const FLAMES: ReadonlyArray<Sprite> = Array.map(FLAME_PIXELS, pixels =>
  spriteShapes(pixels, { Y: '#ffe066', O: '#ff8a3d' }, TOP_LEFT),
)

export const STEAM: Sprite = bakeShapes(
  rects([
    [0, 0, 1, 2, '#f4f1de66'],
    [1, 2, 1, 2, '#f4f1de66'],
  ]),
)

// NOTE: the place card at your seat, with your name on it: the house's
// joke. Its scrawl is a squiggle, not a word.
export const PLACE_CARD: Sprite = spriteShapes(
  ['..WWWWWWWW..', '.WWKKWKKWWW.', 'WWWWWWWWWWWW', 'SSSSSSSSSSSS'],
  { W: '#f4f1de', K: '#2a1418', S: '#c4b89c' },
  TOP_LEFT,
)

// THE SLAM

export const IRON_BOLT: Sprite = bakeShapes(
  rects([
    [0, 0, 24, 4, IRON],
    [0, 4, 24, 1, '#5a5464'],
    [20, -3, 4, 10, IRON],
  ]),
)

// NOTE: HELLO?'s speech bubble, white with a tail down to you, as wide as
// its word needs.
const BUBBLE_HEIGHT = 12

export const speechBubble = (width: number): Sprite =>
  bakeShapes(
    rects([
      [1, 0, width - 2, BUBBLE_HEIGHT, '#f4f1de'],
      [0, 1, width, BUBBLE_HEIGHT - 2, '#f4f1de'],
      [6, BUBBLE_HEIGHT, 4, 2, '#f4f1de'],
      [6, BUBBLE_HEIGHT + 2, 2, 2, '#f4f1de'],
    ]),
  )
