import { Array, Option, String, pipe } from 'effect'

import { FULL_TURN } from '../../render/drawing'
import type { BoostKind } from '../../world/schema/entitySchema'
import { type Palette, type Sprite, TRANSPARENT, spriteShapes } from '../sprite'

// AURAS

// NOTE: a boost's aura says what you grabbed with no words, in the house's
// own things: brass gears ticking round a wound-up toy (the Wind-Up Key), a
// silver gleam sweeping a ring with a twinkle at the shoulders (Family
// Silver), music notes rising over sparkling footprints (Dancing Shoes), and
// a ring of hat pins circling (Hat Pins). Each is a few frames baked once
// here, laid around the player's feet, so the frame draws one image.

const AURA_WIDTH = 29
const AURA_HEIGHT = 26
const CENTER = { x: 14, y: 20 }
const RING_X = 10
const RING_Y = 4

export const AURA_FRAME_COUNT = 8
export const AURA_FRAME_MS = 90

type Point = Readonly<{ x: number; y: number }>

type Stamp = Readonly<{
  left: number
  top: number
  rows: ReadonlyArray<string>
}>

const stampAt = (point: Point, rows: ReadonlyArray<string>): Stamp => {
  const width = Option.match(Array.head(rows), {
    onNone: () => 0,
    onSome: row => row.length,
  })
  return {
    left: point.x - Math.floor(width / 2),
    top: point.y - Math.floor(rows.length / 2),
    rows,
  }
}

const pixelOf = (stamp: Stamp, x: number, y: number): Option.Option<string> =>
  x < stamp.left
    ? Option.none()
    : pipe(
        Array.get(stamp.rows, y - stamp.top),
        Option.flatMap(row => String.charAt(row, x - stamp.left)),
        Option.filter(symbol => symbol !== TRANSPARENT),
      )

const rasterOf = (stamps: ReadonlyArray<Stamp>): ReadonlyArray<string> =>
  Array.makeBy(AURA_HEIGHT, y =>
    Array.join(
      Array.makeBy(AURA_WIDTH, x =>
        Array.reduce(stamps, TRANSPARENT, (symbol, stamp) =>
          Option.getOrElse(pixelOf(stamp, x, y), () => symbol),
        ),
      ),
      '',
    ),
  )

const ringPoint = (turn: number, scale: number = 1): Point => ({
  x: CENTER.x + Math.round(Math.cos(turn * FULL_TURN) * RING_X * scale),
  y: CENTER.y + Math.round(Math.sin(turn * FULL_TURN) * RING_Y * scale),
})

const offset = (dx: number, dy: number): Point => ({
  x: CENTER.x + dx,
  y: CENTER.y + dy,
})

const FRAMES = Array.makeBy(AURA_FRAME_COUNT, frame => frame)

// NOTE: a ring of three things (gears, or pins in three colors) comes back
// to the same picture after a third of a turn, so its frames loop on that.
const THIRD_TURN = 1 / 3

const spinOf = (frame: number): number =>
  (frame / AURA_FRAME_COUNT) * THIRD_TURN

// WIND-UP KEY

const GEAR_STRAIGHT: ReadonlyArray<string> = [
  '..y..',
  '.YYY.',
  'yYoYy',
  '.YYY.',
  '..y..',
]

const GEAR_TURNED: ReadonlyArray<string> = [
  'y...y',
  '.YYY.',
  '.YoY.',
  '.YYY.',
  'y...y',
]

const GEAR_PALETTE: Palette = { Y: '#e8b84a', y: '#a8782a', o: '#3a2418' }

const gearFrame = (frame: number): ReadonlyArray<string> =>
  rasterOf(
    Array.makeBy(3, index =>
      stampAt(
        ringPoint(spinOf(frame) + index * THIRD_TURN),
        frame % 2 === 0 ? GEAR_STRAIGHT : GEAR_TURNED,
      ),
    ),
  )

// FAMILY SILVER

const RING_DOTS = 28
const GLEAM_LENGTH = 4

const TWINKLE: ReadonlyArray<ReadonlyArray<string>> = [
  [],
  ['W'],
  ['.W.', 'WSW', '.W.'],
  ['..W..', '..S..', 'WSWSW', '..S..', '..W..'],
  ['.W.', 'WSW', '.W.'],
  ['W'],
  [],
  [],
]

const twinkleAt = (frame: number): ReadonlyArray<string> =>
  Option.getOrElse(Array.get(TWINKLE, frame % TWINKLE.length), () => [])

const SILVER_PALETTE: Palette = { S: '#9aa6ba', W: '#ffffff', s: '#5e6a80' }

const silverFrame = (frame: number): ReadonlyArray<string> => {
  const gleamStart = Math.round((frame / AURA_FRAME_COUNT) * RING_DOTS)
  return rasterOf([
    ...Array.makeBy(RING_DOTS, dot => {
      const lead = (dot - gleamStart + RING_DOTS) % RING_DOTS
      return stampAt(ringPoint(dot / RING_DOTS), [
        lead < GLEAM_LENGTH ? 'W' : dot % 2 === 0 ? 'S' : 's',
      ])
    }),
    stampAt(offset(-8, -14), twinkleAt(frame)),
    stampAt(offset(8, -9), twinkleAt(frame + 4)),
  ])
}

// DANCING SHOES

const NOTE: ReadonlyArray<string> = ['.Nn', '.N.', 'NN.']
const NOTE_FADED: ReadonlyArray<string> = ['.mm', '.m.', 'mm.']

const NOTE_RISE_PX = 12

const noteAt = (frame: number, side: number): Stamp => {
  const progress = frame / AURA_FRAME_COUNT
  return stampAt(
    offset(
      side * 9 + (frame % 4 < 2 ? 0 : side),
      -4 - Math.round(progress * NOTE_RISE_PX),
    ),
    progress < 0.75 ? NOTE : NOTE_FADED,
  )
}

const FOOTPRINTS: ReadonlyArray<Point> = [
  offset(-5, 2),
  offset(4, 3),
  offset(-8, -1),
  offset(8, 0),
]

const SPARKLE: ReadonlyArray<string> = ['.p.', 'pWp', '.p.']

const sparkleAt = (frame: number) => (point: Point, index: number) =>
  stampAt(point, (frame + index * 2) % 4 < 2 ? SPARKLE : ['p'])

const DANCE_PALETTE: Palette = {
  N: '#ff8ad8',
  n: '#ffd0f0',
  m: '#a8508e',
  p: '#ff8ad8',
  W: '#ffffff',
}

const danceFrame = (frame: number): ReadonlyArray<string> =>
  rasterOf([
    ...Array.map(FOOTPRINTS, sparkleAt(frame)),
    noteAt(frame, -1),
    noteAt((frame + AURA_FRAME_COUNT / 2) % AURA_FRAME_COUNT, 1),
  ])

// HAT PINS

const PINS = 6
const PIN_HEADS: ReadonlyArray<string> = ['R', 'P', 'B']

const pinAt = (frame: number, index: number): Stamp =>
  stampAt(ringPoint(spinOf(frame) + index / PINS, 1.1), [
    Option.getOrElse(Array.get(PIN_HEADS, index % PIN_HEADS.length), () => 'R'),
    'S',
    'S',
    's',
  ])

const PIN_PALETTE: Palette = {
  R: '#ff4a4f',
  P: '#fdfbf4',
  B: '#ffd23f',
  S: '#d8dce6',
  s: '#8a90a0',
}

const pinFrame = (frame: number): ReadonlyArray<string> =>
  rasterOf(Array.makeBy(PINS, index => pinAt(frame, index)))

// SPRITES

const FRAME_PIXELS: Readonly<
  Record<BoostKind, (frame: number) => ReadonlyArray<string>>
> = {
  RapidFire: gearFrame,
  Damage: silverFrame,
  Speed: danceFrame,
  Pierce: pinFrame,
}

// NOTE: every aura frame's pixel map.
const auraPixels = (
  kind: BoostKind,
): Array.NonEmptyReadonlyArray<ReadonlyArray<string>> =>
  Array.map(FRAMES, FRAME_PIXELS[kind])

const AURA_PALETTES: Readonly<Record<BoostKind, Palette>> = {
  RapidFire: GEAR_PALETTE,
  Damage: SILVER_PALETTE,
  Speed: DANCE_PALETTE,
  Pierce: PIN_PALETTE,
}

const framesOf = (kind: BoostKind): Array.NonEmptyReadonlyArray<Sprite> =>
  Array.map(auraPixels(kind), pixels =>
    spriteShapes(pixels, AURA_PALETTES[kind], CENTER),
  )

export const AURA_SPRITES: Readonly<
  Record<BoostKind, Array.NonEmptyReadonlyArray<Sprite>>
> = {
  RapidFire: framesOf('RapidFire'),
  Damage: framesOf('Damage'),
  Speed: framesOf('Speed'),
  Pierce: framesOf('Pierce'),
}
