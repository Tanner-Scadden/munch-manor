import { Array, Function, Match, String } from 'effect'
import { Canvas } from 'foldkit'

import { playerSprites } from '@game/art/appearance'
import { SEAT_LOOKS } from '@game/art/seatLooks'
import { frameAt, group } from '@game/art/sprite'
import { rect } from '@game/render/drawing'
import { logoShapes } from '@game/screens/game/overlay'

import { BIG_HEAD, PALETTE } from '../zombieHead'

// THE DIRECTOR'S CARDS
//
// NOTE: the pixel art the launch video draws that the game never shows
// (RELEASE_VIDEO.md): the title slammed over the room with its drips
// running, the end card with the logo and the chomping Groaner from the app
// icon, and four players squished on a couch with their phones. Each is
// shapes on a canvas the screen's size in game pixels, drawn over the game
// by the harness view while a director shot holds the card, on the shot's
// own clock, so a card is the same picture on every render.

export type CardName = 'Title' | 'End' | 'Couch'

export type CardScreen = Readonly<{ width: number; height: number }>

const LOGO_CENTER_X = 160
const LOGO_MIDDLE_Y = 36
const MS_PER_TICK = 1000 / 60

// NOTE: the logo from the title screen, centered on (x, y), scaled about
// its middle, with shapes of its own (its drips) drawn under it, placed
// from its middle.
const logoAt = (
  x: number,
  y: number,
  scale: number,
  age: number,
  under: ReadonlyArray<Canvas.Shape> = [],
): Canvas.Shape =>
  group({
    translate: { x, y },
    scale: { x: scale, y: scale },
    shapes: [
      ...under,
      group({
        translate: { x: -LOGO_CENTER_X, y: -LOGO_MIDDLE_Y },
        shapes: logoShapes(age * MS_PER_TICK),
      }),
    ],
  })

// TITLE

const SLAM_TICKS = 7
const TITLE_SCALE_WIDE = 2
const TITLE_SCALE_UPRIGHT = 1.5
const SLAM_FROM = 3.2
const SHAKE_TICKS = 18
const SHAKE: ReadonlyArray<readonly [number, number]> = [
  [3, -2],
  [-3, 2],
  [2, 1],
  [-2, -1],
  [1, 2],
  [-1, -1],
]
const DIM = 'rgba(14, 8, 20, 0.55)'
const DRIP = '#c4232b'
const DRIP_DARK = '#8c1f24'

// NOTE: where the drips run from, as offsets from the logo's middle: the
// foot of a letter on each line, and how fast each one runs.
const DRIPS: ReadonlyArray<
  Readonly<{ x: number; y: number; speed: number; delay: number }>
> = [
  { x: -27, y: -3, speed: 0.55, delay: 0 },
  { x: -4, y: -3, speed: 0.4, delay: 6 },
  { x: 21, y: -3, speed: 0.5, delay: 3 },
  { x: -33, y: 22, speed: 0.45, delay: 2 },
  { x: -9, y: 22, speed: 0.6, delay: 8 },
  { x: 14, y: 22, speed: 0.4, delay: 4 },
  { x: 30, y: 22, speed: 0.5, delay: 10 },
]
const DRIP_MAX = 16

const dripShapes = (age: number): ReadonlyArray<Canvas.Shape> =>
  Array.flatMap(DRIPS, drip => {
    const runs = Math.max(0, age - SLAM_TICKS - drip.delay) * drip.speed
    const length = Math.min(DRIP_MAX, Math.floor(runs))
    if (length <= 0) {
      return []
    }
    const left = drip.x
    const top = drip.y
    // NOTE: a bead swells at the tip, and once the run is full it falls.
    const fall = Math.max(0, runs - DRIP_MAX)
    return [
      rect(left, top, 2, length, DRIP),
      rect(left + 1, top, 1, length, DRIP_DARK),
      rect(left - 1, top + length + Math.floor(fall * fall * 0.08), 4, 3, DRIP),
    ]
  })

const titleShapes = (
  screen: CardScreen,
  age: number,
): ReadonlyArray<Canvas.Shape> => {
  const isWide = screen.width > screen.height
  const x = screen.width / 2
  const y = isWide ? 66 : 112
  const rest = isWide ? TITLE_SCALE_WIDE : TITLE_SCALE_UPRIGHT
  const progress = Math.min(1, age / SLAM_TICKS)
  const scale = rest * (1 + (SLAM_FROM - 1) * (1 - progress) * (1 - progress))
  const [shakeX, shakeY] =
    age >= SLAM_TICKS && age < SLAM_TICKS + SHAKE_TICKS
      ? (SHAKE[(age - SLAM_TICKS) % SHAKE.length] ?? [0, 0])
      : [0, 0]
  const fade = 1 - Math.max(0, age - SLAM_TICKS) / SHAKE_TICKS
  const flash =
    age >= SLAM_TICKS && fade > 0
      ? [
          rect(
            0,
            0,
            screen.width,
            screen.height,
            `rgba(244, 241, 222, ${(0.5 * fade).toFixed(3)})`,
          ),
        ]
      : []
  return [
    rect(0, 0, screen.width, screen.height, DIM),
    group({
      translate: { x: shakeX, y: shakeY },
      shapes: [
        logoAt(Math.round(x), Math.round(y), scale, age, dripShapes(age)),
      ],
    }),
    ...flash,
  ]
}

// END CARD

const END_BACK = '#160b24'
const GLOW_RINGS: ReadonlyArray<readonly [number, string]> = [
  [92, '#1d0f30'],
  [72, '#24123a'],
  [56, PALETTE['b'] ?? '#3b2160'],
  [44, PALETTE['h'] ?? '#6d4a9a'],
  [35, PALETTE['H'] ?? '#8a62c0'],
]
const END_LOGO_SCALE = 1.6
const JAW_ROW = 15
const JAW_DROP = 2
const CHOMP_TICKS = 12

// NOTE: the app icon's Groaner head, its jaw dropping and snapping shut:
// the rows from the lower teeth down move, and the gap they leave is his
// mouth.
const headShapes = (
  left: number,
  top: number,
  scale: number,
  age: number,
): ReadonlyArray<Canvas.Shape> => {
  const isOpen = Math.floor(age / CHOMP_TICKS) % 2 === 1
  const drop = isOpen ? JAW_DROP : 0
  const mouthRow = BIG_HEAD[JAW_ROW] ?? ''
  const rows: ReadonlyArray<readonly [string, number]> = [
    ...Array.map(
      BIG_HEAD.slice(0, JAW_ROW),
      (row, y): readonly [string, number] => [row, y],
    ),
    ...Array.makeBy(drop, (gap): readonly [string, number] => [
      String.replace(/[wt]/g, 'm')(mouthRow),
      JAW_ROW + gap,
    ]),
    ...Array.map(
      BIG_HEAD.slice(JAW_ROW),
      (row, y): readonly [string, number] => [row, JAW_ROW + y + drop],
    ),
  ]
  return [
    group({
      translate: { x: left, y: top - (isOpen ? 1 : 0) },
      scale: { x: scale, y: scale },
      shapes: Array.flatMap(rows, ([row, y]) => runShapes(row, y)),
    }),
  ]
}

const runShapes = (row: string, y: number): ReadonlyArray<Canvas.Shape> => {
  const shapes: Array<Canvas.Shape> = []
  let start = 0
  for (let x = 1; x <= row.length; x++) {
    if (x === row.length || row[x] !== row[start]) {
      const fill = PALETTE[row[start] ?? '.']
      if (fill !== undefined) {
        shapes.push(rect(start, y, x - start, 1, fill))
      }
      start = x
    }
  }
  return shapes
}

const endShapes = (
  screen: CardScreen,
  age: number,
): ReadonlyArray<Canvas.Shape> => {
  const isWide = screen.width > screen.height
  // NOTE: side by side on a wide frame, the logo over the head upright.
  const headScale = 3
  const headWidth = (BIG_HEAD[0]?.length ?? 0) * headScale
  const headHeight = BIG_HEAD.length * headScale
  const headX = isWide ? 232 : screen.width / 2
  const headTop = isWide ? 26 : 116
  const logoX = isWide ? 112 : screen.width / 2
  const logoY = isWide ? 62 : 66
  const slam = Math.min(1, age / SLAM_TICKS)
  const logoScale = END_LOGO_SCALE * (1 + 1.4 * (1 - slam) * (1 - slam))
  return [
    rect(0, 0, screen.width, screen.height, END_BACK),
    ...Array.map(GLOW_RINGS, ([radius, fill]) =>
      Canvas.Circle({ x: headX, y: headTop + headHeight / 2, radius, fill }),
    ),
    ...headShapes(Math.round(headX - headWidth / 2), headTop, headScale, age),
    logoAt(Math.round(logoX), logoY, logoScale, age),
  ]
}

// COUCH

const WALL = '#2b1749'
const WALL_STRIPE = '#331c55'
const SKIRTING = '#140c10'
const FLOOR = '#4a2f22'
const FLOOR_LINE = '#3a2219'
const COUCH = '#8c1f24'
const COUCH_LIGHT = '#c4232b'
const COUCH_DARK = '#5a1418'
const OUTLINE = '#140c10'
const PHONE = '#140c10'
const PHONE_GLOW = '#9be36a'
const CHEER = '#ffd23f'
const BEAT_TICKS = 3600 / 152

type Mood = 'Tapping' | 'Flinching' | 'Cheering'

// NOTE: on the clip's beat: two beats of tapping, a flinch, then a cheer.
const moodAt = (age: number): Mood =>
  age < BEAT_TICKS * 2
    ? 'Tapping'
    : age < BEAT_TICKS * 3
      ? 'Flinching'
      : 'Cheering'

const sitterShapes = (
  seat: number,
  x: number,
  feetY: number,
  scale: number,
  age: number,
): ReadonlyArray<Canvas.Shape> => {
  const look = SEAT_LOOKS[seat % SEAT_LOOKS.length] ?? SEAT_LOOKS[0]
  const mood = moodAt(age)
  const hop = Match.value(mood).pipe(
    Match.when('Tapping', () =>
      Math.floor(age / 6 + seat) % 4 === 0 ? -1 : 0,
    ),
    Match.when('Flinching', () => 0),
    Match.when('Cheering', () =>
      Math.round(
        -Math.abs(Math.sin(((age - BEAT_TICKS * 3) / BEAT_TICKS) * Math.PI)) *
          (4 + (seat % 2)),
      ),
    ),
    Match.exhaustive,
  )
  const lean = mood === 'Flinching' ? (seat < 2 ? -1 : 1) : 0
  const facing = seat < 2 ? 'Right' : 'Left'
  const phoneY = mood === 'Cheering' ? -14 : mood === 'Flinching' ? -9 : -7
  const phoneX = facing === 'Right' ? 2 : -5
  const glow = mood === 'Flinching' ? '#ff4a4f' : PHONE_GLOW
  return [
    group({
      translate: { x: x + lean * scale, y: feetY + hop * scale },
      scale: { x: scale, y: scale },
      shapes: [
        ...frameAt(playerSprites(look).idle, Math.floor(age / 20)).Normal[
          facing
        ],
        rect(phoneX, phoneY, 3, 5, PHONE),
        rect(phoneX + 1, phoneY + 1, 1, 3, glow),
        ...(mood === 'Cheering'
          ? [rect(-1, -19 - (Math.floor(age / 4) % 2), 1, 1, CHEER)]
          : mood === 'Flinching'
            ? [rect(2, -18, 1, 2, '#f4f1de'), rect(2, -15, 1, 1, '#f4f1de')]
            : []),
      ],
    }),
  ]
}

const couchShapes = (
  screen: CardScreen,
  age: number,
): ReadonlyArray<Canvas.Shape> => {
  const isWide = screen.width > screen.height
  const scale = isWide ? 5 : 3
  const floorY = Math.round(screen.height * (isWide ? 0.88 : 0.56))
  const couchWidth = 44 * scale
  const left = Math.round(screen.width / 2 - couchWidth / 2)
  const seatY = floorY - 9 * scale
  const stripes = Array.makeBy(Math.ceil(screen.width / 16), index =>
    rect(index * 16, 0, 8, floorY, WALL_STRIPE),
  )
  const boards = Array.makeBy(4, index =>
    rect(0, floorY + 6 + index * 10, screen.width, 1, FLOOR_LINE),
  )
  const sitters = Array.flatMap([0, 1, 2, 3], seat =>
    sitterShapes(
      seat,
      left + (7 + seat * 10) * scale,
      seatY + 2 * scale,
      scale,
      age,
    ),
  )
  return [
    rect(0, 0, screen.width, floorY, WALL),
    ...stripes,
    rect(0, floorY - 3, screen.width, 3, SKIRTING),
    rect(0, floorY, screen.width, screen.height - floorY, FLOOR),
    ...boards,
    // NOTE: the couch's back, behind the four of them.
    rect(
      left - scale,
      seatY - 12 * scale,
      couchWidth + 2 * scale,
      13 * scale,
      OUTLINE,
    ),
    rect(left, seatY - 11 * scale, couchWidth, 11 * scale, COUCH),
    rect(left, seatY - 11 * scale, couchWidth, scale, COUCH_LIGHT),
    ...sitters,
    // NOTE: the seat and the arms, over their legs.
    rect(
      left - 4 * scale,
      seatY - scale,
      couchWidth + 8 * scale,
      8 * scale,
      OUTLINE,
    ),
    rect(left - 3 * scale, seatY, couchWidth + 6 * scale, 6 * scale, COUCH),
    rect(left - 3 * scale, seatY, couchWidth + 6 * scale, scale, COUCH_LIGHT),
    rect(
      left - 3 * scale,
      seatY + 5 * scale,
      couchWidth + 6 * scale,
      scale,
      COUCH_DARK,
    ),
    rect(left - 5 * scale, seatY - 6 * scale, 5 * scale, 13 * scale, OUTLINE),
    rect(
      left - 4 * scale,
      seatY - 5 * scale,
      3 * scale,
      11 * scale,
      COUCH_LIGHT,
    ),
    rect(left + couchWidth, seatY - 6 * scale, 5 * scale, 13 * scale, OUTLINE),
    rect(
      left + couchWidth + scale,
      seatY - 5 * scale,
      3 * scale,
      11 * scale,
      COUCH,
    ),
    rect(left - 2 * scale, seatY + 7 * scale, 2 * scale, 2 * scale, OUTLINE),
    rect(left + couchWidth, seatY + 7 * scale, 2 * scale, 2 * scale, OUTLINE),
  ]
}

export const cardShapes: {
  (
    screen: CardScreen,
    age: number,
  ): (card: CardName) => ReadonlyArray<Canvas.Shape>
  (card: CardName, screen: CardScreen, age: number): ReadonlyArray<Canvas.Shape>
} = Function.dual(
  3,
  (
    card: CardName,
    screen: CardScreen,
    age: number,
  ): ReadonlyArray<Canvas.Shape> =>
    Match.value(card).pipe(
      Match.when('Title', () => titleShapes(screen, age)),
      Match.when('End', () => endShapes(screen, age)),
      Match.when('Couch', () => couchShapes(screen, age)),
      Match.exhaustive,
    ),
)
