// What a plinth shows (plinth.ts): one sprite carved into blocks, swinging
// a little on its lit plinth by the clock it is handed, in its light. The
// Munchopedia's entries hand one to `<munch-plinth>` each render
// (plinthElement.ts).

import { Predicate, Schema } from 'effect'
import type { Canvas } from 'foldkit'

// NOTE: how a plinth is lit: a candle's warm key with a cool rim, or Uncle
// Chunk's hero shot, lit from below in red against the dark.
export type PlinthLight = 'Candle' | 'Villain'

export type PlinthPose = Readonly<{
  // NOTE: the sprite as the game draws it, its box about its foot (0, 0),
  // as play draws a body's sprite in a group translated to its foot.
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

// NOTE: the plinth in game pixels: a square top a little narrower than the
// sprite is wide, a brass slab over a stone base, turned corner on.
export const PLINTH_BASE_PX = 4
export const PLINTH_TOP_PX = 2

// NOTE: room round the figure, in game pixels.
const MARGIN = 4

// NOTE: how much of the plinth the frame shows below the foot, in game
// pixels: its top and the start of its side, cut off by the frame's bottom
// edge like a hero shot, so the figure fills the frame.
const PLINTH_SHOWN_PX = 7

export type PlinthFrame = Readonly<{
  // NOTE: the square picture's side, even, so its middle falls on a whole
  // pixel.
  size: number
  // NOTE: the plinth top's side.
  top: number
  // NOTE: the picture's middle, in game pixels up the screen from the
  // sprite's foot.
  middle: number
}>

export const plinthFrameOf = (image: Canvas.Image): PlinthFrame => {
  const top = Math.max(8, Math.round(image.width * 0.7))
  // NOTE: how far the sprite's box reaches up from its foot, and to either
  // side of it.
  const above = Math.max(1, -image.y)
  const across = 2 * Math.max(-image.x, image.x + image.width)
  const side = Math.ceil(
    Math.max(above + PLINTH_SHOWN_PX, across, top * Math.SQRT2) + MARGIN,
  )
  const size = side + (side % 2)
  return {
    size,
    top,
    // NOTE: the plinth's shown part at the frame's bottom edge, the figure
    // over it.
    middle: size / 2 - PLINTH_SHOWN_PX - MARGIN / 2,
  }
}
