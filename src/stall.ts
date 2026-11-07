import { Array, Function, Option } from 'effect'
import { Canvas } from 'foldkit'

import { COUNTER_LINES } from './ammoCounter'
import { PARLOUR } from './arena'
import {
  COIN_SPRITE,
  COIN_WIDTH,
  GLYPH_HEIGHT,
  GLYPH_SPRITES,
  type TextTone,
  bakeText,
  placeBaked,
  textPixels,
} from './font'
import { STALL_BOX, type StallPrompt } from './shop'
import {
  AWAKE_FACE,
  BLINK_FACE,
  RATTLES_PALETTE,
  rattlesPixels,
} from './shopkeeper'
import {
  type Palette,
  type Sprite,
  TOP_LEFT,
  bakeShapes,
  group,
  placeAt,
  spriteRects,
  spriteShapes,
} from './sprite'
import { AMMO_BOX } from './stallBubble'

// PALETTE

const POST_COLOR = '#4a2f1c'
const AWNING_RED = '#c8343c'
const AWNING_CREAM = '#f2e6c8'
const COUNTER_TOP_COLOR = '#b8813f'
const COUNTER_EDGE_COLOR = '#d9a25a'
const COUNTER_FRONT_COLOR = '#6b4423'
const COUNTER_SEAM_COLOR = '#4f311a'
const OPEN_BOARD_COLOR = '#f2e6c8'
const OPEN_BOARD_EDGE_COLOR = '#8a5a2b'
const OPEN_LETTER_COLOR = '#c8343c'
const CLOSED_BOARD_COLOR = '#2b2233'
const CLOSED_BOARD_EDGE_COLOR = '#140f18'
const CLOSED_LETTER_COLOR = '#8f8a99'
const AMMO_LETTER_COLOR = '#ffd23f'
const STALL_SHADOW_COLOR = 'rgba(0, 0, 0, 0.35)'

const AWAKE_FRAME_MS = 280
const AWAKE_FRAMES = 8
const BLINK_FRAME = 7
const SLEEP_FRAME_MS = 900
const SNORE_RISE_PX = 5
const SNORE_CYCLE_MS = 1800
const BEACON_BOB_MS = 500
const WAVE_FRAME_MS = 220
const GLOW_CYCLE_MS = 1400
const GLOW_MIN_OPACITY = 0.3
const GLOW_MAX_OPACITY = 0.9
const GLOW_COLOR = '#ffe066'
const BONE_COLOR = '#f4f1de'
const ARROW_PALETTE: Palette = { o: '#5a3510', y: '#ffd23f' }

const rect = (
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
): Canvas.Shape => Canvas.Rect({ x, y, width, height, fill })

const { left, top } = STALL_BOX
const width = STALL_BOX.right - STALL_BOX.left
const height = STALL_BOX.bottom - STALL_BOX.top
const centerX = left + Math.floor(width / 2)

// BACK

const AWNING_TOP = top - 15
const AWNING_HEIGHT = 5
const AWNING_OVERHANG = 2
const AWNING_STRIPE = 3
const AWNING_WIDTH = width + AWNING_OVERHANG * 2
const POST_TOP = top - 10

const AWNING: ReadonlyArray<Canvas.Shape> = [
  rect(
    left - AWNING_OVERHANG,
    AWNING_TOP,
    AWNING_WIDTH,
    AWNING_HEIGHT,
    AWNING_CREAM,
  ),
  ...Array.makeBy(Math.ceil(AWNING_WIDTH / (AWNING_STRIPE * 2)), index =>
    rect(
      left - AWNING_OVERHANG + index * AWNING_STRIPE * 2,
      AWNING_TOP,
      Math.min(AWNING_STRIPE, AWNING_WIDTH - index * AWNING_STRIPE * 2),
      AWNING_HEIGHT + 1,
      AWNING_RED,
    ),
  ),
  rect(left - AWNING_OVERHANG, AWNING_TOP, AWNING_WIDTH, 1, AWNING_RED),
]

const STALL_SHADOW = rect(
  left + 2,
  top + height,
  width - 2,
  2,
  STALL_SHADOW_COLOR,
)

const STALL_BACK: ReadonlyArray<Canvas.Shape> = [
  rect(left, POST_TOP, 2, height + 6, POST_COLOR),
  rect(left + width - 2, POST_TOP, 2, height + 6, POST_COLOR),
]

// SHOPKEEPER

const SHOPKEEPER_WIDTH = 9
const SHOPKEEPER_LEFT = centerX - Math.floor(SHOPKEEPER_WIDTH / 2)
const SHOPKEEPER_TOP = top - 8

const SHOPKEEPER_AWAKE: Sprite = spriteShapes(
  rattlesPixels(AWAKE_FACE),
  RATTLES_PALETTE,
  TOP_LEFT,
)

const SHOPKEEPER_BLINK: Sprite = spriteShapes(
  rattlesPixels(BLINK_FACE),
  RATTLES_PALETTE,
  TOP_LEFT,
)

const LEFT_HAND = rect(left + 3, top + 5, 3, 2, BONE_COLOR)
const RIGHT_HAND = rect(left + width - 6, top + 5, 3, 2, BONE_COLOR)
const BONY_HANDS: ReadonlyArray<Canvas.Shape> = [LEFT_HAND, RIGHT_HAND]

const WAVE_ARM_X = SHOPKEEPER_LEFT + SHOPKEEPER_WIDTH + 1

const WAVING_HANDS: ReadonlyArray<ReadonlyArray<Canvas.Shape>> = [
  [
    LEFT_HAND,
    rect(WAVE_ARM_X, top - 3, 1, 5, BONE_COLOR),
    rect(WAVE_ARM_X - 1, top - 6, 3, 3, BONE_COLOR),
  ],
  [
    LEFT_HAND,
    rect(WAVE_ARM_X, top - 3, 1, 5, BONE_COLOR),
    rect(WAVE_ARM_X + 1, top - 7, 3, 3, BONE_COLOR),
  ],
]

// ENTRANCE

const ZONE_SIDE_GAP = 8
const ZONE_TOP = AWNING_TOP - 3
const ZONE_LEFT = left - ZONE_SIDE_GAP
const ZONE_RIGHT = STALL_BOX.right + ZONE_SIDE_GAP - 1
const ZONE_BOTTOM = STALL_BOX.bottom

const ENTRANCE_GLOW: ReadonlyArray<Canvas.Shape> = [
  rect(ZONE_LEFT, ZONE_TOP, 1, ZONE_BOTTOM - ZONE_TOP, GLOW_COLOR),
  rect(ZONE_RIGHT, ZONE_TOP, 1, ZONE_BOTTOM - ZONE_TOP, GLOW_COLOR),
  rect(ZONE_LEFT, ZONE_TOP, ZONE_RIGHT - ZONE_LEFT + 1, 1, GLOW_COLOR),
]

const glowShapes = (elapsedMs: number): ReadonlyArray<Canvas.Shape> => {
  const pulse = (1 - Math.cos((Math.PI * 2 * elapsedMs) / GLOW_CYCLE_MS)) / 2
  return [
    group({
      opacity:
        Math.round(
          (GLOW_MIN_OPACITY + (GLOW_MAX_OPACITY - GLOW_MIN_OPACITY) * pulse) *
            20,
        ) / 20,
      shapes: ENTRANCE_GLOW,
    }),
  ]
}

// COUNTER

const COUNTER: ReadonlyArray<Canvas.Shape> = [
  rect(left, top + 6, width, 3, COUNTER_TOP_COLOR),
  rect(left, top + 6, width, 1, COUNTER_EDGE_COLOR),
  rect(left, top + 9, width, height - 9, COUNTER_FRONT_COLOR),
  rect(left, top + height - 2, width, 1, COUNTER_SEAM_COLOR),
]

const SIGN_TOP = top + 10
const SIGN_PADDING = 2

const signShapes = (
  text: string,
  board: string,
  edge: string,
  letters: string,
): ReadonlyArray<Canvas.Shape> => {
  const pixels = textPixels(text)
  const textWidth = Math.max(...Array.map(pixels, row => row.length))
  const boardWidth = textWidth + SIGN_PADDING * 2
  const boardLeft = centerX - Math.floor(boardWidth / 2)
  const boardHeight = pixels.length + SIGN_PADDING * 2
  return [
    rect(boardLeft - 1, SIGN_TOP - 1, boardWidth + 2, boardHeight + 2, edge),
    rect(boardLeft, SIGN_TOP, boardWidth, boardHeight, board),
    group({
      translate: { x: boardLeft + SIGN_PADDING, y: SIGN_TOP + SIGN_PADDING },
      shapes: spriteRects(pixels, { '#': letters }, TOP_LEFT),
    }),
  ]
}

const OPEN_SIGN = signShapes(
  'SHOP',
  OPEN_BOARD_COLOR,
  OPEN_BOARD_EDGE_COLOR,
  OPEN_LETTER_COLOR,
)

const CLOSED_SIGN = signShapes(
  'CLOSED',
  CLOSED_BOARD_COLOR,
  CLOSED_BOARD_EDGE_COLOR,
  CLOSED_LETTER_COLOR,
)

// SCENE

// NOTE: the stall's back, and its counter, hands, sign, and awning in front
// of the shopkeeper, never move, so each look's front is baked into one
// image. Only the waving hand changes, so it has a front for each wave frame.
const STALL_BACK_IMAGE = bakeShapes(STALL_BACK)

const OPEN_FRONT = bakeShapes([
  ...COUNTER,
  ...BONY_HANDS,
  ...OPEN_SIGN,
  ...AWNING,
])

const CLOSED_FRONT = bakeShapes([...COUNTER, ...CLOSED_SIGN, ...AWNING])

// NOTE: mid-wave the CLOSED sign becomes the ammo window's (src/
// ammoCounter.ts): Rattles dozes behind it until a player steps up, then
// wakes with his hands on the counter.
const AMMO_SIGN = signShapes(
  'AMMO',
  CLOSED_BOARD_COLOR,
  CLOSED_BOARD_EDGE_COLOR,
  AMMO_LETTER_COLOR,
)

const COUNTER_ASLEEP_FRONT = bakeShapes([...COUNTER, ...AMMO_SIGN, ...AWNING])

const COUNTER_AWAKE_FRONT = bakeShapes([
  ...COUNTER,
  ...BONY_HANDS,
  ...AMMO_SIGN,
  ...AWNING,
])

const BECKONING_FRONTS: ReadonlyArray<ReadonlyArray<Canvas.Shape>> = Array.map(
  WAVING_HANDS,
  hands => bakeShapes([...COUNTER, ...hands, ...OPEN_SIGN, ...AWNING]),
)

const beckoningFront = (elapsedMs: number): ReadonlyArray<Canvas.Shape> =>
  Option.getOrElse(
    Array.get(
      BECKONING_FRONTS,
      Math.floor(elapsedMs / WAVE_FRAME_MS) % BECKONING_FRONTS.length,
    ),
    () => OPEN_FRONT,
  )

const awakeShopkeeper = (elapsedMs: number): ReadonlyArray<Canvas.Shape> => {
  const frame = Math.floor(elapsedMs / AWAKE_FRAME_MS) % AWAKE_FRAMES
  return [
    placeAt(
      SHOPKEEPER_LEFT,
      SHOPKEEPER_TOP + (frame < AWAKE_FRAMES / 2 ? 0 : 1),
      frame === BLINK_FRAME ? SHOPKEEPER_BLINK : SHOPKEEPER_AWAKE,
    ),
  ]
}

const SLEEP_SINK_PX = 5

const sleepingShopkeeper = (elapsedMs: number): ReadonlyArray<Canvas.Shape> => {
  const breath = Math.floor(elapsedMs / SLEEP_FRAME_MS) % 2
  const snore = (elapsedMs % SNORE_CYCLE_MS) / SNORE_CYCLE_MS
  return [
    placeAt(
      SHOPKEEPER_LEFT,
      SHOPKEEPER_TOP + SLEEP_SINK_PX + breath,
      SHOPKEEPER_BLINK,
    ),
    group({
      translate: {
        x: SHOPKEEPER_LEFT + SHOPKEEPER_WIDTH + 1,
        y: Math.round(top - 4 - snore * SNORE_RISE_PX),
      },
      opacity: 1 - snore,
      shapes: GLYPH_SPRITES.Damage.Z,
    }),
  ]
}

const ARROW: Sprite = spriteShapes(
  ['.ooooo.', '.oyyyo.', 'ooyyyoo', 'oyyyyyo', '.oyyyo.', '..oyo..', '...o...'],
  ARROW_PALETTE,
  TOP_LEFT,
)

const ARROW_TOP = AWNING_TOP - 9
const BEACON_COIN_TOP = ARROW_TOP - 9
const BEACON_LEFT = centerX - Math.floor(COIN_WIDTH / 2)

const beaconShapes = (elapsedMs: number): ReadonlyArray<Canvas.Shape> => {
  const bob = Math.round(
    Math.sin((Math.PI * 2 * elapsedMs) / (BEACON_BOB_MS * 2)) * 2,
  )
  return [
    placeAt(BEACON_LEFT, BEACON_COIN_TOP + bob, COIN_SPRITE),
    placeAt(BEACON_LEFT, ARROW_TOP + bob, ARROW),
  ]
}

// PROMPT

const PROMPT_GAP = 3
const PROMPT_Y = BEACON_COIN_TOP - PROMPT_GAP - GLYPH_HEIGHT
const PROMPT_EDGE = 3

const bakePrompt = (text: string, tone: TextTone) => {
  const baked = bakeText(text, tone)
  return placeBaked(baked, {
    x: Math.min(
      centerX,
      PARLOUR.width - PROMPT_EDGE - Math.ceil(baked.width / 2),
    ),
    y: PROMPT_Y,
    align: 'Center',
  })
}

const PROMPTS: Readonly<Record<Exclude<StallPrompt, 'None'>, Canvas.Shape>> = {
  WalkUp: bakePrompt('BUMP THE STALL TO SHOP', 'Prompt'),
  ClosedUntilFirstClear: bakePrompt('OPENS AFTER WAVE 1', 'Hint'),
}

export const stallPromptShapes = (
  prompt: StallPrompt,
): ReadonlyArray<Canvas.Shape> => (prompt === 'None' ? [] : [PROMPTS[prompt]])

export type StallLook =
  | 'Open'
  | 'Beckoning'
  | 'Closed'
  | 'Counter'
  | 'CounterAwake'

export const STALL_FOOT_Y = STALL_BOX.bottom

export const stallGroundShapes: {
  (elapsedMs: number): (look: StallLook) => ReadonlyArray<Canvas.Shape>
  (look: StallLook, elapsedMs: number): ReadonlyArray<Canvas.Shape>
} = Function.dual(
  2,
  (look: StallLook, elapsedMs: number): ReadonlyArray<Canvas.Shape> =>
    look === 'Beckoning'
      ? [...glowShapes(elapsedMs), STALL_SHADOW]
      : [STALL_SHADOW],
)

export const stallShapes: {
  (elapsedMs: number): (look: StallLook) => ReadonlyArray<Canvas.Shape>
  (look: StallLook, elapsedMs: number): ReadonlyArray<Canvas.Shape>
} = Function.dual(
  2,
  (look: StallLook, elapsedMs: number): ReadonlyArray<Canvas.Shape> => {
    if (look === 'Closed') {
      return [
        ...STALL_BACK_IMAGE,
        ...sleepingShopkeeper(elapsedMs),
        ...CLOSED_FRONT,
      ]
    } else if (look === 'Counter') {
      return [
        ...STALL_BACK_IMAGE,
        ...sleepingShopkeeper(elapsedMs),
        ...COUNTER_ASLEEP_FRONT,
      ]
    } else if (look === 'CounterAwake') {
      return [
        ...STALL_BACK_IMAGE,
        ...awakeShopkeeper(elapsedMs),
        ...COUNTER_AWAKE_FRONT,
      ]
    } else {
      const isBeckoning = look === 'Beckoning'
      return [
        ...STALL_BACK_IMAGE,
        ...awakeShopkeeper(elapsedMs),
        ...(isBeckoning ? beckoningFront(elapsedMs) : OPEN_FRONT),
        ...(isBeckoning ? beaconShapes(elapsedMs) : []),
      ]
    }
  },
)

// THE AMMO WINDOW'S SALE

// NOTE: after a sale Rattles slides a box of rounds across the counter top
// toward the player, and says his line over the stall.
const SLIDE_MS = 360
const SLIDE_FROM_X = centerX - 10
const SLIDE_TO_X = centerX + 3
const SLIDE_Y = top - 1
const LINE_Y = top - 26
const LINE_EDGE = 3

const COUNTER_LINE_TEXTS: ReadonlyArray<Canvas.Shape> = Array.map(
  COUNTER_LINES,
  line => {
    const baked = bakeText(line, 'Prompt')
    return placeBaked(baked, {
      x: Math.min(
        centerX,
        PARLOUR.width - LINE_EDGE - Math.ceil(baked.width / 2),
      ),
      y: LINE_Y,
      align: 'Center',
    })
  },
)

export const counterSaleShapes: {
  (line: number): (ageMs: number) => ReadonlyArray<Canvas.Shape>
  (ageMs: number, line: number): ReadonlyArray<Canvas.Shape>
} = Function.dual(
  2,
  (ageMs: number, line: number): ReadonlyArray<Canvas.Shape> => {
    const share = Math.min(1, ageMs / SLIDE_MS)
    const eased = 1 - (1 - share) * (1 - share)
    return [
      placeAt(
        Math.round(SLIDE_FROM_X + (SLIDE_TO_X - SLIDE_FROM_X) * eased),
        SLIDE_Y,
        AMMO_BOX,
      ),
      ...Option.toArray(Array.get(COUNTER_LINE_TEXTS, line)),
    ]
  },
)
