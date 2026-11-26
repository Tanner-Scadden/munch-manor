import { Option } from 'effect'
import { type Application, RenderTexture } from 'pixi.js'

import {
  AmbientLight,
  Container3D,
  CubeGeometry,
  Mesh3D,
  PointLight,
  View3D,
} from '@pixi/3d'
import { OutlinePass, ToonMaterial } from '@pixi/3d/extras'

import { IDENTITY } from './flatten'
import { FLAME_TUNING } from './lightSpecs'
import { LOOK_TUNING } from './lookSpecs'
import {
  PLINTH_BASE_PX,
  PLINTH_TOP_PX,
  type PlinthLight,
  type PlinthPose,
  plinthFrameOf,
} from './plinthPose'
import { UNIT, standingPointOf } from './space'
import type { Textures } from './textures'
import { VoxelBatch, newReach } from './voxels'

const CAMERA_DISTANCE = 30

const SWING = Math.PI / 6
const SWING_MS = 6_000
const REST_TURN = -Math.PI / 8

const MOST_DEPTH = 16

const PLINTH_TURN = Math.PI / 4

const BACKGROUND = 0x0c0810

type LightSet = Readonly<{
  ambient: number
  key: Readonly<{
    flame: 'Candle' | 'Hearth'
    intensity: number
    at: Readonly<{ x: number; y: number; z: number }>
  }>
  rim: Readonly<{
    color: number
    intensity: number
    at: Readonly<{ x: number; y: number; z: number }>
  }>
  flicker: number
}>

const LIGHTS: Readonly<Record<PlinthLight, LightSet>> = {
  Candle: {
    ambient: 2,
    key: {
      flame: 'Candle',
      intensity: 18,
      at: { x: -0.8, y: 1.1, z: 1.1 },
    },
    rim: {
      color: 0x8fb4ff,
      intensity: 12,
      at: { x: 0.9, y: 1.2, z: -1 },
    },
    flicker: 0.06,
  },
  Villain: {
    ambient: 0.9,
    key: {
      flame: 'Hearth',
      intensity: 30,
      at: { x: -0.35, y: 0.1, z: 0.9 },
    },
    rim: {
      color: 0xb8d0ff,
      intensity: 22,
      at: { x: 0.7, y: 1.4, z: -0.9 },
    },
    flicker: 0.12,
  },
}

export type PlinthPicture = Readonly<{
  pixels: Uint8ClampedArray
  size: number
}>

export class PlinthStage {
  private readonly app: Application
  private readonly view: View3D
  private readonly stand: Container3D
  private readonly voxels: VoxelBatch
  private readonly base: Mesh3D
  private readonly top: Mesh3D
  private readonly ambient: AmbientLight
  private readonly key: PointLight
  private readonly rim: PointLight
  private target: RenderTexture | undefined

  constructor(app: Application, textures: Textures) {
    this.app = app
    this.view = new View3D({
      width: 1,
      height: 1,
      toneMapping: 'none',
      background: BACKGROUND,
      environment: null,
      passes: [new OutlinePass({ width: 0.04, color: 0x1a1220 })],
    })
    const { camera, root } = this.view
    camera.mode = 'orthographic'
    camera.near = 0.1
    camera.far = 100
    this.ambient = new AmbientLight({ color: 0xffffff, intensity: 0.5 })
    this.key = new PointLight({ color: 0xffffff, intensity: 0, range: 12 })
    this.rim = new PointLight({ color: 0xffffff, intensity: 0, range: 12 })
    root.addChild(this.ambient, this.key, this.rim)
    this.stand = new Container3D()
    root.addChild(this.stand)
    this.voxels = new VoxelBatch({ parent: this.stand, textures })
    const block = new CubeGeometry()
    this.base = new Mesh3D({
      geometry: block,
      material: new ToonMaterial({
        baseColor: 0x4a3446,
        bands: 3,
        specularSize: 0,
        rimIntensity: 0.2,
        outline: true,
        ...textures.lookOptions('Toon'),
      }),
    })
    this.top = new Mesh3D({
      geometry: block,
      material: new ToonMaterial({
        baseColor: 0xb0843a,
        bands: 3,
        specularSize: 0,
        rimIntensity: 0.3,
        outline: true,
        ...textures.lookOptions('Toon'),
      }),
    })
    const plinth = new Container3D({
      rotation: { x: 0, y: PLINTH_TURN, z: 0 },
    })
    plinth.addChild(this.base, this.top)
    this.stand.addChild(plinth)
  }

  draw(
    input: Readonly<{
      pose: PlinthPose
      at: Readonly<{ x: number; z: number }>
      isStill: boolean
    }>,
  ): Option.Option<PlinthPicture> {
    const { pose, at, isStill } = input
    const { image, clockMs, light } = pose
    this.stand.position.set(at.x, 0, at.z)
    const frame = plinthFrameOf(image)
    const { size } = frame
    this.voxels.begin()
    const isStanding = this.voxels.standLeaf({
      leaf: {
        shape: image,
        matrix: IDENTITY,
        alpha: 1,
      },
      footY: 0,
      part: 0,
      isFlash: false,
      most: MOST_DEPTH,
      reach: newReach(),
      spin: isStill
        ? REST_TURN
        : SWING * Math.sin((2 * Math.PI * clockMs) / SWING_MS),
    })
    this.voxels.end()
    if (!isStanding) {
      return Option.none()
    }

    const top = frame.top * UNIT
    this.top.scale.set(top, PLINTH_TOP_PX * UNIT, top)
    this.top.position.set(0, (-PLINTH_TOP_PX / 2) * UNIT, 0)
    const base = top + 2 * UNIT
    this.base.scale.set(base, PLINTH_BASE_PX * UNIT, base)
    this.base.position.set(0, (-PLINTH_TOP_PX - PLINTH_BASE_PX / 2) * UNIT, 0)

    const middle = standingPointOf({
      x: 0,
      footY: 0,
      atY: -frame.middle,
      out: 0,
    })
    const eye = standingPointOf({
      x: 0,
      footY: 0,
      atY: -frame.middle,
      out: CAMERA_DISTANCE,
    })
    const { camera } = this.view
    camera.position.set(at.x + eye.x, eye.y, at.z + eye.z)
    camera.lookAt({ x: at.x + middle.x, y: middle.y, z: at.z + middle.z })
    camera.orthographicSize = (size * UNIT) / 2

    const lights = LIGHTS[light]
    const tall = image.height * UNIT
    const flicker =
      1 +
      lights.flicker *
        (Math.sin(clockMs / 170) * 0.6 + Math.sin(clockMs / 53) * 0.4)
    this.ambient.intensity = lights.ambient * LOOK_TUNING.now.ambient
    this.key.color.setValue(FLAME_TUNING.now[lights.key.flame].color)
    this.key.intensity = lights.key.intensity * flicker
    this.key.position.set(
      at.x + lights.key.at.x * tall,
      lights.key.at.y * tall,
      at.z + lights.key.at.z * tall,
    )
    this.rim.color.setValue(lights.rim.color)
    this.rim.intensity = lights.rim.intensity
    this.rim.position.set(
      at.x + lights.rim.at.x * tall,
      lights.rim.at.y * tall,
      at.z + lights.rim.at.z * tall,
    )

    const target = this.targetOf(size)
    this.view.setSize(size, size)
    this.app.renderer.render({ container: this.view, target, clear: true })
    const { pixels } = this.app.renderer.extract.pixels({ target })
    return Option.some({ pixels, size })
  }

  private targetOf(size: number): RenderTexture {
    const known = this.target
    if (known?.width === size) {
      return known
    }
    known?.destroy(true)
    const target = RenderTexture.create({
      width: size,
      height: size,
      resolution: 1,
      scaleMode: 'nearest',
    })
    this.target = target
    return target
  }

  destroy(): void {
    this.voxels.destroy()
    this.target?.destroy(true)
    this.view.destroy({ children: true })
  }
}
