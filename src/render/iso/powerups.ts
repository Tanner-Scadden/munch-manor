// The power-ups in 3D: a goodie on the floor spins like a coin over a ring of
// its own light, and a boost's aura rings the player for real, its gears,
// silver, sparkles, and hat pins standing on the floor round the feet (those
// behind go behind the body, those in front in front of it) and its notes
// and twinkles hanging in the air. Read off the same frames the game draws
// (the aura's sprite says which frame), so the timing, the blink as a boost
// runs out, and which boost shows all stay the game's own.
//
// Plain data, no pixi.

import { Array, Option, Record, String } from 'effect'
import type { Canvas } from 'foldkit'

import {
  AURA_CENTER,
  AURA_PALETTES,
  AURA_SPRITES,
  AURA_STAMPS,
} from '../../art/sprites/auras'
import { PICKUP_SPRITES } from '../../art/sprites/pickups'
import type { BoostKind } from '../../world/schema/entitySchema'
import type { Affine, Leaf } from './flatten'

const keyOf = (image: Canvas.Image): string =>
  `${image.src}|${image.crop?.x ?? 0},${image.crop?.y ?? 0}`

const keysOf = (sprite: ReadonlyArray<Canvas.Shape>): ReadonlyArray<string> =>
  Array.flatMap(sprite, shape => (shape._tag === 'Image' ? [keyOf(shape)] : []))

// NOTE: each aura frame's image, by where it is cut from.
const AURA_FRAMES: ReadonlyMap<
  string,
  Readonly<{ kind: BoostKind; frame: number }>
> = new Map(
  Array.flatMap(Record.toEntries(AURA_SPRITES), ([kind, sprites]) =>
    Array.flatMap(sprites, (sprite, frame) =>
      Array.map(keysOf(sprite), key => [key, { kind, frame }] as const),
    ),
  ),
)

const POWERUP_IMAGES: ReadonlySet<string> = new Set(
  Array.flatMap(Record.values(PICKUP_SPRITES), keysOf),
)

// NOTE: which boost's frame an image is, if it is one.
export const auraFrameOf = (
  image: Canvas.Image,
): Option.Option<Readonly<{ kind: BoostKind; frame: number }>> =>
  Option.fromNullishOr(AURA_FRAMES.get(keyOf(image)))

// NOTE: a body's leaves less its aura and a spinning goodie, for its flat
// shadow and its rim: an aura stands as its own blocks round the feet, and a
// goodie's rim would show its unturned outline behind it.
export const castingLeavesOf = (
  leaves: ReadonlyArray<Leaf>,
): ReadonlyArray<Leaf> =>
  Array.filter(
    leaves,
    ({ shape }) =>
      shape._tag !== 'Image' ||
      (!AURA_FRAMES.has(keyOf(shape)) && !POWERUP_IMAGES.has(keyOf(shape))),
  )

export const isPowerupImage = (image: Canvas.Image): boolean =>
  POWERUP_IMAGES.has(keyOf(image))

// NOTE: one little block: its spot on the floor, how high it hangs, in
// whole game pixels, its color, and how bright it glows.
export type PowerupCube = Readonly<{
  x: number
  footY: number
  rise: number
  color: number
  glow: number
}>

// NOTE: an aura's white gleams catch the bloom; the rest glow softly, so
// the ring shows in the cellar's dark as it did drawn flat.
const GLEAM_GLOW = 3
const AURA_GLOW = 1.2
const GLEAM = 'W'

const hexOf = (css: string): number =>
  Number.parseInt(String.slice(1, 7)(css), 16)

// NOTE: the image's own spot in the world: the aura's middle (the player's
// feet) through the shapes' matrix.
export const auraFeetOf = ({
  image,
  matrix,
}: Readonly<{ image: Canvas.Image; matrix: Affine }>): Readonly<{
  x: number
  y: number
}> => {
  const x = image.x + AURA_CENTER.x
  const y = image.y + AURA_CENTER.y
  return {
    x: matrix.a * x + matrix.c * y + matrix.e,
    y: matrix.b * x + matrix.d * y + matrix.f,
  }
}

// NOTE: a frame's blocks round the feet: a stamp that rings them stands on
// the floor at its own spot on the ring, its bottom row on the boards; one
// aloft hangs over the feet where the flat frame showed it.
export const auraCubesOf = (
  input: Readonly<{
    kind: BoostKind
    frame: number
    feet: Readonly<{ x: number; y: number }>
  }>,
): ReadonlyArray<PowerupCube> => {
  const { kind, frame, feet } = input
  const palette = AURA_PALETTES[kind]
  const stamps = Option.getOrElse(Array.get(AURA_STAMPS[kind], frame), () => [])
  const footX = Math.round(feet.x)
  const footY = Math.round(feet.y)
  return Array.flatMap(stamps, stamp => {
    const bottom = stamp.top + stamp.rows.length - 1
    const ringY = stamp.top + Math.floor(stamp.rows.length / 2)
    return Array.flatMap(stamp.rows, (row, line) =>
      Array.flatMap(Array.fromIterable(row), (symbol, column) =>
        Option.match(Option.fromNullishOr(palette[symbol]), {
          onNone: () => [],
          onSome: css => [
            {
              x: footX + stamp.left + column - AURA_CENTER.x,
              footY: stamp.isAloft ? footY : footY + ringY - AURA_CENTER.y,
              rise: stamp.isAloft
                ? AURA_CENTER.y - (stamp.top + line)
                : bottom - (stamp.top + line),
              color: hexOf(css),
              glow: symbol === GLEAM ? GLEAM_GLOW : AURA_GLOW,
            },
          ],
        }),
      ),
    )
  })
}

// NOTE: one turn of a goodie's spin, and of its ring of light.
const SPIN_MS = 2400
const RING_MS = 3600
const RING_LIGHTS = 10
const RING_GLOW = 1.6
// NOTE: the ring sits flatter than wide, as the floor reads under the lens.
const RING_DEPTH = 0.5

// NOTE: how far round a goodie has spun, from the game's clock and its spot,
// so two side by side never turn as one.
export const pickupSpinOf = ({
  elapsedMs,
  x,
}: Readonly<{ elapsedMs: number; x: number }>): number =>
  ((elapsedMs / SPIN_MS + x / 97) % 1) * Math.PI * 2

// NOTE: a goodie's glow as a ring of little lights in its tint on the floor
// under it, turning slowly the other way, as wide as the glow it drew flat.
export const pickupRingOf = (
  input: Readonly<{
    x: number
    footY: number
    radius: number
    color: number
    elapsedMs: number
  }>,
): ReadonlyArray<PowerupCube> => {
  const { x, footY, radius, color, elapsedMs } = input
  const start = -(elapsedMs / RING_MS) * Math.PI * 2
  return Array.makeBy(RING_LIGHTS, index => {
    const turn = start + (index / RING_LIGHTS) * Math.PI * 2
    return {
      x: Math.round(x + Math.cos(turn) * radius),
      footY: Math.round(footY + Math.sin(turn) * radius * RING_DEPTH),
      rise: 0,
      color,
      glow: RING_GLOW,
    }
  })
}
