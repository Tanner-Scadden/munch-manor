// The title's manor as a diorama: the house the play camera looks at, drawn
// small on black by a camera of its own that swings slowly round it, lit by
// its candles and the storm. The play camera (49 degrees, looking straight
// north) is never moved for play: only the title asks for this lens.

import { Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

import type { ViewBox } from './cull'
import { PITCH, UNIT, type Vec3 } from './space'

// NOTE: which camera a frame is drawn by: the game's own, or the title's
// diorama turning by the screen's clock.
export const IsoLens = defineTaggedUnion({
  Play: {},
  Diorama: { clockMs: Schema.Finite },
})
export type IsoLens = typeof IsoLens.Type

// NOTE: the swing: this far either side of straight north, there and back
// in this long. Far enough that the walls and bodies show their sides; not
// so far that a carved body, built for a lens looking north, shows its
// thin edge.
const SWING = 0.42
const SWING_MS = 48_000

// NOTE: where a still diorama rests (reduced motion): a little turned, so
// it still reads as a model of the house and not the game's own view.
const REST_YAW = -0.28

const CAMERA_DISTANCE = 80

// NOTE: at most this many diorama frames a second, on a menu a phone sits on.
const DIORAMA_FPS = 30
export const DIORAMA_FRAME_MS = 1000 / DIORAMA_FPS

// NOTE: the turn about the house's upright, in radians, by the clock.
const dioramaYawOf = (
  input: Readonly<{ clockMs: number; isStill: boolean }>,
): number =>
  input.isStill
    ? REST_YAW
    : SWING * Math.sin((2 * Math.PI * input.clockMs) / SWING_MS)

// NOTE: how many device pixels each canvas pixel covers on the title: half
// the play camera's game pixel, whole, so the house shows small. The canvas
// then holds exactly one canvas pixel per game pixel, and the page stretches
// it pixelated: as the house turns, its art steps a whole game pixel at a
// time, never a half pixel sliver.
export const dioramaStepOf = (devicePerGamePixel: number): number =>
  Math.max(1, Math.floor(Math.round(devicePerGamePixel) / 2))

// NOTE: the house's ambient light on the title, a share of play's: the
// open rooms glow by their own lights and candles, and the rest of the
// manor shows only as the storm's lightning strikes.
export const DIORAMA_AMBIENT = 0.25

export type DioramaCamera = Readonly<{
  position: Vec3
  target: Vec3
  orthographicSize: number
  view: ViewBox
}>

// NOTE: the diorama's camera about the point the play camera looks at, one
// game pixel to a canvas pixel. The
// view kept for culling is the floor it could show at any turn of the swing.
export const dioramaCameraOf = (
  input: Readonly<{
    clockMs: number
    isStill: boolean
    target: Vec3
    centerX: number
    centerY: number
    canvasWidth: number
    canvasHeight: number
  }>,
): DioramaCamera => {
  const shownWidth = input.canvasWidth
  const shownHeight = input.canvasHeight
  const yaw = dioramaYawOf(input)
  const across = Math.cos(PITCH) * CAMERA_DISTANCE
  const reach = Math.max(shownWidth, shownHeight)
  return {
    position: {
      x: input.target.x + Math.sin(yaw) * across,
      y: input.target.y + Math.sin(PITCH) * CAMERA_DISTANCE,
      z: input.target.z + Math.cos(yaw) * across,
    },
    target: input.target,
    orthographicSize: (shownWidth * UNIT) / 2,
    view: {
      left: input.centerX - reach,
      top: input.centerY - reach,
      right: input.centerX + reach,
      bottom: input.centerY + reach,
    },
  }
}
