import { Function } from 'effect'

import type { Camera3D } from '@pixi/3d'

import type { Camera } from '#render/camera/camera.ts'
import { type Lens, type LensFrame, lensOf } from '#render/camera/lens.ts'
import type { Vector } from '#world/schema/entitySchema.ts'

export type CanvasSize = Readonly<{ width: number; height: number }>

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

export const sceneLensOf: {
  (shake: Vector, canvas: CanvasSize): (camera: Camera) => Lens
  (camera: Camera, shake: Vector, canvas: CanvasSize): Lens
} = Function.dual(
  3,
  (camera: Camera, shake: Vector, canvas: CanvasSize): Lens =>
    lensOf(sceneFrameOf(camera, shake, canvas)),
)
