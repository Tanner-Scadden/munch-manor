import { Array, Function, Option } from 'effect'

import { type Sprite, bakeShapes } from '#art/sprite.ts'
import { type RingPixel, rect, ringPixels } from '#render/drawing.ts'

export const WORK_RING_RADIUS = 9
const RING_STEPS = 12
const SET_UP_FILLED = '#ffd23f'
const SET_UP_EMPTY = '#3a2c10'
const COOLDOWN_FILLED = '#8a8a96'
const COOLDOWN_EMPTY = '#25252c'

const ring = (
  pixels: ReadonlyArray<RingPixel>,
  filled: number,
  colors: Readonly<{ filled: string; empty: string }>,
): Sprite =>
  bakeShapes(
    Array.map(pixels, ({ x, y, turn }) =>
      rect(x, y, 1, 1, turn < filled ? colors.filled : colors.empty),
    ),
  )

const ringSteps = (
  colors: Readonly<{ filled: string; empty: string }>,
): Array.NonEmptyReadonlyArray<Sprite> => {
  const pixels = ringPixels(WORK_RING_RADIUS)
  return [
    ring(pixels, 0, colors),
    ...Array.makeBy(RING_STEPS, step =>
      ring(pixels, (step + 1) / RING_STEPS, colors),
    ),
  ]
}

export const SET_UP_RINGS = ringSteps({
  filled: SET_UP_FILLED,
  empty: SET_UP_EMPTY,
})

export const COOLDOWN_RINGS = ringSteps({
  filled: COOLDOWN_FILLED,
  empty: COOLDOWN_EMPTY,
})

export const ringStepOf: {
  (share: number): (rings: Array.NonEmptyReadonlyArray<Sprite>) => Sprite
  (rings: Array.NonEmptyReadonlyArray<Sprite>, share: number): Sprite
} = Function.dual(
  2,
  (rings: Array.NonEmptyReadonlyArray<Sprite>, share: number): Sprite =>
    Option.getOrElse(
      Array.get(rings, Math.min(RING_STEPS, Math.floor(share * RING_STEPS))),
      () => Array.headNonEmpty(rings),
    ),
)
