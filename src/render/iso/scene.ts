// The game's world drawn in 3D with PixiJS 3D: the bird's-eye view, the
// rooms' light, the cellar's dark, shadows, and wind. It reads each frame the
// view hands it and never writes the Model, so the game plays the same.
//
// How the game's picture becomes 3D, with no art redrawn:
// - The room's floor art (and the decals) paint into textures on a floor
//   plane, through the same Canvas shapes the game builds.
// - Each wall tile ('#') stands up as an ink-outlined toon block.
// - Every standing drawable (zombies, players, props) is made of shapes
//   placed above its foot, so each Image stands up as a billboard at that
//   foot, as tall as it is drawn.
// - What lies on the floor (shadows, bullets, rings) paints into floor
//   textures each frame.
// - Light is new: each room's own, the flames, the lamp that follows the
//   player, the muzzle flash, and glowing tracers.
//
// The camera is locked to the game's own (src/render/camera.ts): the floor
// lands exactly where the game's map puts it, so the aim, the touch controls,
// and the overlay's markers line up with no change.
//
// Everything that moves reads the Model: the wind and the flicker from its
// clock, the flash from the gun's recoil, the camera from the game's. So the
// same frame draws the same picture, as a screenshot or a video wants.

import { Array, Effect, Option, Result } from 'effect'
import type { Canvas } from 'foldkit'
import { Application, type Texture } from 'pixi.js'

import {
  AmbientLight,
  Container3D,
  Material3D,
  Mesh3D as Mesh,
  type Mesh3D,
  PointLight,
  SphereGeometry,
  View3D,
} from '@pixi/3d'
import { BloomEffect, OutlinePass, ToonMaterial } from '@pixi/3d/extras'

import type { Model } from '../../app/model'
import { type BrowserError, toBrowserError } from '../../shared/describeError'
import type { Level } from '../../world/level/arena'
import { levelOf } from '../../world/level/arena'
import { focusOf } from '../../world/party/party'
import {
  airborneParticleShapes,
  decalShapes,
  groundParticleShapes,
} from '../effectsView'
import { muzzleFlashLevel } from '../playerView'
import { hungChandelierShapes } from '../room/room'
import { type TallCover, tallCoverOf } from '../room/tallCover'
import { BillboardPool, BodyCasters, rimUp } from './billboards'
import { type Affine, type Leaf, flatten, rectKey } from './flatten'
import type { IsoFrame } from './frame'
import {
  type Plant,
  type Wall,
  buildWalls,
  cutAway,
  floorArtOf,
  furnitureCastersOf,
  plantsOf,
  standPlant,
} from './house'
import { AMBIENT, lightsFrameOf } from './lightSpecs'
import { type HouseLights, houseLightsOf } from './lights'
import { FloorLayer } from './painter'
import { PITCH, STRETCH, UNIT, zOf } from './space'
import { Textures } from './textures'
import { chandelierSwayAt, windClockOf } from './wind'

const BACKGROUND = 0x16121c
const CAMERA_DISTANCE = 80

// NOTE: whatever floats overhead stands this far over its own bottom edge,
// so it never sinks into what it hangs over.
const OVERHEAD_HOVER = 6

type Built = Readonly<{
  level: Level
  holder: Container3D
  room: FloorLayer
  decals: FloorLayer
  // NOTE: what has landed (casings, gibs, dust), lit as the floor is, so it
  // sinks into the cellar's dark where the glows and rings do not.
  landed: FloorLayer
  ground: FloorLayer
  walls: ReadonlyArray<Wall>
  floorArt: ReadonlyArray<Leaf>
  plants: ReadonlyArray<Plant>
  // NOTE: each tall piece by the shapes the game draws it with, to read the
  // fade the game gives one while someone stands behind it.
  furniture: ReadonlyMap<ReadonlyArray<Canvas.Shape>, TallCover>
  lights: HouseLights
}>

const imageKey = (shape: Leaf['shape'], matrix: Affine): string =>
  shape._tag === 'Image'
    ? `${shape.src}|${shape.x + matrix.e}|${shape.y + matrix.f}`
    : ''

const bottomOf = ({ shape, matrix }: Leaf): number =>
  shape._tag === 'Image' || shape._tag === 'Rect'
    ? matrix.b * shape.x + matrix.d * (shape.y + shape.height) + matrix.f
    : 0

// NOTE: the game hands a tall piece back as its shapes, or as one group of
// them at its fade.
const furnitureOf = (
  furniture: Built['furniture'],
  shapes: ReadonlyArray<Canvas.Shape>,
): Option.Option<Readonly<{ piece: TallCover; opacity: number }>> => {
  const whole = furniture.get(shapes)
  if (whole !== undefined) {
    return Option.some({ piece: whole, opacity: 1 })
  }
  const [first] = shapes
  if (shapes.length !== 1 || first?._tag !== 'Group') {
    return Option.none()
  }
  return Option.map(
    Option.fromUndefinedOr(furniture.get(first.shapes)),
    piece => ({
      piece,
      opacity: first.opacity ?? 1,
    }),
  )
}

const rectKeysOf = (leaves: ReadonlyArray<Leaf>): ReadonlySet<string> =>
  new Set(
    Array.filterMap(leaves, ({ shape }) =>
      shape._tag === 'Rect' ? Result.succeed(rectKey(shape)) : Result.failVoid,
    ),
  )

// NOTE: mutable on purpose: a renderer owns pixi's mutable scene and keeps
// what it built until the level changes.
export class IsoScene {
  private readonly app: Application
  private readonly textures: Textures
  private readonly view: View3D
  private readonly lamp: PointLight
  private readonly flash: PointLight
  private readonly muzzle: Mesh3D
  private readonly muzzleMaterial: Material3D
  private readonly tracerMaterial: Material3D
  private readonly tracerGeometry = new SphereGeometry({ radius: 0.12 })
  private readonly tracers: Array<Mesh3D> = []
  private readonly wallMaterial: ToonMaterial
  private readonly billboards: BillboardPool
  private readonly glowing: BillboardPool
  private readonly rims: BillboardPool
  private readonly bodies: BodyCasters
  private built: Built | undefined
  private casters: Container3D | undefined
  private casterTextures: ReadonlyArray<Texture> = []
  private lastDecals: unknown
  private lastPreload: ReadonlyArray<string> = []
  private lastLoaded = -1

  constructor(app: Application, onLoaded: () => void) {
    this.app = app
    this.textures = new Textures(app, onLoaded)
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
    // NOTE: the rest of the light is each room's own (lights.ts).
    root.addChild(new AmbientLight({ color: 0xffffff, intensity: AMBIENT }))
    this.lamp = new PointLight({ color: 0xffc27a, intensity: 6, range: 6 })
    this.flash = new PointLight({ color: 0xffe08a, intensity: 0, range: 7 })
    root.addChild(this.lamp, this.flash)
    this.tracerMaterial = new Material3D({
      baseColor: 0x000000,
      emissive: { color: 0xffb040, strength: 6 },
    })
    this.muzzleMaterial = new Material3D({
      baseColor: 0x000000,
      emissive: { color: 0xfff0a0, strength: 0 },
    })
    this.muzzle = new Mesh({
      geometry: new SphereGeometry({ radius: 0.28 }),
      material: this.muzzleMaterial,
      castShadow: false,
    })
    root.addChild(this.muzzle)
    this.wallMaterial = new ToonMaterial({
      baseColor: 0x5a4458,
      bands: 3,
      specularSize: 0,
      rimIntensity: 0.3,
      outline: true,
    })
    const standing = new Container3D()
    root.addChild(standing)
    const textures = this.textures
    this.billboards = new BillboardPool({
      parent: standing,
      textures,
      isLit: true,
    })
    this.glowing = new BillboardPool({
      parent: standing,
      textures,
      isLit: false,
    })
    this.rims = new BillboardPool({ parent: standing, textures, isLit: false })
    this.bodies = new BodyCasters({ parent: standing, textures })
  }

  draw(
    frame: IsoFrame,
    size: Readonly<{ width: number; height: number }>,
  ): void {
    const { model, strata, camera, shake } = frame
    if (frame.preload !== this.lastPreload) {
      this.lastPreload = frame.preload
      Array.forEach(frame.preload, src => {
        this.textures.preload(src)
      })
    }
    // NOTE: the renderer's size is in CSS pixels; its canvas holds those
    // times the resolution.
    const width = Math.max(1, Math.round(size.width))
    const height = Math.max(1, Math.round(size.height))
    if (
      this.app.renderer.width !== width ||
      this.app.renderer.height !== height
    ) {
      this.app.renderer.resize(width, height)
    }
    const built = this.builtFor(levelOf(model))
    if (this.textures.loaded !== this.lastLoaded) {
      this.lastLoaded = this.textures.loaded
      built.room.paintLeaves(built.floorArt)
      this.lastDecals = undefined
      this.castFurniture(built)
    }
    const decals = model.decals
    if (decals !== this.lastDecals) {
      this.lastDecals = decals
      built.decals.paint(decalShapes(decals))
    }

    // THE CAMERA
    // NOTE: locked to the game's camera: the middle of what it shows, less
    // the shake, as wide as it is.
    const lookX = (camera.x + camera.width / 2 - shake.x) * UNIT
    const lookZ = zOf(camera.y + camera.height / 2 - shake.y)
    this.view.camera.position.set(
      lookX,
      Math.sin(PITCH) * CAMERA_DISTANCE,
      lookZ + Math.cos(PITCH) * CAMERA_DISTANCE,
    )
    this.view.camera.lookAt({ x: lookX, y: 0, z: lookZ })
    this.view.camera.orthographicSize = (camera.width * UNIT) / 2
    // NOTE: one screen pixel, in game pixels.
    const grid = camera.width / Math.max(1, this.app.canvas.width)

    const { player } = focusOf(model)
    cutAway({ walls: built.walls, player })

    // THE FLOOR
    const landed = flatten(groundParticleShapes(model.particles))
    const landedKeys = rectKeysOf(landed)
    built.landed.paintLeaves(landed)
    built.ground.paintLeaves(
      Array.filter(
        flatten(strata.ground),
        ({ shape }) =>
          !(shape._tag === 'Rect' && landedKeys.has(rectKey(shape))),
      ),
    )

    // WHAT STANDS
    const flashLevel = muzzleFlashLevel(player)
    const lamp = { x: player.x, y: player.y, flash: flashLevel }
    const fades = new Map<TallCover, number>()
    this.billboards.begin(grid)
    this.glowing.begin(grid)
    this.rims.begin(grid)
    this.bodies.begin()
    for (const drawable of strata.standing) {
      const maybePiece = furnitureOf(built.furniture, drawable.shapes)
      if (Option.isSome(maybePiece)) {
        fades.set(maybePiece.value.piece, maybePiece.value.opacity)
      } else {
        this.billboards.standUp(drawable.shapes, drawable.footY)
        const leaves = flatten(drawable.shapes)
        rimUp({
          pool: this.rims,
          textures: this.textures,
          leaves,
          footY: drawable.footY,
          lamp,
        })
        this.bodies.cast(leaves, drawable.footY)
      }
    }
    for (const piece of built.furniture.values()) {
      this.billboards.standUp(piece.shapes, piece.footY, fades.get(piece) ?? 1)
    }
    const t = windClockOf(model.elapsedMs)
    for (const plant of built.plants) {
      standPlant({ pool: this.billboards, plant, t })
    }

    // WHAT FLOATS
    const chandelier = new Set(
      Array.map(flatten(hungChandelierShapes(model)), ({ shape, matrix }) =>
        imageKey(shape, matrix),
      ),
    )
    const sway = chandelierSwayAt(t)
    // NOTE: sparks, blood, and dust in the air are lit as the bodies are, so
    // they vanish into the cellar's dark with them.
    const airborne = rectKeysOf(
      flatten(airborneParticleShapes(model.particles)),
    )
    for (const leaf of flatten(strata.overhead)) {
      const { shape, matrix, alpha } = leaf
      const isChandelier =
        shape._tag === 'Image' && chandelier.has(imageKey(shape, matrix))
      const isLitInAir =
        isChandelier || (shape._tag === 'Rect' && airborne.has(rectKey(shape)))
      const pool = isLitInAir ? this.billboards : this.glowing
      pool.standLeaves(
        [
          {
            shape,
            matrix: isChandelier ? { ...matrix, e: matrix.e + sway } : matrix,
            alpha,
          },
        ],
        bottomOf(leaf) + 2,
        OVERHEAD_HOVER,
        1,
      )
    }
    this.billboards.end()
    this.glowing.end()
    this.rims.end()
    this.bodies.end()

    // THE LIGHTS
    const px = player.x * UNIT
    const pz = zOf(player.y)
    this.lamp.position.set(px, 1.6, pz)
    built.lights.apply(
      lightsFrameOf({ world: model, level: built.level, viewer: player }),
      player,
    )
    const muzzleX = px + player.facing.x * 0.9
    const muzzleZ = pz + player.facing.y * 0.9 * STRETCH
    this.flash.position.set(muzzleX, 0.9, muzzleZ)
    this.flash.intensity = 24 * flashLevel
    this.muzzle.position.set(muzzleX, 0.8, muzzleZ)
    this.muzzle.scale.set(flashLevel, flashLevel, flashLevel)
    if (this.muzzleMaterial.emissive !== undefined) {
      this.muzzleMaterial.emissive.strength = 8 * flashLevel
    }
    this.drawTracers(model)

    this.app.render()
  }

  // NOTE: each bullet glows as a tracer over the floor's own drawing.
  private drawTracers(model: Model): void {
    Array.forEach(model.bullets, (bullet, index) => {
      const tracer = this.tracers[index] ?? this.newTracer()
      tracer.visible = true
      tracer.position.set(bullet.x * UNIT, 0.7, zOf(bullet.y))
    })
    for (
      let index = model.bullets.length;
      index < this.tracers.length;
      index += 1
    ) {
      const tracer = this.tracers[index]
      if (tracer !== undefined) {
        tracer.visible = false
      }
    }
  }

  private newTracer(): Mesh3D {
    const tracer = new Mesh({
      geometry: this.tracerGeometry,
      material: this.tracerMaterial,
      castShadow: false,
    })
    this.tracers.push(tracer)
    this.view.root.addChild(tracer)
    return tracer
  }

  private builtFor(level: Level): Built {
    if (this.built?.level === level) {
      return this.built
    }
    this.dropLevel()
    const holder = new Container3D()
    this.view.root.addChild(holder)
    const layer = (lift: number, isLit: boolean): FloorLayer =>
      new FloorLayer({
        app: this.app,
        textures: this.textures,
        level,
        lift,
        isLit,
      })
    const room = layer(0, true)
    const decals = layer(0.005, true)
    const landed = layer(0.008, true)
    const ground = layer(0.012, false)
    const walls = buildWalls({ level, material: this.wallMaterial })
    holder.addChild(room.mesh, decals.mesh, landed.mesh, ground.mesh)
    Array.forEach(walls, ({ mesh }) => {
      holder.addChild(mesh)
    })
    const floorArt = floorArtOf(level)
    room.paintLeaves(floorArt)
    this.lastDecals = undefined
    const built: Built = {
      level,
      holder,
      room,
      decals,
      landed,
      ground,
      walls,
      floorArt,
      plants: plantsOf({ app: this.app, level }),
      furniture: new Map(
        Array.map(tallCoverOf(level), piece => [piece.shapes, piece] as const),
      ),
      lights: houseLightsOf({ level, parent: holder }),
    }
    this.built = built
    this.castFurniture(built)
    return built
  }

  private castFurniture(built: Built): void {
    this.dropCasters()
    const casters = new Container3D()
    built.holder.addChild(casters)
    this.casters = casters
    this.casterTextures = furnitureCastersOf({
      app: this.app,
      textures: this.textures,
      parent: casters,
      pieces: [...built.furniture.values()],
      plants: built.plants,
    })
  }

  private dropCasters(): void {
    this.casters?.destroy({ children: true })
    this.casters = undefined
    Array.forEach(this.casterTextures, texture => {
      texture.destroy(true)
    })
    this.casterTextures = []
  }

  private dropLevel(): void {
    this.dropCasters()
    const built = this.built
    if (built === undefined) {
      return
    }
    built.holder.destroy({ children: true })
    Array.forEach(
      [built.room, built.decals, built.landed, built.ground],
      layer => {
        layer.destroy()
      },
    )
    Array.forEach(built.plants, ({ clumps }) => {
      Array.forEach(clumps, ({ texture }) => {
        texture.destroy(true)
      })
    })
    this.built = undefined
  }

  destroy(): void {
    this.dropLevel()
    this.textures.destroy()
    this.app.destroy(true, { children: true })
  }
}

// NOTE: the renderer on a canvas in `host`, WebGPU where there is one and
// WebGL2 otherwise. It never runs a ticker: the element draws each frame the
// view hands it, and only then.
export const createIsoScene = ({
  host,
  onLoaded,
}: Readonly<{ host: HTMLElement; onLoaded: () => void }>): Effect.Effect<
  IsoScene,
  BrowserError
> =>
  Effect.gen(function* () {
    const app = new Application()
    yield* Effect.tryPromise({
      try: () =>
        app.init({
          preference: 'webgpu',
          background: BACKGROUND,
          antialias: false,
          autoStart: false,
          width: Math.max(1, host.clientWidth),
          height: Math.max(1, host.clientHeight),
          resolution: Math.min(window.devicePixelRatio, 2),
          autoDensity: true,
        }),
      catch: toBrowserError,
    })
    app.canvas.classList.add('world-canvas')
    host.append(app.canvas)
    return new IsoScene(app, onLoaded)
  })
