import { Array, Function, Option } from 'effect'
import { Canvas } from 'foldkit'

import type { Model } from '../../app/model'
import { bakeText, placeBaked } from '../../art/font'
import {
  BEAM,
  BIKE,
  BONY_HAND,
  CANDLE,
  COAT_CHECK,
  COUPE,
  DINING_ROOM,
  DOOR_FRAME,
  DOOR_HALF_WIDTH,
  DOOR_LEFT,
  DOOR_RIGHT,
  DRIVEWAY_BACKDROP,
  DRIVE_BACKDROP,
  DUST,
  FIST,
  FLAMES,
  FLASHLIGHT,
  FOOTPRINT,
  FRIENDS_CAR,
  IRON_BOLT,
  MANOR_SIGN,
  MINIVAN,
  PARTY_HAT,
  PICTURE_HEIGHT,
  PICTURE_WIDTH,
  PLACE_CARD,
  RADIO_STATIC,
  ROAD_DASH,
  STEAM,
  STEPS_BACKDROP,
  speechBubble,
} from '../../art/introArt'
import { type Sprite, group, placeAt } from '../../art/sprite'
import type { Screen } from '../../render/screen'
import { ARRIVAL_MS } from '../../world/run/arrival'
import { lerp } from '../../world/step/geometry'
import {
  type IntroBeat,
  type IntroFrame,
  KNOCKS_MS,
  KNOCK_BACK_MS,
  maybeIntroFrameOf,
} from './introBeat'

// The intro drawn (its beats are src/features/intro/introBeat.ts): each
// beat's picture, 160 by 90, scaled up by whole pixels and centered on
// the screen, landscape or portrait, over the night's own color. Nothing
// here reads the World but the arrival clock.

// NOTE: the night's own black, around the picture and behind the slam.
const NIGHT_BLACK = '#0d0816'

// NOTE: the biggest whole scale the picture fits: 2 on a landscape screen,
// 1 on a portrait one.
const scaleFor = (screen: Screen): number =>
  Math.max(
    1,
    Math.floor(
      Math.min(screen.width / PICTURE_WIDTH, screen.height / PICTURE_HEIGHT),
    ),
  )

const at = (x: number, y: number, sprite: Sprite): Canvas.Shape =>
  placeAt(Math.round(x), Math.round(y), sprite)

const frameOf = <A>(
  frames: Array.NonEmptyReadonlyArray<A>,
  ms: number,
  stepMs: number,
): A => frames[Math.floor(ms / stepMs) % frames.length] ?? frames[0]

const nonEmpty = <A>(
  items: ReadonlyArray<A>,
): Array.NonEmptyReadonlyArray<A> | undefined =>
  Array.isReadonlyArrayNonEmpty(items) ? items : undefined

// THE DRIVE

const DASH_GAP = 24

const driveShapes = ({ beatMs, progress }: IntroFrame) => {
  const roll = (beatMs / 12) % DASH_GAP
  const bob = Math.floor(beatMs / 140) % 2
  const crackle = nonEmpty(RADIO_STATIC)
  const isCrackling = Math.floor(beatMs / 350) % 3 !== 2
  return [
    at(0, 0, DRIVE_BACKDROP),
    ...Array.makeBy(8, index => at(index * DASH_GAP - roll, 78, ROAD_DASH)),
    at(lerp(170, -40, progress), 50, MANOR_SIGN),
    at(58, 64 + bob, FRIENDS_CAR),
    ...(crackle !== undefined && isCrackling
      ? [at(68, 56 + bob, frameOf(crackle, beatMs, 90))]
      : []),
  ]
}

// THE DRIVEWAY

const drivewayShapes = ({ progress }: IntroFrame) => [
  at(0, 0, DRIVEWAY_BACKDROP),
  at(8, 66, COUPE),
  at(36, 64, MINIVAN),
  at(140, 66, BIKE),
  at(lerp(-30, 96, Math.min(1, progress / 0.7)), 62, FRIENDS_CAR),
]

// THE STEPS

const FOOTPRINTS: ReadonlyArray<readonly [number, number]> = [
  [78, 82],
  [72, 74],
  [80, 64],
  [74, 56],
  [80, 44],
  [74, 36],
]

const stepsShapes = ({ beatMs }: IntroFrame) => {
  const isFlickerOff = Math.floor(beatMs / 90) % 11 === 7
  return [
    at(0, 0, STEPS_BACKDROP),
    ...Array.map(FOOTPRINTS, ([x, y]) => at(x, y, FOOTPRINT)),
    at(26, 62, PARTY_HAT),
    at(112, 58, FLASHLIGHT),
    ...(isFlickerOff ? [] : [at(120, 58, BEAM)]),
  ]
}

// THE DOOR

const DOOR_TOP = 10
const DOOR_LEFT_X = 38

const KNOCK_SHAKE_MS = 120

const isNear = (ms: number, atMs: number, spanMs: number): boolean =>
  ms >= atMs && ms < atMs + spanMs

const doorShapes = (
  shiftX: number,
  openness: number,
): ReadonlyArray<Canvas.Shape> => {
  const open = Math.round(openness * (DOOR_HALF_WIDTH - 4))
  const leftWidth = DOOR_HALF_WIDTH - open
  return [
    group({
      translate: { x: DOOR_LEFT_X + shiftX, y: DOOR_TOP },
      scale: open > 0 ? { x: leftWidth / DOOR_HALF_WIDTH, y: 1 } : undefined,
      shapes: DOOR_LEFT,
    }),
    group({
      translate: {
        x: DOOR_LEFT_X + DOOR_HALF_WIDTH * 2 - leftWidth + shiftX,
        y: DOOR_TOP,
      },
      scale: open > 0 ? { x: leftWidth / DOOR_HALF_WIDTH, y: 1 } : undefined,
      shapes: DOOR_RIGHT,
    }),
  ]
}

const knockShapes = ({ beatMs }: IntroFrame) => {
  const isKnocking = Array.some(KNOCKS_MS, atMs =>
    isNear(beatMs, atMs, KNOCK_SHAKE_MS),
  )
  const isAnswered = isNear(beatMs, KNOCK_BACK_MS, KNOCK_SHAKE_MS * 2)
  const shiftX = isAnswered
    ? (Math.floor(beatMs / 30) % 2) * 2 - 1
    : isKnocking
      ? 1
      : 0
  const fistY = isKnocking ? 54 : 70
  const dustAgeMs = beatMs - KNOCK_BACK_MS
  return [
    at(0, 0, DOOR_FRAME),
    ...doorShapes(shiftX, 0),
    ...(beatMs < KNOCK_BACK_MS - 300 ? [at(112, fistY, FIST)] : []),
    ...(dustAgeMs > 0 && dustAgeMs < 900
      ? Array.map([46, 70, 95, 110], (x, index) =>
          at(x + (index % 2), DOOR_TOP + dustAgeMs / 20 + index * 3, DUST),
        )
      : []),
  ]
}

// THE COAT CHECK

const coatsShapes = ({ beatMs, progress }: IntroFrame) => {
  const hand = nonEmpty(BONY_HAND)
  const isWaving = progress > 0.4
  return [
    at(0, 0, COAT_CHECK),
    ...(hand !== undefined && isWaving
      ? [at(98, 34, frameOf(hand, beatMs, 220))]
      : []),
    ...doorShapes(0, Math.min(1, progress / 0.4)),
  ]
}

// THE DINING ROOM

const HELLO = bakeText('HELLO?', 'Ink')
const BUBBLE_PAD = 4
const BUBBLE: Sprite = speechBubble(HELLO.width + BUBBLE_PAD * 2)

const CANDLES_X: ReadonlyArray<number> = [44, 78, 112]

const helloShapes = ({ beatMs, progress }: IntroFrame) => {
  const flames = nonEmpty(FLAMES)
  const steamRise = (beatMs / 40) % 12
  return [
    at(0, 0, DINING_ROOM),
    ...Array.flatMap(CANDLES_X, (x, index) => [
      at(x, 38, CANDLE),
      ...(flames === undefined
        ? []
        : [at(x, 34, frameOf(flames, beatMs + index * 70, 160))]),
    ]),
    ...Array.map([68, 76, 86], (x, index) =>
      at(x, 38 - ((steamRise + index * 4) % 12), STEAM),
    ),
    at(74, 56, PLACE_CARD),
    ...(progress > 0.15
      ? [
          at(10, 66, BUBBLE),
          placeBaked(HELLO, { x: 10 + BUBBLE_PAD, y: 69, align: 'Left' }),
        ]
      : []),
  ]
}

// THE SLAM

const SLAM_SHUT_MS = 160
const SLAM_SHAKE_MS = 320
const SLAM_FLASH_MS = 70
const BOLT_AT_MS = 420
const BOLT_SLIDE_MS = 160
const SLAM_WOOD = '#3a2018'

const fullRect = (fill: string): Canvas.Shape =>
  Canvas.Rect({
    x: 0,
    y: 0,
    width: PICTURE_WIDTH,
    height: PICTURE_HEIGHT,
    fill,
  })

// NOTE: the doors swing shut from both sides, the picture jumps and
// flashes as they meet, and the bolt slides across.
const slamShapes = ({ beatMs }: IntroFrame) => {
  const shut = Math.min(1, beatMs / SLAM_SHUT_MS)
  const width = Math.round((PICTURE_WIDTH / 2) * shut)
  const shake =
    beatMs >= SLAM_SHUT_MS && beatMs < SLAM_SHUT_MS + SLAM_SHAKE_MS
      ? ((Math.floor(beatMs / 25) % 3) - 1) * 2
      : 0
  const bolted = Math.min(1, Math.max(0, (beatMs - BOLT_AT_MS) / BOLT_SLIDE_MS))
  return [
    group({
      translate: { x: shake, y: 0 },
      shapes: [
        fullRect(NIGHT_BLACK),
        Canvas.Rect({
          x: 0,
          y: 0,
          width,
          height: PICTURE_HEIGHT,
          fill: SLAM_WOOD,
        }),
        Canvas.Rect({
          x: PICTURE_WIDTH - width,
          y: 0,
          width,
          height: PICTURE_HEIGHT,
          fill: SLAM_WOOD,
        }),
        ...(shut >= 1
          ? [
              at(
                lerp(PICTURE_WIDTH / 2 + 30, PICTURE_WIDTH / 2 - 12, bolted),
                42,
                IRON_BOLT,
              ),
            ]
          : []),
        ...(beatMs >= SLAM_SHUT_MS && beatMs < SLAM_SHUT_MS + SLAM_FLASH_MS
          ? [fullRect('#f4f1de')]
          : []),
      ],
    }),
  ]
}

// THE PICTURE

const BEAT_SHAPES: Readonly<
  Record<IntroBeat, (frame: IntroFrame) => ReadonlyArray<Canvas.Shape>>
> = {
  Drive: driveShapes,
  Driveway: drivewayShapes,
  Steps: stepsShapes,
  Knock: knockShapes,
  Coats: coatsShapes,
  Hello: helloShapes,
  Slam: slamShapes,
}

// NOTE: the last moment of the slam fades the whole intro out onto the room.
const FADE_MS = 300

const fadeOf = ({ cut, ms }: IntroFrame): number =>
  Math.min(1, Math.max(0, (ms - (ARRIVAL_MS[cut] - FADE_MS)) / FADE_MS))

// NOTE: the intro over the whole screen while the crew arrives; nothing
// else of the run shows under it.
export const introShapes: {
  (screen: Screen): (model: Model) => ReadonlyArray<Canvas.Shape>
  (model: Model, screen: Screen): ReadonlyArray<Canvas.Shape>
} = Function.dual(
  2,
  (model: Model, screen: Screen): ReadonlyArray<Canvas.Shape> =>
    Option.match(maybeIntroFrameOf(model), {
      onNone: () => [],
      onSome: frame => {
        const scale = scaleFor(screen)
        const fade = fadeOf(frame)
        return [
          group({
            opacity: fade > 0 ? 1 - fade : undefined,
            shapes: [
              Canvas.Rect({
                x: 0,
                y: 0,
                width: screen.width,
                height: screen.height,
                fill: NIGHT_BLACK,
              }),
              group({
                translate: {
                  x: Math.floor((screen.width - PICTURE_WIDTH * scale) / 2),
                  y: Math.floor((screen.height - PICTURE_HEIGHT * scale) / 2),
                },
                scale: scale === 1 ? undefined : { x: scale, y: scale },
                shapes: BEAT_SHAPES[frame.beat](frame),
              }),
            ],
          }),
        ]
      },
    }),
)
