import { Array, Function, Option, Record, Result } from 'effect'

import type { Model } from '#app/model.ts'
import { type BakedText, bakeText, placeBaked } from '#art/font.ts'
import {
  ANTENNA,
  BEAM,
  BIKE,
  BONY_HAND,
  BUBBLE_HEIGHT,
  BUBBLE_TAIL,
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
} from '#art/introArt.ts'
import { type Sprite, group, placeAt } from '#art/sprite.ts'
import type { Screen } from '#render/camera/screen.ts'
import * as Draw from '#render/draw.ts'
import { FRIEND_LINES } from '#world/names.ts'
import { ARRIVAL_MS } from '#world/run/arrival.ts'
import type { Vector } from '#world/schema/worldSchema.ts'
import { lerp } from '#world/step/geometry.ts'

import {
  type IntroBeat,
  type IntroFrame,
  KNOCKS_MS,
  KNOCK_BACK_MS,
  maybeIntroFrameOf,
} from './introBeat.ts'

const NIGHT_BLACK = '#0d0816'

const scaleFor = (screen: Screen): number =>
  Math.max(
    1,
    Math.floor(
      Math.min(screen.width / PICTURE_WIDTH, screen.height / PICTURE_HEIGHT),
    ),
  )

const at = (x: number, y: number, sprite: Sprite): Draw.Shape =>
  placeAt(Math.round(x), Math.round(y), sprite)

const frameOf = <A>(
  frames: Array.NonEmptyReadonlyArray<A>,
  ms: number,
  stepMs: number,
): A => frames[Math.floor(ms / stepMs) % frames.length] ?? frames[0]

type MaybeLine = Option.Option<string>

const nonEmpty = <A>(
  items: ReadonlyArray<A>,
): Array.NonEmptyReadonlyArray<A> | undefined =>
  Array.isReadonlyArrayNonEmpty(items) ? items : undefined

const BUBBLE_PAD = 4
const EDGE = 2

const CAR_X = 58
const CAR_Y = 64

const CAR_WINDOW_X = CAR_X + 13
const DRIVE_BUBBLE_TOP = CAR_Y - BUBBLE_HEIGHT - BUBBLE_TAIL - 1

const KNOCK_BUBBLE_LEFT = 4
const KNOCK_BUBBLE_TOP = PICTURE_HEIGHT - BUBBLE_HEIGHT - BUBBLE_TAIL
const KNOCK_TAIL_X = 6

type FriendBubble = Readonly<{
  text: BakedText
  driveLeft: number
  driveBubble: Sprite
  knockBubble: Sprite
}>

const bubbleWidthOf = (text: BakedText): number => text.width + BUBBLE_PAD * 2

const friendBubble = (line: string): FriendBubble => {
  const text = bakeText(line, 'Ink')
  const width = bubbleWidthOf(text)
  const driveLeft = Math.max(
    EDGE,
    Math.min(CAR_WINDOW_X - 6, PICTURE_WIDTH - EDGE - width),
  )
  return {
    text,
    driveLeft,
    driveBubble: speechBubble({ width, tailX: CAR_WINDOW_X - driveLeft }),
    knockBubble: speechBubble({ width, tailX: KNOCK_TAIL_X }),
  }
}

const FRIEND_BUBBLES: Readonly<Record<string, FriendBubble>> =
  Record.fromEntries(
    Array.map(Array.flatten(Record.values(FRIEND_LINES)), line => [
      line,
      friendBubble(line),
    ]),
  )

export const widestFriendBubble = (): number =>
  Array.reduce(Record.values(FRIEND_BUBBLES), 0, (widest, { text }) =>
    Math.max(widest, bubbleWidthOf(text)),
  )

const bubbleOf = (maybeLine: MaybeLine): Option.Option<FriendBubble> =>
  Option.flatMap(maybeLine, line => Record.get(FRIEND_BUBBLES, line))

const bubbleShapes = (
  bubble: Sprite,
  text: BakedText,
  left: number,
  top: number,
): ReadonlyArray<Draw.Shape> => [
  at(left, top, bubble),
  placeBaked(text, { x: left + BUBBLE_PAD, y: top + 3, align: 'Left' }),
]

const DRIVE_LINE_FROM = 0.35

const isDriveLineUp = (maybeLine: MaybeLine, progress: number): boolean =>
  Option.isSome(bubbleOf(maybeLine)) && progress >= DRIVE_LINE_FROM

const driveLineShapes = (
  maybeLine: MaybeLine,
  progress: number,
  bob: number,
): ReadonlyArray<Draw.Shape> =>
  progress >= DRIVE_LINE_FROM
    ? Option.match(bubbleOf(maybeLine), {
        onNone: () => [],
        onSome: ({ text, driveLeft, driveBubble }) =>
          bubbleShapes(driveBubble, text, driveLeft, DRIVE_BUBBLE_TOP + bob),
      })
    : []

const KNOCK_LINE_FROM_MS = 100
const KNOCK_LINE_UNTIL_MS = 1_400

const knockLineShapes = (
  { cut, beatMs }: IntroFrame,
  maybeLine: MaybeLine,
): ReadonlyArray<Draw.Shape> =>
  cut === 'Short' &&
  beatMs >= KNOCK_LINE_FROM_MS &&
  beatMs < KNOCK_LINE_UNTIL_MS
    ? Option.match(bubbleOf(maybeLine), {
        onNone: () => [],
        onSome: ({ text, knockBubble }) =>
          bubbleShapes(knockBubble, text, KNOCK_BUBBLE_LEFT, KNOCK_BUBBLE_TOP),
      })
    : []

const DASH_GAP = 24
const ANTENNA_X = CAR_X + 4
const ANTENNA_RISE = 4
const STATIC_X = ANTENNA_X - 3
const STATIC_WIDTH = 6
const SIGN_WIDTH = 26

const isSignBehindStatic = (signX: number): boolean =>
  signX < STATIC_X + STATIC_WIDTH + 2 && signX + SIGN_WIDTH > STATIC_X - 2

const driveShapes = (
  { beatMs, progress }: IntroFrame,
  maybeLine: MaybeLine,
) => {
  const roll = (beatMs / 12) % DASH_GAP
  const bob = Math.floor(beatMs / 140) % 2
  const crackle = nonEmpty(RADIO_STATIC)
  const signX = lerp(170, -40, progress)
  const isCrackling =
    Math.floor(beatMs / 350) % 3 !== 2 &&
    !isSignBehindStatic(signX) &&
    !isDriveLineUp(maybeLine, progress)
  return [
    at(0, 0, DRIVE_BACKDROP),
    ...Array.makeBy(8, index => at(index * DASH_GAP - roll, 78, ROAD_DASH)),
    at(signX, 50, MANOR_SIGN),
    at(ANTENNA_X, CAR_Y - ANTENNA_RISE + bob, ANTENNA),
    at(CAR_X, CAR_Y + bob, FRIENDS_CAR),
    ...(crackle !== undefined && isCrackling
      ? [
          at(
            STATIC_X,
            CAR_Y - ANTENNA_RISE - 4 + bob,
            frameOf(crackle, beatMs, 90),
          ),
        ]
      : []),
    ...driveLineShapes(maybeLine, progress, bob),
  ]
}

const drivewayShapes = ({ progress }: IntroFrame) => [
  at(0, 0, DRIVEWAY_BACKDROP),
  at(8, 66, COUPE),
  at(36, 64, MINIVAN),
  at(140, 66, BIKE),
  at(lerp(-30, 96, Math.min(1, progress / 0.7)), 62, FRIENDS_CAR),
]

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

const DOOR_TOP = 10
const DOOR_LEFT_X = 38

const KNOCK_SHAKE_MS = 120

const isNear = (ms: number, atMs: number, spanMs: number): boolean =>
  ms >= atMs && ms < atMs + spanMs

const doorShapes = (
  shiftX: number,
  openness: number,
): ReadonlyArray<Draw.Shape> => {
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

const knockShapes = (frame: IntroFrame, maybeLine: MaybeLine) => {
  const { beatMs } = frame
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
    ...knockLineShapes(frame, maybeLine),
    ...(beatMs < KNOCK_BACK_MS - 300 ? [at(112, fistY, FIST)] : []),
    ...(dustAgeMs > 0 && dustAgeMs < 900
      ? Array.map([46, 70, 95, 110], (x, index) =>
          at(x + (index % 2), DOOR_TOP + dustAgeMs / 20 + index * 3, DUST),
        )
      : []),
  ]
}

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

const HELLO = bakeText('HELLO?', 'Ink')
const BUBBLE: Sprite = speechBubble({
  width: bubbleWidthOf(HELLO),
  tailX: 6,
})

const PLACE_CARD_AT = { x: 58, y: 45 }

const CANDLES_X: ReadonlyArray<number> = [70, 79, 88]

const helloShapes = ({ beatMs, progress }: IntroFrame) => {
  const flames = nonEmpty(FLAMES)
  const steamRise = (beatMs / 40) % 12
  return [
    at(0, 0, DINING_ROOM),
    ...Array.flatMap(CANDLES_X, (x, index) =>
      flames === undefined
        ? []
        : [at(x, 6, frameOf(flames, beatMs + index * 70, 160))],
    ),
    ...Array.map([33, 38, 114, 120], (x, index) =>
      at(x, 38 - ((steamRise + index * 4) % 12), STEAM),
    ),
    at(PLACE_CARD_AT.x, PLACE_CARD_AT.y, PLACE_CARD),
    ...(progress > 0.15
      ? [
          at(10, 66, BUBBLE),
          placeBaked(HELLO, { x: 10 + BUBBLE_PAD, y: 69, align: 'Left' }),
        ]
      : []),
  ]
}

const SLAM_SHUT_MS = 160
const SLAM_SHAKE_MS = 320
const SLAM_FLASH_MS = 70
const BOLT_AT_MS = 420
const BOLT_SLIDE_MS = 160
const SLAM_WOOD = '#3a2018'

const fullRect = (fill: string): Draw.Shape =>
  Draw.Rect({
    x: 0,
    y: 0,
    width: PICTURE_WIDTH,
    height: PICTURE_HEIGHT,
    fill,
  })

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
        Draw.Rect({
          x: 0,
          y: 0,
          width,
          height: PICTURE_HEIGHT,
          fill: SLAM_WOOD,
        }),
        Draw.Rect({
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

const BEAT_SHAPES: Readonly<
  Record<
    IntroBeat,
    (frame: IntroFrame, maybeLine: MaybeLine) => ReadonlyArray<Draw.Shape>
  >
> = {
  Drive: driveShapes,
  Driveway: drivewayShapes,
  Steps: stepsShapes,
  Knock: knockShapes,
  Coats: coatsShapes,
  Hello: helloShapes,
  Slam: slamShapes,
}

const FADE_MS = 300

const fadeOf = ({ cut, ms }: IntroFrame): number =>
  Math.min(1, Math.max(0, (ms - (ARRIVAL_MS[cut] - FADE_MS)) / FADE_MS))

const pictureOrigin = (screen: Screen, scale: number): Vector => ({
  x: Math.floor((screen.width - PICTURE_WIDTH * scale) / 2),
  y: Math.floor((screen.height - PICTURE_HEIGHT * scale) / 2),
})

const letterboxShapes = (
  screen: Screen,
  scale: number,
): ReadonlyArray<Draw.Shape> => {
  const origin = pictureOrigin(screen, scale)
  const width = PICTURE_WIDTH * scale
  const height = PICTURE_HEIGHT * scale
  return Array.filterMap(
    [
      { x: 0, y: 0, width: screen.width, height: origin.y },
      {
        x: 0,
        y: origin.y + height,
        width: screen.width,
        height: screen.height - origin.y - height,
      },
      { x: 0, y: origin.y, width: origin.x, height },
      {
        x: origin.x + width,
        y: origin.y,
        width: screen.width - origin.x - width,
        height,
      },
    ],
    bar =>
      bar.width > 0 && bar.height > 0
        ? Result.succeed(Draw.Rect({ ...bar, fill: NIGHT_BLACK }))
        : Result.failVoid,
  )
}

export const introShapes: {
  (screen: Screen): (model: Model) => ReadonlyArray<Draw.Shape>
  (model: Model, screen: Screen): ReadonlyArray<Draw.Shape>
} = Function.dual(
  2,
  (model: Model, screen: Screen): ReadonlyArray<Draw.Shape> =>
    Option.match(maybeIntroFrameOf(model), {
      onNone: () => [],
      onSome: frame => {
        const scale = scaleFor(screen)
        const fade = fadeOf(frame)
        return [
          group({
            opacity: fade > 0 ? 1 - fade : undefined,
            shapes: [
              Draw.Rect({
                x: 0,
                y: 0,
                width: screen.width,
                height: screen.height,
                fill: NIGHT_BLACK,
              }),
              group({
                translate: pictureOrigin(screen, scale),
                scale: scale === 1 ? undefined : { x: scale, y: scale },
                shapes: BEAT_SHAPES[frame.beat](frame, model.maybeCarLine),
              }),
              ...letterboxShapes(screen, scale),
            ],
          }),
        ]
      },
    }),
)
