// A plinth: one sprite carved into blocks (voxels.ts), standing on a small
// lit plinth and swinging a little to each side on it, drawn by a camera of
// its own into a picture one canvas pixel to a game pixel. The body stands
// and turns exactly as play stands and spins it (`standLeaf`), and the
// camera looks down play's own 49 degrees, so the carve, made to be seen
// from there, reads as one whole body at every pose. The Munchopedia's
// entries show each zombie this way, and Uncle Chunk in his hero shot.
//
// It draws with the world's own renderer and textures (scene.ts), into a
// texture of its own, so the page keeps one WebGL context: a phone's browser
// allows only a few. The picture is read back and handed to the plinth's
// element, which puts it on a 2D canvas the page stretches pixelated.

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

// NOTE: how far the camera stands from the figure's middle, in world units,
// toward play's lens.
const CAMERA_DISTANCE = 30

// NOTE: the body swings this far to each side and back, once in this long,
// shown in the carved bodies' snapped steps (voxelShape.ts: a sixteenth of
// a turn), so it shows its front and a sliver of each side and never turns
// edge on, where a carve made to face the lens reads as a sliver. A still
// plinth (reduced motion) rests on the first step to one side.
const SWING = Math.PI / 6
const SWING_MS = 6_000
const REST_TURN = -Math.PI / 8

// NOTE: a body as deep as play carves a zombie.
const MOST_DEPTH = 16

// NOTE: the plinth stands still, corner on to the camera.
const PLINTH_TURN = Math.PI / 4

const BACKGROUND = 0x0c0810

type LightSet = Readonly<{
  ambient: number
  key: Readonly<{
    // NOTE: the shipped flame whose color the key takes (lightSpecs.ts).
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

// NOTE: where each light stands, in sprite heights from the body's foot:
// the key in front and to the left, the rim behind and to the right. The
// keys take a flame's color and the ambient the look's, as Munch Studio's
// lab slides them (tunable.ts).
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
  // NOTE: Uncle Chunk lit from below like a ghost story, in the hearth's
  // red, a cold rim cutting him out of the dark behind.
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

// NOTE: mutable on purpose: it holds pixi's own objects for the life of the
// renderer, built at the first plinth drawn.
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

  // NOTE: the picture of a pose, or none while its sprite still loads. It
  // stands at `at` (world units) in an open room of the house, unseen by
  // the play camera, only so the look pass (look.ts), which finds a pixel's
  // room by where it stands, bands its light in that room's colors and not
  // the void's black.
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
    // NOTE: the body stands on the plinth's top as play stands it on the
    // floor: the sprite's own box is drawn about its foot, at the stand's
    // middle, and swings as play spins a
    // body, about its own upright.
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

    // NOTE: the camera looks down play's lens at the frame's middle, one
    // game pixel to a canvas pixel.
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
