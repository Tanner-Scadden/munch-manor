// What a plinth shows (plinth.ts): one sprite carved into blocks, turning
// slowly on its lit plinth by the clock it is handed, in its light. The
// Munchopedia's entries hand one to `<munch-plinth>` each render
// (plinthElement.ts).

import { Predicate, Schema } from 'effect'
import type { Canvas } from 'foldkit'

// NOTE: how a plinth is lit: a candle's warm key with a cool rim, or Uncle
// Chunk's hero shot, lit from below in red against the dark.
export type PlinthLight = 'Candle' | 'Villain'

export type PlinthPose = Readonly<{
  // NOTE: the sprite as the game draws it, its foot at its bottom edge.
  image: Canvas.Image
  clockMs: number
  light: PlinthLight
}>

const isPlinthPose = (value: unknown): value is PlinthPose =>
  Predicate.isObject(value) &&
  Predicate.hasProperty(value, 'image') &&
  Predicate.hasProperty(value, 'clockMs') &&
  Predicate.hasProperty(value, 'light')

// NOTE: the element's one property. Foldkit sets it as it is, never decoding
// it, so a declared Schema only names its type.
export const PlinthPoseSchema = Schema.declare(isPlinthPose)

// NOTE: the plinth in game pixels: a square top as wide as most of the
// sprite is tall, a brass slab over a stone base.
export const PLINTH_BASE_PX = 4
export const PLINTH_TOP_PX = 2

export const plinthTopOf = (image: Canvas.Image): number =>
  Math.max(8, Math.round(image.height * 0.7))

// NOTE: the plinth's picture in game pixels, square: tall enough for the
// sprite on its plinth, wide enough for the plinth turned corner on, and
// even, so the middle falls on a whole pixel.
const MARGIN = 4

export const plinthSizeOf = (image: Canvas.Image): number => {
  const side = Math.ceil(
    Math.max(
      image.height + PLINTH_BASE_PX + PLINTH_TOP_PX,
      plinthTopOf(image) * Math.SQRT2,
    ) + MARGIN,
  )
  return side + (side % 2)
}
