// The 3D renderer's camera set from the game's lens (src/render/lens.ts),
// the one projection the overlay, the aim, and culling read too: the lens's
// frame on the 3D canvas, and the pixi camera standing, looking, and seeing
// as that lens does. Nothing here guesses a number of its own.

import { Function } from 'effect'

import type { Camera3D } from '@pixi/3d'

import type { Vector } from '../../world/schema/entitySchema'
import type { Camera } from '../camera'
import { type Lens, type LensFrame, lensOf } from '../lens'

// NOTE: the canvas the 3D renderer draws on, in its own pixels.
export type CanvasSize = Readonly<{ width: number; height: number }>

// NOTE: the game's camera on the 3D canvas, less the shake: the same window
// on the map, at a whole number of canvas pixels per game pixel (the stage
// and the zoom are snapped so it is exact, src/render/screen.ts), its
// middle at the canvas's middle.
const sceneFrameOf: {
  (shake: Vector, canvas: CanvasSize): (camera: Camera) => LensFrame
  (camera: Camera, shake: Vector, canvas: CanvasSize): LensFrame
} = Function.dual(
  3,
  (camera: Camera, shake: Vector, canvas: CanvasSize): LensFrame => {
    const scale = Math.max(
      1,
      Math.round(canvas.width / Math.max(1, camera.width)),
    )
    return {
      x: camera.x - shake.x,
      y: camera.y - shake.y,
      width: camera.width,
      height: camera.height,
      scale,
      left: (canvas.width - camera.width * scale) / 2,
      top: (canvas.height - camera.height * scale) / 2,
    }
  },
)

// NOTE: the pixi camera standing where the lens stands, looking where it
// looks, and seeing as much of the canvas's height as it does.
export const aimSceneCamera: {
  (lens: Lens, canvas: CanvasSize): (camera: Camera3D) => void
  (camera: Camera3D, lens: Lens, canvas: CanvasSize): void
} = Function.dual(
  3,
  (camera: Camera3D, lens: Lens, canvas: CanvasSize): void => {
    camera.position.set(lens.eye.x, lens.eye.y, lens.eye.z)
    camera.lookAt(lens.lookedAt)
    camera.fov = lens.fieldOfViewFor(canvas.height)
  },
)

// NOTE: the lens of the 3D canvas, for a frame.
export const sceneLensOf: {
  (shake: Vector, canvas: CanvasSize): (camera: Camera) => Lens
  (camera: Camera, shake: Vector, canvas: CanvasSize): Lens
} = Function.dual(
  3,
  (camera: Camera, shake: Vector, canvas: CanvasSize): Lens =>
    lensOf(sceneFrameOf(camera, shake, canvas)),
)
