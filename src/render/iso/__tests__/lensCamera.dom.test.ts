import { Array } from 'effect'

import { describe, expect, test } from '@effect/vitest'
import { Camera3D, Matrix4, Vector3 } from '@pixi/3d'

import type { Camera } from '../../camera'
import { worldToView } from '../../camera'
import { aimSceneCamera, sceneLensOf } from '../lensCamera'
import { UNIT, zOf } from '../space'

const CASES: ReadonlyArray<Readonly<{ camera: Camera; perGamePixel: number }>> =
  [
    {
      camera: {
        x: 240,
        y: 60,
        width: 320,
        height: 180,
        scale: 4,
        left: 0,
        top: 0,
      },
      perGamePixel: 4,
    },
    {
      camera: {
        x: 100,
        y: 40,
        width: 135,
        height: 230,
        scale: 3,
        left: 0,
        top: 72,
      },
      perGamePixel: 6,
    },
  ]

const SHAKE = { x: 0, y: 0 }

const SPOTS = [
  { x: 400, y: 150 },
  { x: 250, y: 70 },
  { x: 550, y: 230 },
  { x: 160, y: 200 },
]

const pixiPixelOf = (
  pixi: Camera3D,
  canvas: Readonly<{ width: number; height: number }>,
  spot: Readonly<{ x: number; y: number }>,
) => {
  pixi.updateLocalTransform()
  const view = new Matrix4().getInverse(pixi.localTransform)
  const projection = pixi.computeProjection(
    canvas.width / canvas.height,
    new Matrix4(),
  )
  const clip = new Vector3(spot.x * UNIT, 0, zOf(spot.y))
    .applyMatrix4(view)
    .applyMatrix4(projection)
  return {
    x: ((clip.x + 1) / 2) * canvas.width,
    y: ((1 - clip.y) / 2) * canvas.height,
  }
}

describe("the 3D scene's camera", () => {
  test('agrees with the overlay on where floor points land, to a hair of a pixel', () => {
    Array.forEach(CASES, ({ camera, perGamePixel }) => {
      const canvas = {
        width: camera.width * perGamePixel,
        height: camera.height * perGamePixel,
      }
      const lens = sceneLensOf(camera, SHAKE, canvas)
      const pixi = new Camera3D()
      pixi.mode = 'perspective'
      pixi.near = 4
      pixi.far = 200
      aimSceneCamera(pixi, lens, canvas)
      Array.forEach(SPOTS, spot => {
        const inScene = pixiPixelOf(pixi, canvas, spot)
        const onOverlay = worldToView(camera, spot)
        const overlayInScene = {
          x: ((onOverlay.x - camera.left) / camera.scale) * perGamePixel,
          y: ((onOverlay.y - camera.top) / camera.scale) * perGamePixel,
        }
        expect(Math.abs(inScene.x - overlayInScene.x)).toBeLessThan(0.01)
        expect(Math.abs(inScene.y - overlayInScene.y)).toBeLessThan(0.01)
        expect(Math.abs(lens.screenX(spot.x, spot.y) - inScene.x)).toBeLessThan(
          0.01,
        )
      })
    })
  })
})
