// The 3D stage's element, `<studio-stage>`: the picked sprite carved into
// blocks and stood on the manor's own floor, in the light of a preset
// (./stagePresets.ts), through the game's own renderer parts: its textures
// and look pass, its carve and batch of blocks (src/render/iso/voxels.ts),
// its floor layer, and its house lights. The camera turns round the thing
// (a drag, or a spin), or stands where the game's camera stands (49° down).
// A press on a block is followed back along the camera's ray through the
// very blocks the game builds, to the sprite pixel the block was carved
// from, so a pin here reads as a pin on the flat picture. The light and
// color lab's edits (`tuning`) reach this page's renderer as they move.
import { Array, Effect, Option, Schema } from 'effect'
import { CustomElement } from 'foldkit'
import { Application } from 'pixi.js'

import { AmbientLight, Container3D, View3D } from '@pixi/3d'
import { BloomEffect, OutlinePass } from '@pixi/3d/extras'

import { isFlashShape } from '../../src/art/sprite'
import { viewBoxOf } from '../../src/render/iso/cull'
import { type Leaf, flatten } from '../../src/render/iso/flatten'
import { floorArtOf } from '../../src/render/iso/house'
import { AMBIENT } from '../../src/render/iso/lightSpecs'
import { type HouseLights, houseLightsOf } from '../../src/render/iso/lights'
import { LOOK_TUNING } from '../../src/render/iso/lookSpecs'
import { mixColor } from '../../src/render/iso/mood'
import { FloorLayer } from '../../src/render/iso/painter'
import { STORM_COLOR, STORM_LIFT } from '../../src/render/iso/scene'
import { CAMERA_UP, PITCH, UNIT, zOf } from '../../src/render/iso/space'
import { Textures } from '../../src/render/iso/textures'
import {
  type VoxelMeshData,
  voxelMeshOf,
} from '../../src/render/iso/voxelShape'
import {
  type StandInput,
  VoxelBatch,
  type VoxelPlacement,
  newReach,
} from '../../src/render/iso/voxels'
import { toBrowserError } from '../../src/shared/describeError'
import type { Level } from '../../src/world/level/arena'
import { initialPlayer } from '../../src/world/schema/worldSchema'
import { FacingChoice, Tone, entryById } from './catalog'
import { frameIndexOf, frameOf, spritesBounds } from './drawing'
import { LabEdits, tablesOf, tuneTables } from './lab'
import { Pin } from './notes'
import {
  type StagePreset as Preset,
  StagePreset,
  stageLevelOf,
  stageSetupOf,
} from './stagePresets'

const TAG = 'studio-stage'

const Subject = Schema.Struct({
  id: Schema.String,
  facing: FacingChoice,
  tone: Tone,
  clockMs: Schema.Finite,
  // NOTE: the most blocks deep it is carved, as the game carves its kind.
  most: Schema.Finite,
})
type Subject = typeof Subject.Type

const StagePin = Schema.Struct({
  pin: Pin,
  label: Schema.String,
  color: Schema.String,
})
type StagePin = typeof StagePin.Type

export const studioStage = CustomElement.define({
  tag: TAG,
  properties: {
    subject: Subject,
    preset: StagePreset,
    house: Schema.Finite,
    isAutoSpin: Schema.Boolean,
    // NOTE: a count the view raises to stand the camera where the game's
    // stands again.
    cameraResets: Schema.Finite,
    tuning: LabEdits,
    pins: Schema.Array(StagePin),
  },
  events: { 'press-block': Pin },
})

// THE CAMERA

type Vector3 = readonly [number, number, number]

const add = (a: Vector3, b: Vector3, scale: number = 1): Vector3 => [
  a[0] + b[0] * scale,
  a[1] + b[1] * scale,
  a[2] + b[2] * scale,
]
const sub = (a: Vector3, b: Vector3): Vector3 => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
]
const dot = (a: Vector3, b: Vector3): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vector3, b: Vector3): Vector3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const normal = (a: Vector3): Vector3 => {
  const length = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / length, a[1] / length, a[2] / length]
}

// NOTE: the camera as the stage last drew with it: where it stands, its
// right, up, and forward, and how far it sees from its middle, in world
// units.
type Lens = Readonly<{
  position: Vector3
  right: Vector3
  up: Vector3
  forward: Vector3
  halfWidth: number
  halfHeight: number
  width: number
  height: number
}>

const CAMERA_DISTANCE = 80
const MIN_PITCH = (12 * Math.PI) / 180
const MAX_PITCH = (88 * Math.PI) / 180
// NOTE: radians a CSS pixel of drag turns, and a second of spin.
const DRAG_TURN = 0.01
const SPIN_SPEED = 0.6
// NOTE: a press that moves less than this, in CSS pixels, is a pin.
const PRESS_SLOP = 4
// NOTE: the thing fills about this share of the stage's height, at a whole
// number of CSS pixels a game pixel.
const FILL_SHARE = 0.6
const MIN_ZOOM = 2
const MAX_ZOOM = 12

const lensOf = (
  input: Readonly<{
    target: Vector3
    yaw: number
    pitch: number
    zoom: number
    width: number
    height: number
  }>,
): Lens => {
  const { target, yaw, pitch, zoom, width, height } = input
  const toward: Vector3 = [
    Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    Math.cos(yaw) * Math.cos(pitch),
  ]
  const position = add(target, toward, CAMERA_DISTANCE)
  const forward = normal(sub(target, position))
  const right = normal(cross(forward, [0, 1, 0]))
  const up = cross(right, forward)
  const halfWidth = ((width / zoom) * UNIT) / 2
  return {
    position,
    right,
    up,
    forward,
    halfWidth,
    halfHeight: (halfWidth * height) / Math.max(1, width),
    width,
    height,
  }
}

// NOTE: a point in the world on the stage, in CSS pixels.
const screenOf = (lens: Lens, point: Vector3) => {
  const offset = sub(point, lens.position)
  return {
    x: ((dot(offset, lens.right) / lens.halfWidth + 1) / 2) * lens.width,
    y: ((1 - dot(offset, lens.up) / lens.halfHeight) / 2) * lens.height,
  }
}

// THE PRESS

// NOTE: a leaf as the game stands it, and its blocks' placement.
type Stood = Readonly<{ leaf: Leaf; placement: VoxelPlacement }>

// NOTE: a matrix of sixteen numbers, column by column, on a point.
const transformed = (elements: ReadonlyArray<number>, point: Vector3) => {
  const at = (index: number): number => elements[index] ?? 0
  return [
    at(0) * point[0] + at(4) * point[1] + at(8) * point[2] + at(12),
    at(1) * point[0] + at(5) * point[1] + at(9) * point[2] + at(13),
    at(2) * point[0] + at(6) * point[1] + at(10) * point[2] + at(14),
  ] as const
}

// NOTE: a ray against a triangle (Möller and Trumbore), its distance or none.
const EPSILON = 1e-7
const hitDistance = (
  origin: Vector3,
  direction: Vector3,
  a: Vector3,
  b: Vector3,
  c: Vector3,
): number | undefined => {
  const edgeA = sub(b, a)
  const edgeB = sub(c, a)
  const p = cross(direction, edgeB)
  const determinant = dot(edgeA, p)
  if (Math.abs(determinant) < EPSILON) {
    return undefined
  }
  const inverse = 1 / determinant
  const s = sub(origin, a)
  const u = dot(s, p) * inverse
  if (u < 0 || u > 1) {
    return undefined
  }
  const q = cross(s, edgeA)
  const v = dot(direction, q) * inverse
  if (v < 0 || u + v > 1) {
    return undefined
  }
  const distance = dot(edgeB, q) * inverse
  return distance > EPSILON ? distance : undefined
}

// NOTE: a placement's blocks as the game carves them, each face's corners
// carrying the pixel it shows (its column in the art, unmirrored, and its
// row), at its hand set depth too, kept for each carve.
const meshes = new WeakMap<VoxelPlacement['carved'], VoxelMeshData>()

const pickMeshOf = (placement: VoxelPlacement, most: number): VoxelMeshData => {
  const known = meshes.get(placement.carved)
  if (known !== undefined) {
    return known
  }
  const { width, height } = placement.texels
  const { masks, isFlipped } = placement
  const columnOf = (column: number): number =>
    isFlipped ? width - 1 - column : column
  const { depthOf } = placement.carved
  const {
    lift: _lift,
    caster: _caster,
    ...mesh
  } = voxelMeshOf({
    width,
    height,
    isSolid: (column, row) => masks.solid[row * width + columnOf(column)] === 1,
    isDark: (column, row) => masks.dark[row * width + columnOf(column)] === 1,
    most,
    ...(depthOf === undefined ? {} : { depthOf }),
    uvOf: (column, row) => [columnOf(column) + 0.5, row + 0.5],
  })
  meshes.set(placement.carved, mesh)
  return mesh
}

// NOTE: the sprite pixel a texel of a leaf's art is, by the leaf's box and
// matrix, as the flat picture's pins count them.
const spritePixelOf = (
  { leaf, placement }: Stood,
  column: number,
  row: number,
): Pin => {
  const { shape, matrix } = leaf
  if (shape._tag !== 'Image') {
    return { x: 0, y: 0 }
  }
  const { texels } = placement
  const across = shape.width / Math.max(1, texels.width)
  const down = shape.height / Math.max(1, texels.height)
  const x = shape.x + (column + 0.5) * across
  const y = shape.y + (row + 0.5) * down
  return {
    x: Math.floor(matrix.a * x + matrix.c * y + matrix.e),
    y: Math.floor(matrix.b * x + matrix.d * y + matrix.f),
  }
}

// NOTE: the nearest block under a point on the stage, as the sprite pixel it
// was carved from.
const pickAt = (
  input: Readonly<{
    lens: Lens
    point: Readonly<{ x: number; y: number }>
    stood: ReadonlyArray<Stood>
    most: number
  }>,
): Option.Option<Pin> => {
  const { lens, point, stood, most } = input
  const ndcX = (point.x / lens.width) * 2 - 1
  const ndcY = 1 - (point.y / lens.height) * 2
  const origin = add(
    add(lens.position, lens.right, ndcX * lens.halfWidth),
    lens.up,
    ndcY * lens.halfHeight,
  )
  let best = Number.POSITIVE_INFINITY
  let found: Option.Option<Pin> = Option.none()
  for (const { leaf, placement } of stood) {
    const mesh = pickMeshOf(placement, most)
    const corner = (index: number): Vector3 => {
      const at = (mesh.indices[index] ?? 0) * 3
      return transformed(placement.elements, [
        mesh.positions[at] ?? 0,
        mesh.positions[at + 1] ?? 0,
        mesh.positions[at + 2] ?? 0,
      ])
    }
    for (let index = 0; index + 2 < mesh.indices.length; index += 3) {
      const distance = hitDistance(
        origin,
        lens.forward,
        corner(index),
        corner(index + 1),
        corner(index + 2),
      )
      if (distance !== undefined && distance < best) {
        best = distance
        const uv = (mesh.indices[index] ?? 0) * 2
        found = Option.some(
          spritePixelOf(
            { leaf, placement },
            Math.floor(mesh.uvs[uv] ?? 0),
            Math.floor(mesh.uvs[uv + 1] ?? 0),
          ),
        )
      }
    }
  }
  return found
}

// NOTE: where a sprite pixel shows on the stage: on the face of its leaf's
// blocks nearest the lens, or none off every leaf.
const pinPointOf = (
  lens: Lens,
  stood: ReadonlyArray<Stood>,
  pin: Pin,
): Option.Option<Readonly<{ x: number; y: number }>> =>
  Option.flatMap(
    Array.findLast(stood, one => Option.isSome(texelOf(one, pin))),
    one =>
      Option.map(texelOf(one, pin), ({ column, row }) => {
        const { placement } = one
        const local = placement.isFlipped
          ? placement.texels.width - column - 0.5
          : column + 0.5
        return screenOf(
          lens,
          transformed(placement.elements, [local, -(row + 0.5), 0]),
        )
      }),
  )

// NOTE: the texel of a leaf's art a sprite pixel falls on, through the
// leaf's matrix turned back.
const texelOf = (
  { leaf, placement }: Stood,
  pin: Pin,
): Option.Option<Readonly<{ column: number; row: number }>> => {
  const { shape, matrix } = leaf
  const texels = placement.texels
  if (shape._tag !== 'Image') {
    return Option.none()
  }
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c
  if (Math.abs(determinant) < EPSILON) {
    return Option.none()
  }
  const px = pin.x + 0.5 - matrix.e
  const py = pin.y + 0.5 - matrix.f
  const x = (matrix.d * px - matrix.c * py) / determinant
  const y = (matrix.a * py - matrix.b * px) / determinant
  const column = Math.floor(
    ((x - shape.x) / Math.max(EPSILON, shape.width)) * texels.width,
  )
  const row = Math.floor(
    ((y - shape.y) / Math.max(EPSILON, shape.height)) * texels.height,
  )
  return column >= 0 && row >= 0 && column < texels.width && row < texels.height
    ? Option.some({ column, row })
    : Option.none()
}

// THE RENDERER

// NOTE: mutable on purpose: pixi's own objects, built once and changed each
// frame, as the game's scene holds them.
class StageRenderer {
  private readonly app: Application
  private readonly textures: Textures
  private readonly view: View3D
  private readonly ambient: AmbientLight
  private readonly storm: AmbientLight
  private readonly voxels: VoxelBatch
  private built:
    | Readonly<{
        level: Level
        holder: Container3D
        floor: FloorLayer
        lights: HouseLights
      }>
    | undefined
  private lastLoaded = -1

  constructor(app: Application) {
    this.app = app
    this.textures = new Textures(app, () => undefined)
    this.view = new View3D({
      autoResize: true,
      shadowQuality: 'high',
      toneMapping: 'none',
      environment: { skyColor: 0x9db4ff, groundColor: 0x3a2a30, intensity: 0 },
      passes: [
        new OutlinePass({ width: 0.04, color: 0x1a1220 }),
        new BloomEffect({ threshold: 2, intensity: 1.1, radius: 0.6 }),
      ],
    })
    app.stage.addChild(this.view)
    const { camera, root } = this.view
    camera.mode = 'orthographic'
    camera.near = 0.1
    camera.far = 400
    this.ambient = new AmbientLight({ color: 0xffffff, intensity: AMBIENT })
    this.storm = new AmbientLight({ color: STORM_COLOR, intensity: 0 })
    root.addChild(this.ambient, this.storm)
    const standing = new Container3D()
    root.addChild(standing)
    this.voxels = new VoxelBatch({ parent: standing, textures: this.textures })
  }

  get canvas(): HTMLCanvasElement {
    return this.app.canvas
  }

  private builtFor(level: Level) {
    if (this.built?.level === level) {
      return this.built
    }
    this.dropLevel()
    const holder = new Container3D()
    this.view.root.addChild(holder)
    const floor = new FloorLayer({
      app: this.app,
      textures: this.textures,
      level,
      lift: 0,
      isLit: true,
    })
    holder.addChild(floor.mesh)
    floor.paintLeaves(floorArtOf(level))
    this.lastLoaded = this.textures.loaded
    const built = {
      level,
      holder,
      floor,
      lights: houseLightsOf({ level, parent: holder }),
    }
    this.built = built
    return built
  }

  private dropLevel(): void {
    const built = this.built
    this.built = undefined
    if (built !== undefined) {
      built.holder.destroy({ children: true })
      built.floor.destroy()
    }
  }

  // NOTE: one frame: the thing stood in its preset's light, seen by `lens`,
  // and its leaves as they stood, for a press.
  draw(
    input: Readonly<{
      level: Level
      preset: Preset
      leaves: ReadonlyArray<Leaf>
      footY: number
      most: number
      lens: Lens
    }>,
  ): ReadonlyArray<Stood> {
    const { level, preset, leaves, footY, most, lens } = input
    const ratio = window.devicePixelRatio
    if (
      this.app.renderer.width !== lens.width ||
      this.app.renderer.height !== lens.height ||
      this.app.renderer.resolution !== ratio
    ) {
      this.app.renderer.resize(lens.width, lens.height, ratio)
    }
    const built = this.builtFor(level)
    if (this.textures.loaded !== this.lastLoaded && this.textures.isSettled) {
      this.lastLoaded = this.textures.loaded
      built.floor.paintLeaves(floorArtOf(level))
    }
    const setup = stageSetupOf(level, preset)
    this.textures.lookAt(level, setup.lights.isDark)
    built.lights.apply({
      frame: setup.lights,
      player: {
        ...initialPlayer,
        x: setup.viewer.x,
        y: setup.viewer.y,
        facing: setup.facing,
      },
      view: viewBoxOf({
        x: setup.spot.x - lens.width,
        y: setup.spot.y - lens.height,
        width: lens.width * 2,
        height: lens.height * 2,
        scale: 1,
        left: 0,
        top: 0,
      }),
    })
    const { mood } = setup.lights
    this.ambient.intensity = AMBIENT * mood.ambient * LOOK_TUNING.now.ambient
    this.ambient.color.setValue(
      mixColor({ from: 0xffffff, to: mood.tint, share: mood.tintShare }),
    )
    this.storm.intensity = setup.lights.isInDark ? 0 : STORM_LIFT * mood.strike

    const camera = this.view.camera
    camera.position.set(...lens.position)
    camera.lookAt({
      x: lens.position[0] + lens.forward[0],
      y: lens.position[1] + lens.forward[1],
      z: lens.position[2] + lens.forward[2],
    })
    camera.orthographicSize = lens.halfWidth

    const stood: Array<Stood> = []
    const reach = newReach()
    this.voxels.begin()
    Array.forEach(leaves, (leaf, part) => {
      const standing: StandInput = {
        leaf: {
          ...leaf,
          matrix: {
            ...leaf.matrix,
            e: leaf.matrix.e + setup.spot.x,
            f: leaf.matrix.f + setup.spot.y,
          },
        },
        footY: footY + setup.spot.y,
        part,
        isFlash: isFlashShape(leaf.shape),
        most,
        reach,
      }
      Option.map(this.voxels.placementOf(standing), placement => {
        stood.push({ leaf, placement })
      })
      this.voxels.standLeaf(standing)
    })
    this.voxels.end()
    this.app.render()
    return stood
  }

  destroy(): void {
    this.dropLevel()
    this.voxels.destroy()
    this.textures.destroy()
    this.app.destroy(true, { children: true })
  }
}

const startRenderer = (host: HTMLElement) =>
  Effect.gen(function* () {
    const app = new Application()
    yield* Effect.tryPromise({
      try: () =>
        app.init({
          preference: 'webgl',
          background: 0x000000,
          antialias: false,
          autoStart: false,
          width: Math.max(1, host.clientWidth),
          height: Math.max(1, host.clientHeight),
          resolution: window.devicePixelRatio,
          autoDensity: true,
        }),
      catch: toBrowserError,
    })
    app.canvas.classList.add('stage3d-canvas')
    host.prepend(app.canvas)
    return new StageRenderer(app)
  })

// THE ELEMENT

const NO_SUBJECT: Subject = {
  id: '',
  facing: 'Right',
  tone: 'Normal',
  clockMs: 0,
  most: 16,
}

// NOTE: how often the picture a note sends is copied from the stage, in
// animation frames.
const SHOT_FRAMES = 15

// NOTE: mutable on purpose: a custom element is the browser's own mutable
// object, holding the renderer, the camera's turn, and a drag while it is on
// the page. Built only when it is defined, since HTMLElement exists only in a
// browser.
const studioStageClass = () =>
  class StudioStageElement extends HTMLElement {
    subject: Subject = NO_SUBJECT
    preset: Preset = 'Break'
    house = 0
    isAutoSpin = false
    pins: ReadonlyArray<StagePin> = []
    private latestResets = 0
    private latestTuning: LabEdits = {}
    private isTuneDue = true
    private renderer: Option.Option<StageRenderer> = Option.none()
    private isStarting = false
    private isOnPage = false
    private yaw = 0
    private pitch = PITCH
    private lastTime = 0
    private frameCount = 0
    private maybeDrag: Option.Option<
      Readonly<{ x: number; y: number; yaw: number; pitch: number }>
    > = Option.none()
    private hasDragged = false
    private lastLens: Option.Option<Lens> = Option.none()
    private lastStood: ReadonlyArray<Stood> = []
    private readonly host = document.createElement('div')
    private readonly marks = document.createElement('canvas')
    private readonly shot = document.createElement('canvas')

    get cameraResets(): number {
      return this.latestResets
    }

    set cameraResets(next: number) {
      if (next !== this.latestResets) {
        this.latestResets = next
        this.yaw = 0
        this.pitch = PITCH
      }
    }

    get tuning(): LabEdits {
      return this.latestTuning
    }

    set tuning(next: LabEdits) {
      if (next !== this.latestTuning) {
        this.latestTuning = next
        this.isTuneDue = true
      }
    }

    connectedCallback(): void {
      this.isOnPage = true
      if (this.host.parentNode === null) {
        this.build()
      }
      requestAnimationFrame(time => {
        this.tick(time)
      })
      if (Option.isSome(this.renderer) || this.isStarting) {
        return
      }
      this.isStarting = true
      Effect.runFork(
        startRenderer(this.host).pipe(
          Effect.match({
            onSuccess: renderer => {
              this.isStarting = false
              if (this.isOnPage) {
                this.renderer = Option.some(renderer)
              } else {
                renderer.destroy()
              }
            },
            onFailure: () => {
              this.isStarting = false
              this.host.textContent = 'This browser cannot draw in 3D.'
            },
          }),
        ),
      )
    }

    disconnectedCallback(): void {
      this.isOnPage = false
      const renderer = this.renderer
      this.renderer = Option.none()
      Option.map(renderer, live => {
        live.destroy()
      })
      // NOTE: the Studio's own page reads the tables as shipped once the
      // stage is gone, as the game would.
      tuneTables(tablesOf({}))
      this.isTuneDue = true
    }

    private build(): void {
      this.host.className = 'stage3d-host'
      this.marks.className = 'stage3d-marks'
      this.shot.className = 'stage-shot'
      this.shot.hidden = true
      this.host.append(this.marks)
      this.append(this.host, this.shot)
      this.marks.addEventListener('pointerdown', event => {
        this.marks.setPointerCapture(event.pointerId)
        this.hasDragged = false
        this.maybeDrag = Option.some({
          x: event.clientX,
          y: event.clientY,
          yaw: this.yaw,
          pitch: this.pitch,
        })
      })
      this.marks.addEventListener('pointermove', event => {
        Option.map(this.maybeDrag, drag => {
          const dx = event.clientX - drag.x
          const dy = event.clientY - drag.y
          if (Math.hypot(dx, dy) >= PRESS_SLOP) {
            this.hasDragged = true
          }
          if (this.hasDragged) {
            this.yaw = drag.yaw - dx * DRAG_TURN
            this.pitch = Math.min(
              MAX_PITCH,
              Math.max(MIN_PITCH, drag.pitch + dy * DRAG_TURN),
            )
          }
        })
      })
      this.marks.addEventListener('pointerup', event => {
        const wasPress = Option.isSome(this.maybeDrag) && !this.hasDragged
        this.maybeDrag = Option.none()
        if (!wasPress) {
          return
        }
        const box = this.marks.getBoundingClientRect()
        Option.map(this.lastLens, lens => {
          Option.map(
            pickAt({
              lens,
              point: {
                x: event.clientX - box.left,
                y: event.clientY - box.top,
              },
              stood: this.lastStood,
              most: this.subject.most,
            }),
            pin => {
              this.dispatchEvent(
                new CustomEvent('press-block', { detail: pin }),
              )
            },
          )
        })
      })
    }

    private tick(time: number): void {
      if (!this.isOnPage) {
        return
      }
      const seconds =
        this.lastTime === 0 ? 0 : Math.min(0.1, (time - this.lastTime) / 1000)
      this.lastTime = time
      this.frameCount += 1
      if (this.isAutoSpin && Option.isNone(this.maybeDrag)) {
        this.yaw += seconds * SPIN_SPEED
      }
      Option.map(this.renderer, renderer => {
        this.drawWith(renderer)
      })
      requestAnimationFrame(next => {
        this.tick(next)
      })
    }

    private drawWith(renderer: StageRenderer): void {
      if (this.isTuneDue) {
        this.isTuneDue = false
        tuneTables(tablesOf(this.latestTuning))
      }
      const width = Math.max(1, this.host.clientWidth)
      const height = Math.max(1, this.host.clientHeight)
      const maybeEntry = entryById(this.subject.id)
      if (Option.isNone(maybeEntry)) {
        return
      }
      const entry = maybeEntry.value
      const frames = entry.frames({
        facing: this.subject.facing,
        tone: this.subject.tone,
        clockMs: this.subject.clockMs,
      })
      const shapes = frameOf(
        frames,
        frameIndexOf(entry, this.subject.clockMs, frames.length),
      )
      const bounds = spritesBounds([shapes])
      const tall = Math.max(8, bounds.bottom - bounds.top)
      const wide = Math.max(8, bounds.right - bounds.left)
      const zoom = Math.max(
        MIN_ZOOM,
        Math.min(
          MAX_ZOOM,
          Math.floor(
            Math.min((height * FILL_SHARE) / tall, (width * FILL_SHARE) / wide),
          ),
        ),
      )
      const level = stageLevelOf(this.house)
      const spot = stageSetupOf(level, this.preset).spot
      const middle = ((bounds.bottom - bounds.top) / 2) * UNIT
      const foot: Vector3 = [spot.x * UNIT, 0, zOf(spot.y + bounds.bottom)]
      const lens = lensOf({
        target: add(foot, [CAMERA_UP.x, CAMERA_UP.y, CAMERA_UP.z], middle),
        yaw: this.yaw,
        pitch: this.pitch,
        zoom,
        width,
        height,
      })
      const stood = renderer.draw({
        level,
        preset: this.preset,
        leaves: flatten(shapes),
        footY: bounds.bottom,
        most: this.subject.most,
        lens,
      })
      this.lastLens = Option.some(lens)
      this.lastStood = stood
      if (this.frameCount % SHOT_FRAMES === 0) {
        this.shot.width = renderer.canvas.width
        this.shot.height = renderer.canvas.height
        this.shot.getContext('2d')?.drawImage(renderer.canvas, 0, 0)
      }
      this.drawPins(lens, stood)
    }

    private drawPins(lens: Lens, stood: ReadonlyArray<Stood>): void {
      const ratio = window.devicePixelRatio
      const width = Math.round(lens.width * ratio)
      const height = Math.round(lens.height * ratio)
      if (this.marks.width !== width || this.marks.height !== height) {
        this.marks.width = width
        this.marks.height = height
      }
      const context = this.marks.getContext('2d')
      if (context === null) {
        return
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.clearRect(0, 0, lens.width, lens.height)
      Array.forEach(this.pins, ({ pin, label, color }) => {
        Option.map(pinPointOf(lens, stood, pin), ({ x, y }) => {
          context.beginPath()
          context.arc(x, y, 11, 0, Math.PI * 2)
          context.fillStyle = color
          context.fill()
          context.lineWidth = 2
          context.strokeStyle = '#ffffff'
          context.stroke()
          context.fillStyle = '#14121a'
          context.font = 'bold 12px ui-sans-serif, system-ui, sans-serif'
          context.textAlign = 'center'
          context.textBaseline = 'middle'
          context.fillText(label, x, y + 1)
        })
      })
    }
  }

export const defineStudioStage = (): void => {
  if (customElements.get(TAG) === undefined) {
    customElements.define(TAG, studioStageClass())
  }
}
