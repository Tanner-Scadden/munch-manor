import { Predicate, Schema } from 'effect'

import type * as Draw from '../draw'

export type PlinthLight = 'Candle' | 'Villain'

export type PlinthPose = Readonly<{
  image: Draw.Image
  clockMs: number
  light: PlinthLight
}>

const isPlinthPose = (value: unknown): value is PlinthPose =>
  Predicate.isObject(value) &&
  Predicate.hasProperty(value, 'image') &&
  Predicate.hasProperty(value, 'clockMs') &&
  Predicate.hasProperty(value, 'light')

export const PlinthPoseSchema = Schema.declare(isPlinthPose)

export const PLINTH_BASE_PX = 4
export const PLINTH_TOP_PX = 2

const MARGIN = 4

const PLINTH_SHOWN_PX = 7

export type PlinthFrame = Readonly<{
  size: number
  top: number
  middle: number
}>

export const plinthFrameOf = (image: Draw.Image): PlinthFrame => {
  const top = Math.max(8, Math.round(image.width * 0.7))
  const above = Math.max(1, -image.y)
  const across = 2 * Math.max(-image.x, image.x + image.width)
  const side = Math.ceil(
    Math.max(above + PLINTH_SHOWN_PX, across, top * Math.SQRT2) + MARGIN,
  )
  const size = side + (side % 2)
  return {
    size,
    top,
    middle: size / 2 - PLINTH_SHOWN_PX - MARGIN / 2,
  }
}
