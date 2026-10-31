import { Array, Option, Result, pipe } from 'effect'
import { Canvas } from 'foldkit'

import { type Camera, viewBoxOf, viewToWorld, worldToView } from './camera'
import { rect } from './drawing'
import { type BakedText, bakeText, placeBaked } from './font'
import {
  type DoorReveal,
  REVEAL_RULES,
  type Rarity,
  doorRevealOf,
  prizeSpotOf,
  revealOf,
  revealStageAt,
} from './fridgeReveal'
import { ZERO_VECTOR, clamp } from './geometry'
import { HUD_STRIP_HEIGHT, gunSlotBox } from './hud'
import { DUD_REFUND, FRIDGE_RULES } from './leftovers'
import { type FridgePrize, type Model, PrizeFlight, type Vector } from './model'
import { maybePlayerAt } from './party'
import type { Screen } from './screen'
import {
  type Sprite,
  bakeShapes,
  group,
  placeAt,
  placeScaled,
  spriteShapes,
} from './sprite'
import { gunIcon } from './sprites/guns'
import { heldSlotOf } from './weapons'

// What a fridge pull looks like (src/fridgeReveal.ts), drawn on the overlay
// over the actors and the HUD strip so the prize is never lost behind a
// zombie: the spin in the doorway, the landing's burst in the prize's
// color, the big icon popping with squash and stretch, its punch word, the
// countdown ring while a weapon waits, and the icon flying into its HUD
// slot once taken.

// THE PRIZES

const SANDWICH: Sprite = spriteShapes(
  ['.kkkkkk.', 'kyyyyyyk', 'kgGrgGgk', 'kyyyyyyk', '.kkkkkk.'],
  { k: '#140c10', y: '#e0c070', g: '#7aa04a', G: '#4e6a2a', r: '#c8343c' },
)

const FISH_BONES: Sprite = spriteShapes(
  ['k.......kk.', 'kk.w.w.kwwk', '.wwwwwwwwkw', 'kk.w.w.kwwk', 'k.......kk.'],
  { k: '#140c10', w: '#e8e2cc' },
)

const prizeSprite = (prize: FridgePrize): Sprite =>
  prize === 'Sandwich'
    ? SANDWICH
    : prize === 'Dud'
      ? FISH_BONES
      : gunIcon(prize, 0)

// THE COLORS

type RarityLook = Readonly<{ ray: string; ring: string }>

const RARITY_LOOKS: Readonly<Record<Rarity, RarityLook>> = {
  Common: { ray: '#ffe066', ring: '#ffd23f' },
  Rare: { ray: '#8fe3ff', ring: '#d8f6ff' },
  Snack: { ray: '#9be36a', ring: '#c8f59a' },
  Dud: { ray: '#8a8a96', ring: '#6e6e78' },
}

const PUNCH_TONES = {
  Cooker: 'Fresh',
  Pan: 'Plain',
  Freeze: 'Victory',
  Sandwich: 'Title',
  Dud: 'Hint',
} as const

const PUNCH_TEXTS: Readonly<Record<FridgePrize, BakedText>> = {
  Cooker: bakeText(revealOf('Cooker').punchLine, PUNCH_TONES.Cooker),
  Pan: bakeText(revealOf('Pan').punchLine, PUNCH_TONES.Pan),
  Freeze: bakeText(revealOf('Freeze').punchLine, PUNCH_TONES.Freeze),
  Sandwich: bakeText(revealOf('Sandwich').punchLine, PUNCH_TONES.Sandwich),
  Dud: bakeText(revealOf('Dud').punchLine, PUNCH_TONES.Dud),
}

const REFUND_TEXT: BakedText = bakeText(`$${DUD_REFUND}`, 'Coin')

// NOTE: a burst of rays round the landed prize, in two turns that take
// turns so it twinkles; the dud gets a sad grey cloud instead.
const RAY_COUNT = 8
const RAY_INNER_PX = 7
const RAY_OUTER_PX = 11

const raySprite = (color: string, turn: number): Sprite =>
  bakeShapes(
    Array.flatMap(
      Array.makeBy(RAY_COUNT, index => index),
      index => {
        const angle = ((index + turn) / RAY_COUNT) * Math.PI * 2
        const reach = index % 2 === 0 ? RAY_OUTER_PX : RAY_OUTER_PX - 2
        return Array.makeBy(reach - RAY_INNER_PX + 1, step => {
          const distance = RAY_INNER_PX + step
          return rect(
            Math.round(Math.sin(angle) * distance),
            Math.round(-Math.cos(angle) * distance),
            1,
            1,
            color,
          )
        })
      },
    ),
  )

// NOTE: the spin's reel window: a dark slot with a gold rim, the faces
// flicking past a pale glow inside it.
const REEL_WINDOW: Sprite = bakeShapes([
  rect(-13, -8, 26, 16, '#140c10'),
  rect(-12, -7, 24, 14, '#e0b040'),
  rect(-11, -6, 22, 12, '#2a1a10'),
  rect(-12, -1, 1, 2, '#140c10'),
  rect(11, -1, 1, 2, '#140c10'),
])

const GLOW_DISC: Sprite = bakeShapes([
  rect(-10, -4, 20, 8, 'rgba(255, 250, 230, 0.3)'),
  rect(-8, -5, 16, 10, 'rgba(255, 250, 230, 0.2)'),
])

const DUD_CLOUD: Sprite = spriteShapes(
  [
    '...gggg.......',
    '.ggGGGGgg.ggg.',
    'gGGGGGGGGgGGGg',
    'gGGGGGGGGGGGGg',
    '.gggGGGGGGggg.',
    '....gggggg....',
  ],
  { g: '#5a5a64', G: '#8a8a96' },
)

type RaySet = Readonly<{ turns: readonly [Sprite, Sprite] }>

const RAYS: Readonly<Record<Rarity, RaySet>> = {
  Common: {
    turns: [
      raySprite(RARITY_LOOKS.Common.ray, 0),
      raySprite(RARITY_LOOKS.Common.ray, 0.5),
    ],
  },
  Rare: {
    turns: [raySprite(RARITY_LOOKS.Rare.ray, 0), raySprite('#ffd23f', 0.5)],
  },
  Snack: {
    turns: [
      raySprite(RARITY_LOOKS.Snack.ray, 0),
      raySprite(RARITY_LOOKS.Snack.ray, 0.5),
    ],
  },
  Dud: { turns: [DUD_CLOUD, DUD_CLOUD] },
}

const RAY_TWINKLE_MS = 120

// THE COUNTDOWN

// NOTE: a ring round a weapon on offer that empties as its time runs out,
// in its rarity's color, and blinks near the end.
const COUNTDOWN_RADIUS = 11
const COUNTDOWN_STEPS = 16

type RingPixel = Readonly<{ x: number; y: number; turn: number }>

const COUNTDOWN_PIXELS: ReadonlyArray<RingPixel> = pipe(
  Array.makeBy(COUNTDOWN_RADIUS * 2 + 1, row => row - COUNTDOWN_RADIUS),
  Array.flatMap(dy =>
    Array.filterMap(
      Array.makeBy(
        COUNTDOWN_RADIUS * 2 + 1,
        column => column - COUNTDOWN_RADIUS,
      ),
      (dx): Result.Result<RingPixel, void> => {
        const distance = Math.hypot(dx, dy)
        const angle = Math.atan2(dx, -dy)
        return distance >= COUNTDOWN_RADIUS - 0.5 &&
          distance <= COUNTDOWN_RADIUS + 0.5
          ? Result.succeed({
              x: dx,
              y: dy,
              turn: (angle < 0 ? angle + Math.PI * 2 : angle) / (Math.PI * 2),
            })
          : Result.failVoid
      },
    ),
  ),
)

const countdownSprite = (color: string, filled: number): Sprite =>
  bakeShapes(
    Array.map(COUNTDOWN_PIXELS, ({ x, y, turn }) =>
      rect(x, y, 1, 1, turn < filled ? color : 'rgba(20, 12, 16, 0.55)'),
    ),
  )

const countdownSet = (color: string): Array.NonEmptyReadonlyArray<Sprite> => [
  countdownSprite(color, 0),
  ...Array.makeBy(COUNTDOWN_STEPS, step =>
    countdownSprite(color, (step + 1) / COUNTDOWN_STEPS),
  ),
]

const COUNTDOWNS: Readonly<
  Record<'Common' | 'Rare', Array.NonEmptyReadonlyArray<Sprite>>
> = {
  Common: countdownSet(RARITY_LOOKS.Common.ring),
  Rare: countdownSet(RARITY_LOOKS.Rare.ring),
}

const OFFER_BOB_MS = 300
const OFFER_BLINK_MS = 120
const OFFER_WARN_MS = 1500

// THE POP

// NOTE: the prize is drawn twice its size. On landing it squashes wide,
// stretches tall, and settles, all within `popMs`.
const PRIZE_SCALE = 2

const popScale = (sinceMs: number): Readonly<{ x: number; y: number }> => {
  const share = sinceMs / REVEAL_RULES.popMs
  if (share < 1 / 3) {
    return { x: 2.8, y: 1.3 }
  } else if (share < 2 / 3) {
    return { x: 1.7, y: 2.6 }
  } else if (share < 1) {
    return { x: 2.2, y: 1.9 }
  } else {
    return { x: PRIZE_SCALE, y: PRIZE_SCALE }
  }
}

const BURST_MS = 260
const BURST_FROM_PX = 6
const BURST_TO_PX = 22
const DUD_DROOP_PX = 3
const DUD_DROOP_MS = 500

// THE PLACE

type RevealFrame = Readonly<{
  at: Vector
  viewLeft: number
  viewRight: number
}>

// NOTE: the prize sits on the fridge's door, nudged down if a landscape
// screen's HUD strip would cover it.
const revealFrameOf = (
  screen: Screen,
  camera: Camera,
  spot: Vector,
): RevealFrame => {
  const view = viewBoxOf(camera)
  const stripPx = screen.layout === 'Landscape' ? HUD_STRIP_HEIGHT : 0
  const topLeft = viewToWorld(camera, { x: view.x, y: view.y + stripPx })
  const bottomRight = viewToWorld(camera, {
    x: Math.min(view.x + view.width, screen.width),
    y: view.y + view.height,
  })
  return {
    at: { x: spot.x, y: Math.max(spot.y, Math.ceil(topLeft.y) + 7) },
    viewLeft: topLeft.x,
    viewRight: bottomRight.x,
  }
}

// NOTE: the word goes to the right of the fridge, over the wall, and to
// its left when that would leave the screen.
const WORD_GAP_PX = 16
const WORD_SCALE = 2

const wordShapes = (
  frame: RevealFrame,
  text: BakedText,
  maybeBelow: Option.Option<BakedText>,
): ReadonlyArray<Canvas.Shape> => {
  const width = text.width * WORD_SCALE
  const isRoomRight = frame.at.x + WORD_GAP_PX + width <= frame.viewRight - 2
  const x = isRoomRight
    ? frame.at.x + WORD_GAP_PX
    : frame.at.x - WORD_GAP_PX - width
  const y = frame.at.y - 6
  return [
    placeBaked(text, { x, y, align: 'Left', scale: WORD_SCALE }),
    ...Option.match(maybeBelow, {
      onNone: () => [],
      onSome: below => [placeBaked(below, { x, y: y + 14, align: 'Left' })],
    }),
  ]
}

const spinShapes = (
  model: Model,
  frame: RevealFrame,
  face: FridgePrize,
  step: number,
): ReadonlyArray<Canvas.Shape> => [
  placeAt(frame.at.x, frame.at.y, REEL_WINDOW),
  ...(Math.floor(model.elapsedMs / 60) % 2 === 0
    ? [placeAt(frame.at.x, frame.at.y, GLOW_DISC)]
    : []),
  placeScaled(
    frame.at.x,
    frame.at.y + (step % 2 === 0 ? 0 : 1),
    prizeSprite(face),
    PRIZE_SCALE,
    PRIZE_SCALE,
  ),
]

const burstShapes = (
  frame: RevealFrame,
  rarity: Rarity,
  sinceMs: number,
): ReadonlyArray<Canvas.Shape> => {
  if (sinceMs >= BURST_MS || rarity === 'Dud') {
    return []
  }
  const share = sinceMs / BURST_MS
  return [
    group({
      opacity: Math.ceil((1 - share) * 4) / 4,
      shapes: [
        Canvas.Circle({
          x: frame.at.x,
          y: frame.at.y,
          radius: Math.round(
            BURST_FROM_PX + (BURST_TO_PX - BURST_FROM_PX) * share,
          ),
          stroke: RARITY_LOOKS[rarity].ring,
          lineWidth: 2,
        }),
      ],
    }),
  ]
}

const raysShapes = (
  model: Model,
  frame: RevealFrame,
  rarity: Rarity,
): ReadonlyArray<Canvas.Shape> => {
  const [first, second] = RAYS[rarity].turns
  const turn =
    Math.floor(model.elapsedMs / RAY_TWINKLE_MS) % 2 === 0 ? first : second
  return rarity === 'Dud'
    ? [placeAt(frame.at.x, frame.at.y - 7, turn)]
    : [placeAt(frame.at.x, frame.at.y, turn)]
}

// NOTE: a snack or a dud, once shown, drops to the puller as the door
// shuts, shrinking back to its own size.
const gagFlightAt = (
  model: Model,
  frame: RevealFrame,
  reveal: DoorReveal,
): Option.Option<Readonly<{ at: Vector; scale: number }>> => {
  const flyMs = reveal.elapsedMs - REVEAL_RULES.gagFlyFromMs
  if (flyMs <= 0 || revealOf(reveal.prize).isWeapon) {
    return Option.none()
  }
  const span = Math.max(1, FRIDGE_RULES.openMs - REVEAL_RULES.gagFlyFromMs)
  const share = clamp(flyMs / span, 0, 1)
  const to = Option.match(maybePlayerAt(model, reveal.slot), {
    onNone: () => frame.at,
    onSome: ({ player }) => ({ x: player.x, y: player.y - 14 }),
  })
  return Option.some({
    at: {
      x: frame.at.x + (to.x - frame.at.x) * share,
      y: frame.at.y + (to.y - frame.at.y) * share - 6 * share * (1 - share) * 4,
    },
    scale: PRIZE_SCALE - (PRIZE_SCALE - 1) * share,
  })
}

const offerRingShapes = (
  frame: RevealFrame,
  rarity: Rarity,
  remainingMs: number,
  durationMs: number,
): ReadonlyArray<Canvas.Shape> => {
  const rings = rarity === 'Rare' ? COUNTDOWNS.Rare : COUNTDOWNS.Common
  const step = Math.ceil(
    (remainingMs / Math.max(1, durationMs)) * COUNTDOWN_STEPS,
  )
  return [
    placeAt(
      frame.at.x,
      frame.at.y,
      Option.getOrElse(Array.get(rings, step), () => rings[0]),
    ),
  ]
}

const landedShapes = (
  model: Model,
  frame: RevealFrame,
  reveal: DoorReveal,
  sinceMs: number,
): ReadonlyArray<Canvas.Shape> => {
  const { rarity } = revealOf(reveal.prize)
  const sprite = prizeSprite(reveal.prize)
  return Option.match(reveal.maybeOffer, {
    onSome: ({ remainingMs, durationMs }) => {
      const isBlinkedOut =
        remainingMs < OFFER_WARN_MS &&
        Math.floor(model.elapsedMs / OFFER_BLINK_MS) % 2 === 0
      const bob = Math.floor(model.elapsedMs / OFFER_BOB_MS) % 2
      return isBlinkedOut
        ? []
        : [
            ...raysShapes(model, frame, rarity),
            ...offerRingShapes(frame, rarity, remainingMs, durationMs),
            placeScaled(
              frame.at.x,
              frame.at.y - bob,
              sprite,
              PRIZE_SCALE,
              PRIZE_SCALE,
            ),
          ]
    },
    onNone: () =>
      Option.match(gagFlightAt(model, frame, reveal), {
        onSome: ({ at, scale }) => [
          placeScaled(Math.round(at.x), Math.round(at.y), sprite, scale, scale),
          ...wordShapes(
            frame,
            PUNCH_TEXTS[reveal.prize],
            reveal.prize === 'Dud' ? Option.some(REFUND_TEXT) : Option.none(),
          ),
        ],
        onNone: () => {
          const pop = popScale(sinceMs)
          const droop =
            rarity === 'Dud'
              ? Math.round(DUD_DROOP_PX * clamp(sinceMs / DUD_DROOP_MS, 0, 1))
              : 0
          return [
            ...raysShapes(model, frame, rarity),
            ...burstShapes(frame, rarity, sinceMs),
            placeScaled(frame.at.x, frame.at.y + droop, sprite, pop.x, pop.y),
            ...wordShapes(
              frame,
              PUNCH_TEXTS[reveal.prize],
              reveal.prize === 'Dud' ? Option.some(REFUND_TEXT) : Option.none(),
            ),
          ]
        },
      }),
  })
}

const revealShapes = (
  model: Model,
  frame: RevealFrame,
  reveal: DoorReveal,
): ReadonlyArray<Canvas.Shape> => {
  const stage = revealStageAt(reveal.prize, reveal.elapsedMs)
  return stage._tag === 'Spinning'
    ? spinShapes(model, frame, stage.face, stage.step)
    : landedShapes(model, frame, reveal, stage.sinceMs)
}

// NOTE: the reveal for everyone in the room, placed in the world by the
// screen camera like the purchase tags.
export const fridgeRevealShapes = (
  model: Model,
  screen: Screen,
  camera: Camera,
): ReadonlyArray<Canvas.Shape> =>
  Option.match(
    Option.flatMap(doorRevealOf(model.fridge.door), reveal =>
      Option.map(prizeSpotOf(model), spot => ({ reveal, spot })),
    ),
    {
      onNone: () => [],
      onSome: ({ reveal, spot }) => [
        group({
          translate: worldToView(camera, ZERO_VECTOR),
          scale:
            camera.scale === 1
              ? undefined
              : { x: camera.scale, y: camera.scale },
          shapes: revealShapes(
            model,
            revealFrameOf(screen, camera, spot),
            reveal,
          ),
        }),
      ],
    },
  )

// THE TAKE

const PULSE_COLOR = '#ffffff'
const PULSE_FLASH = 'rgba(255, 255, 255, 0.55)'
const PULSE_GROW_PX = 5

const easeOut = (share: number): number => 1 - (1 - share) * (1 - share)

const pulseShapes = (
  box: Readonly<{ x: number; y: number; width: number; height: number }>,
  share: number,
): ReadonlyArray<Canvas.Shape> => {
  const grow = Math.round(PULSE_GROW_PX * share)
  const x = box.x - 1 - grow
  const y = box.y - 1 - grow
  const width = box.width + 2 + grow * 2
  const height = box.height + 2 + grow * 2
  return [
    group({
      opacity: Math.ceil((1 - share) * 4) / 4,
      shapes: [
        ...(share < 0.5
          ? [rect(box.x, box.y, box.width, box.height, PULSE_FLASH)]
          : []),
        rect(x, y, width, 1, PULSE_COLOR),
        rect(x, y + height - 1, width, 1, PULSE_COLOR),
        rect(x, y, 1, height, PULSE_COLOR),
        rect(x + width - 1, y, 1, height, PULSE_COLOR),
      ],
    }),
  ]
}

// NOTE: the taken weapon's icon flies from the fridge into the gun slot
// that now holds it, shrinking to the slot's size, and the slot pulses.
export const prizeFlightShapes = (
  model: Model,
  screen: Screen,
  camera: Camera,
): ReadonlyArray<Canvas.Shape> =>
  PrizeFlight.match(model.prizeFlight, {
    Grounded: () => [],
    Flying: ({ prize, from, ageMs }) => {
      const box = gunSlotBox(
        screen,
        heldSlotOf(model.player.arsenal) === 'First' ? 0 : 1,
      )
      if (ageMs >= REVEAL_RULES.flightMs) {
        return pulseShapes(
          box,
          clamp((ageMs - REVEAL_RULES.flightMs) / REVEAL_RULES.pulseMs, 0, 1),
        )
      }
      const share = easeOut(clamp(ageMs / REVEAL_RULES.flightMs, 0, 1))
      const start = worldToView(camera, from)
      const end = { x: box.x + 8, y: box.y + 5 }
      const startScale = PRIZE_SCALE * camera.scale
      const scale = startScale + (1 - startScale) * share
      return [
        placeScaled(
          Math.round(start.x + (end.x - start.x) * share),
          Math.round(
            start.y + (end.y - start.y) * share - 30 * share * (1 - share),
          ),
          gunIcon(prize, 0),
          scale,
          scale,
        ),
      ]
    },
  })
