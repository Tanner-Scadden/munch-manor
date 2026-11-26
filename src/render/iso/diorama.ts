import { Schema } from 'effect'

import { UiSchema } from '@effect/ui'

import type { ViewBox } from './cull'
import { PITCH, UNIT, type Vec3 } from './space'

export const IsoLens = UiSchema.TaggedEnum({
  Play: {},
  Diorama: { clockMs: Schema.Finite },
})
export type IsoLens = typeof IsoLens.Type

const SWING = 0.42
const SWING_MS = 48_000

const REST_YAW = -0.28

const CAMERA_DISTANCE = 80

const DIORAMA_FPS = 30
export const DIORAMA_FRAME_MS = 1000 / DIORAMA_FPS

const dioramaYawOf = (
  input: Readonly<{ clockMs: number; isStill: boolean }>,
): number =>
  input.isStill
    ? REST_YAW
    : SWING * Math.sin((2 * Math.PI * input.clockMs) / SWING_MS)

export const dioramaStepOf = (devicePerGamePixel: number): number =>
  Math.max(1, Math.floor(Math.round(devicePerGamePixel) / 2))

export const DIORAMA_AMBIENT = 0.25

export type DioramaCamera = Readonly<{
  position: Vec3
  target: Vec3
  orthographicSize: number
  view: ViewBox
}>

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
