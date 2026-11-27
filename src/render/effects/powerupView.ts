import { Array, Function, Option, Record, String, pipe } from 'effect'

import {
  type BakedText,
  GLYPH_HEIGHT,
  bakeText,
  placeBaked,
} from '#art/font.ts'
import { TOP_LEFT, group, placeAt, spriteShapes } from '#art/sprite.ts'
import {
  AURA_FRAME_COUNT,
  AURA_FRAME_MS,
  AURA_SPRITES,
} from '#art/sprites/auras.ts'
import { PICKUP_SPRITES, PICKUP_TINTS } from '#art/sprites/pickups.ts'
import type { LevelCallout } from '#domain/clientSchema.ts'
import { type Camera, viewBoxOf, worldToView } from '#render/camera/camera.ts'
import * as Draw from '#render/draw.ts'
import { FULL_TURN } from '#render/drawing.ts'
import { pixelRingSpans } from '#render/pixelCircle.ts'
import {
  BOOST_KIND_ORDER,
  BOOST_WARNING_MS,
  BURP_RADIUS,
  CALLOUT_LIFETIME_MS,
  LEVEL_CALLOUT_LIFETIME_MS,
  PICKUPS,
  PICKUP_BLINK_MS,
  PICKUP_LIFETIME_MS,
} from '#world/gear/powerups.ts'
import { UPGRADE_TIERS, tierName } from '#world/gear/weapons.ts'
import { maybeTierWord } from '#world/names.ts'
import {
  type BoostKind,
  BoostTimer,
  type Boosts,
  type Callout,
  type Pickup,
  type PickupKind,
  type Player,
} from '#world/schema/entitySchema.ts'
import type { WeaponKind } from '#world/schema/worldSchema.ts'
import { levelUpChange } from '#world/shop/shopUpgrades.ts'
import { clamp } from '#world/step/geometry.ts'

const HEX_RED = 1
const HEX_GREEN = 3
const HEX_BLUE = 5
const HEX_PAIR = 2
const HEX_BASE = 16

const channel = (hex: string, start: number): number =>
  Number.parseInt(String.slice(start, start + HEX_PAIR)(hex), HEX_BASE)

const translucent = (hex: string, alpha: number): string =>
  `rgba(${channel(hex, HEX_RED)}, ${channel(hex, HEX_GREEN)}, ${channel(hex, HEX_BLUE)}, ${alpha})`

const PICKUP_BOB_MS = 900
const PICKUP_BOB_PX = 1.5
const PICKUP_LIFT_PX = 4
const PICKUP_GLOW_RADIUS = 7
const PICKUP_GLOW_PULSE_PX = 1.5
const PICKUP_POP_MS = 220
const PICKUP_POP_OVERSHOOT = 0.35
const PICKUP_BLINK_SLOW_MS = 180
const PICKUP_BLINK_FAST_MS = 80
const PICKUP_URGENT_MS = 1000
const PICKUP_DIM_OPACITY = 0.2
const PICKUP_FOOT_DROP = 4

const PICKUP_GLOWS: Readonly<Record<PickupKind, string>> = Record.map(
  PICKUP_TINTS,
  tint => translucent(tint, 0.38),
)

const isBlinkedOut = (pickup: Pickup): boolean => {
  const remainingMs = PICKUP_LIFETIME_MS - pickup.ageMs
  if (remainingMs >= PICKUP_BLINK_MS) {
    return false
  }

  const periodMs =
    remainingMs < PICKUP_URGENT_MS ? PICKUP_BLINK_FAST_MS : PICKUP_BLINK_SLOW_MS
  return Math.floor(remainingMs / periodMs) % 2 === 1
}

const popScale = (ageMs: number): number => {
  if (ageMs >= PICKUP_POP_MS) {
    return 1
  }

  const progress = ageMs / PICKUP_POP_MS
  return progress + PICKUP_POP_OVERSHOOT * Math.sin(Math.PI * progress)
}

export const pickupFootY = (pickup: Pickup): number =>
  pickup.y + PICKUP_FOOT_DROP

export const pickupShapes = (pickup: Pickup): ReadonlyArray<Draw.Shape> => {
  const turn = (pickup.ageMs / PICKUP_BOB_MS) * FULL_TURN
  const x = Math.round(pickup.x)
  const y = Math.round(pickup.y)
  const floatY = y - PICKUP_LIFT_PX + Math.round(Math.sin(turn) * PICKUP_BOB_PX)
  const scale = popScale(pickup.ageMs)
  return [
    group({
      opacity: isBlinkedOut(pickup) ? PICKUP_DIM_OPACITY : undefined,
      shapes: [
        Draw.Circle({
          x,
          y: floatY,
          radius: Math.round(
            PICKUP_GLOW_RADIUS + Math.sin(turn * 2) * PICKUP_GLOW_PULSE_PX,
          ),
          fill: PICKUP_GLOWS[pickup.kind],
        }),
        group({
          translate: { x, y: floatY },
          scale: scale === 1 ? undefined : { x: scale, y: scale },
          shapes: PICKUP_SPRITES[pickup.kind],
        }),
      ],
    }),
  ]
}

const GOODIE_ARROW = spriteShapes(
  ['ooooooo', 'owwwwwo', '.owwwo.', '..owo..', '...o...'],
  { o: '#140c10', w: '#f4f1de' },
  TOP_LEFT,
)
const GOODIE_ARROW_LIFT_PX = 15
const GOODIE_ARROW_BOUNCE_MS = 260

export const goodieArrowShapes = (
  pickup: Pickup,
): ReadonlyArray<Draw.Shape> => [
  placeAt(
    Math.round(pickup.x) - 3,
    Math.round(pickup.y) -
      PICKUP_LIFT_PX -
      GOODIE_ARROW_LIFT_PX +
      (Math.floor(pickup.ageMs / GOODIE_ARROW_BOUNCE_MS) % 2),
    GOODIE_ARROW,
  ),
]

export const doorArrowShapes: {
  (
    elapsedMs: number,
  ): (point: Readonly<{ x: number; y: number }>) => ReadonlyArray<Draw.Shape>
  (
    point: Readonly<{ x: number; y: number }>,
    elapsedMs: number,
  ): ReadonlyArray<Draw.Shape>
} = Function.dual(
  2,
  (
    point: Readonly<{ x: number; y: number }>,
    elapsedMs: number,
  ): ReadonlyArray<Draw.Shape> => [
    placeAt(
      Math.round(point.x) - 3,
      Math.round(point.y) -
        GOODIE_ARROW_LIFT_PX +
        (Math.floor(elapsedMs / GOODIE_ARROW_BOUNCE_MS) % 2) * 2,
      GOODIE_ARROW,
    ),
  ],
)

const DOOR_ARROW_WIDTH = 7
const DOOR_ARROW_HEIGHT = 5
const DOOR_ARROW_BOUNCE_PX = 2

export const doorArrowBox = (
  point: Readonly<{ x: number; y: number }>,
): Readonly<{ left: number; top: number; right: number; bottom: number }> => {
  const left = Math.round(point.x) - 3
  const top = Math.round(point.y) - GOODIE_ARROW_LIFT_PX
  return {
    left,
    top,
    right: left + DOOR_ARROW_WIDTH,
    bottom: top + DOOR_ARROW_HEIGHT + DOOR_ARROW_BOUNCE_PX,
  }
}

type CalloutText = Readonly<{ title: BakedText; blurb: BakedText }>

const CALLOUT_TEXTS: Readonly<Record<PickupKind, CalloutText>> = Record.map(
  PICKUPS,
  ({ name, blurb }) => ({
    title: bakeText(`${name}!`, 'Victory'),
    blurb: bakeText(blurb, 'Plain'),
  }),
)

const CALLOUT_SCALE = 2
const CALLOUT_POP_SCALE = 3
const CALLOUT_POP_MS = 140
const CALLOUT_LIFT_PX = 30
const CALLOUT_FADE_START = 0.7
const CALLOUT_FADE_STEPS = 3
const CALLOUT_BLURB_GAP = 13
const CALLOUT_MARGIN = 2

const calloutOpacity = (progress: number): number | undefined => {
  if (progress <= CALLOUT_FADE_START) {
    return undefined
  }

  const left = (1 - progress) / (1 - CALLOUT_FADE_START)
  return Math.ceil(left * CALLOUT_FADE_STEPS) / CALLOUT_FADE_STEPS
}

const CALLOUT_ICON_WIDTH = 7
const CALLOUT_ICON_GAP = 3
const CALLOUT_ICON_DROP = 3

type CalloutFrame = Readonly<{
  view: Readonly<{ x: number; y: number; width: number }>
  anchor: Readonly<{ x: number; y: number }>
  scale: number
  opacity: number | undefined
}>

type Placed = Readonly<{ x: number; y: number; ageMs: number }>

const calloutFrameOf = (
  camera: Camera,
  callout: Placed,
  lifetimeMs: number,
): CalloutFrame => {
  const progress = clamp(callout.ageMs / lifetimeMs, 0, 1)
  return {
    view: viewBoxOf(camera),
    anchor: worldToView(camera, callout),
    scale: callout.ageMs < CALLOUT_POP_MS ? CALLOUT_POP_SCALE : CALLOUT_SCALE,
    opacity: calloutOpacity(progress),
  }
}

const centerWithin = (
  { view, anchor }: CalloutFrame,
  halfWidth: number,
): Readonly<{ x: number; y: number }> => ({
  x: clamp(
    Math.round(anchor.x),
    view.x + halfWidth,
    view.x + view.width - halfWidth,
  ),
  y: Math.max(view.y + CALLOUT_MARGIN, Math.round(anchor.y - CALLOUT_LIFT_PX)),
})

const explainedShapes = (
  frame: CalloutFrame,
  { title, blurb }: CalloutText,
): ReadonlyArray<Draw.Shape> => {
  const { scale, opacity } = frame
  const { x, y } = centerWithin(
    frame,
    Math.ceil((title.width * scale) / 2) + CALLOUT_MARGIN,
  )
  return [
    placeBaked(title, { x, y, align: 'Center', scale, opacity }),
    placeBaked(blurb, {
      x,
      y: y + CALLOUT_BLURB_GAP,
      align: 'Center',
      opacity,
    }),
  ]
}

const namedShapes = (
  frame: CalloutFrame,
  kind: PickupKind,
  { title }: CalloutText,
): ReadonlyArray<Draw.Shape> => {
  const { scale, opacity } = frame
  const iconWidth = CALLOUT_ICON_WIDTH * scale
  const width = iconWidth + CALLOUT_ICON_GAP * scale + title.width * scale
  const { x, y } = centerWithin(frame, Math.ceil(width / 2) + CALLOUT_MARGIN)
  const left = x - Math.round(width / 2)
  return [
    group({
      translate: {
        x: left + Math.round(iconWidth / 2),
        y: y + CALLOUT_ICON_DROP * scale,
      },
      scale: { x: scale, y: scale },
      opacity,
      shapes: PICKUP_SPRITES[kind],
    }),
    placeBaked(title, {
      x: left + iconWidth + CALLOUT_ICON_GAP * scale,
      y,
      align: 'Left',
      scale,
      opacity,
    }),
  ]
}

export const calloutShapes =
  (camera: Camera) =>
  (callout: Callout): ReadonlyArray<Draw.Shape> => {
    const frame = calloutFrameOf(
      camera,
      callout,
      CALLOUT_LIFETIME_MS[callout.look],
    )
    const texts = CALLOUT_TEXTS[callout.kind]
    return callout.look === 'Named'
      ? namedShapes(frame, callout.kind, texts)
      : explainedShapes(frame, texts)
  }

type LevelText = Readonly<{
  word: BakedText
  name: BakedText
  change: BakedText
}>

type LevelLines = Readonly<{ word: string; name: string; change: string }>

export const levelPopLines: {
  (tier: number): (weapon: WeaponKind) => LevelLines
  (weapon: WeaponKind, tier: number): LevelLines
} = Function.dual(2, (weapon: WeaponKind, tier: number): LevelLines => ({
  word: `${String.toUpperCase(
    Option.getOrElse(maybeTierWord(tier), () => 'LEVEL UP'),
  )}!`,
  name: String.toUpperCase(tierName(weapon, tier)),
  change: String.toUpperCase(levelUpChange(weapon, tier)),
}))

const LEVEL_TEXTS: Readonly<Record<WeaponKind, ReadonlyArray<LevelText>>> =
  Record.map(UPGRADE_TIERS, (tiers, weapon) =>
    Array.makeBy(tiers.length, index => {
      const { word, name, change } = levelPopLines(weapon, index + 1)
      return {
        word: bakeText(word, 'Victory'),
        name: bakeText(name, 'Prompt'),
        change: bakeText(change, 'Plain'),
      }
    }),
  )

const LEVEL_SCALE = 3
const LEVEL_POP_SCALE = 4
const LEVEL_LINE_GAP = 4
const LEVEL_LINE_HEIGHT = 9

const levelShapes = (
  frame: CalloutFrame,
  { word, name, change }: LevelText,
  ageMs: number,
): ReadonlyArray<Draw.Shape> => {
  const { opacity } = frame
  const scale = ageMs < CALLOUT_POP_MS ? LEVEL_POP_SCALE : LEVEL_SCALE
  const widest = Math.max(word.width * scale, name.width, change.width)
  const { x, y } = centerWithin(frame, Math.ceil(widest / 2) + CALLOUT_MARGIN)
  const top = Math.max(frame.view.y + CALLOUT_MARGIN, y - LEVEL_LINE_HEIGHT * 2)
  const nameY = top + GLYPH_HEIGHT * scale + LEVEL_LINE_GAP
  return [
    placeBaked(word, { x, y: top, align: 'Center', scale, opacity }),
    placeBaked(name, { x, y: nameY, align: 'Center', opacity }),
    placeBaked(change, {
      x,
      y: nameY + LEVEL_LINE_HEIGHT,
      align: 'Center',
      opacity,
    }),
  ]
}

export const levelCalloutShapes =
  (camera: Camera) =>
  (callout: LevelCallout): ReadonlyArray<Draw.Shape> =>
    Option.match(Array.get(LEVEL_TEXTS[callout.weapon], callout.tier - 1), {
      onNone: () => [],
      onSome: texts =>
        levelShapes(
          calloutFrameOf(camera, callout, LEVEL_CALLOUT_LIFETIME_MS),
          texts,
          callout.ageMs,
        ),
    })

const BURP_RING_MS = 420
const BURP_RING_COLOR = PICKUP_TINTS.Burp
const BURP_RING_INNER_COLOR = translucent(PICKUP_TINTS.Burp, 0.45)

export const burpRingShapes = (callout: Callout): ReadonlyArray<Draw.Shape> => {
  if (callout.kind !== 'Burp' || callout.ageMs >= BURP_RING_MS) {
    return []
  }

  const progress = callout.ageMs / BURP_RING_MS
  const reach = 1 - (1 - progress) * (1 - progress)
  const x = Math.round(callout.x)
  const y = Math.round(callout.y)
  return [
    group({
      opacity: 1 - progress,
      shapes: [
        ...pixelRingSpans(x, y, BURP_RADIUS * reach, 3, BURP_RING_COLOR),
        ...pixelRingSpans(
          x,
          y,
          BURP_RADIUS * reach * 0.75,
          2,
          BURP_RING_INNER_COLOR,
        ),
      ],
    }),
  ]
}

const AURA_CYCLE_MS = 300
const AURA_FOOT_DROP = 4
const WARNING_BLINK_MS = 250

const isOn = BoostTimer.isAnyOf(['On'])

type ActiveBoost = Readonly<{
  kind: BoostKind
  remainingMs: number
  durationMs: number
}>

const activeBoosts = (boosts: Boosts): ReadonlyArray<ActiveBoost> =>
  Array.flatMap(BOOST_KIND_ORDER, kind =>
    BoostTimer.match(boosts[kind], {
      Off: () => [],
      On: ({ remainingMs, durationMs }) => [{ kind, remainingMs, durationMs }],
    }),
  )

const isWarningOff = (remainingMs: number): boolean =>
  remainingMs < BOOST_WARNING_MS &&
  Math.floor(remainingMs / WARNING_BLINK_MS) % 2 === 1

export const auraShapes: {
  (
    boosts: Boosts,
    elapsedMs: number,
  ): (player: Player) => ReadonlyArray<Draw.Shape>
  (player: Player, boosts: Boosts, elapsedMs: number): ReadonlyArray<Draw.Shape>
} = Function.dual(
  3,
  (
    player: Player,
    boosts: Boosts,
    elapsedMs: number,
  ): ReadonlyArray<Draw.Shape> => {
    if (!Array.some(BOOST_KIND_ORDER, kind => isOn(boosts[kind]))) {
      return []
    }

    const active = activeBoosts(boosts)
    return pipe(
      Array.get(
        active,
        Math.floor(elapsedMs / AURA_CYCLE_MS) % Math.max(1, active.length),
      ),
      Option.filter(({ remainingMs }) => !isWarningOff(remainingMs)),
      Option.match({
        onNone: () => [],
        onSome: ({ kind }) => {
          const frames = AURA_SPRITES[kind]
          return pipe(
            Array.get(
              frames,
              Math.floor(elapsedMs / AURA_FRAME_MS) % AURA_FRAME_COUNT,
            ),
            Option.match({
              onNone: () => [],
              onSome: sprite => [
                placeAt(
                  Math.round(player.x),
                  Math.round(player.y) + AURA_FOOT_DROP,
                  sprite,
                ),
              ],
            }),
          )
        },
      }),
    )
  },
)

const CHIP_WIDTH = 13
const CHIP_HEIGHT = 12
const CHIP_GAP = 3
const CHIP_FILL = 'rgba(8, 10, 12, 0.6)'
const CHIP_ICON_X = 6
const CHIP_ICON_Y = 5
const CHIP_BAR_HEIGHT = 2
const CHIP_DIM_OPACITY = 0.35

const chipShapes =
  (left: number, gridTop: number, columns: number) =>
  (
    { kind, remainingMs, durationMs }: ActiveBoost,
    index: number,
  ): ReadonlyArray<Draw.Shape> => {
    const x = left + (index % columns) * (CHIP_WIDTH + CHIP_GAP)
    const top = gridTop + Math.floor(index / columns) * (CHIP_HEIGHT + CHIP_GAP)
    const share = durationMs > 0 ? clamp(remainingMs / durationMs, 0, 1) : 0
    return [
      group({
        opacity: isWarningOff(remainingMs) ? CHIP_DIM_OPACITY : undefined,
        shapes: [
          Draw.Rect({
            x,
            y: top,
            width: CHIP_WIDTH,
            height: CHIP_HEIGHT,
            fill: PICKUP_TINTS[kind],
          }),
          Draw.Rect({
            x: x + 1,
            y: top + 1,
            width: CHIP_WIDTH - 2,
            height: CHIP_HEIGHT - 2,
            fill: CHIP_FILL,
          }),
          group({
            translate: { x: x + CHIP_ICON_X, y: top + CHIP_ICON_Y },
            shapes: PICKUP_SPRITES[kind],
          }),
          Draw.Rect({
            x: x + 1,
            y: top + CHIP_HEIGHT - 1 - CHIP_BAR_HEIGHT,
            width: Math.max(1, Math.round((CHIP_WIDTH - 2) * share)),
            height: CHIP_BAR_HEIGHT,
            fill: PICKUP_TINTS[kind],
          }),
        ],
      }),
    ]
  }

export const boostChipShapes: {
  (
    left: number,
    top: number,
    columns: number,
  ): (boosts: Boosts) => ReadonlyArray<Draw.Shape>
  (
    boosts: Boosts,
    left: number,
    top: number,
    columns: number,
  ): ReadonlyArray<Draw.Shape>
} = Function.dual(
  4,
  (
    boosts: Boosts,
    left: number,
    top: number,
    columns: number,
  ): ReadonlyArray<Draw.Shape> =>
    Array.flatMap(activeBoosts(boosts), chipShapes(left, top, columns)),
)
