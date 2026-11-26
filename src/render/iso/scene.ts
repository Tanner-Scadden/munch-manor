import { Array, Effect, Option } from 'effect'
import { Application, Texture } from 'pixi.js'

import {
  AmbientLight,
  Container3D,
  FlatMaterial,
  Material3D,
  Mesh3D as Mesh,
  type Mesh3D,
  PointLight,
  SphereGeometry,
  View3D,
} from '@pixi/3d'
import { ToonMaterial } from '@pixi/3d/extras'

import type { Model } from '#app/model.ts'
import { FRAME_ROWS } from '#art/appearance.ts'
import {
  eyePixelsOf,
  isFlashShape,
  isGlowShape,
  isGlowingShape,
} from '#art/sprite.ts'
import type { Drawable } from '#render/depth.ts'
import type * as Draw from '#render/draw.ts'
import {
  airborneParticlesOf,
  decalShapes,
  groundParticleShapes,
} from '#render/effectsView.ts'
import { houseRattleOf } from '#render/juice.ts'
import {
  muzzleFlashLevel,
  muzzlePointOf,
  playerFootY,
} from '#render/playerView.ts'
import type { TallCover } from '#render/room/tallCover.ts'
import { type BrowserError, toBrowserError } from '#shared/describeError.ts'
import { isChandelierDown } from '#world/dining/chandelier.ts'
import { puddleOf } from '#world/kitchen/soupPot.ts'
import type { Level } from '#world/level/arena.ts'
import { levelOf, standingLevelOf } from '#world/level/arena.ts'
import { focusOf } from '#world/party/party.ts'

import { airOf } from './air.ts'
import { BillboardPool, rimUp } from './billboards.ts'
import { crittersOf } from './critters.ts'
import { boxFloorOf, isNearView, viewBoxOf, viewFloorOf } from './cull.ts'
import {
  DIORAMA_AMBIENT,
  IsoLens,
  dioramaCameraOf,
  dioramaStepOf,
} from './diorama.ts'
import { HouseGlows } from './emissives.ts'
import { ballMiddleOf, blastLightOf, blastPiecesOf } from './explosions.ts'
import { IDENTITY, type Leaf, flatten } from './flatten.ts'
import type { IsoFrame } from './frame.ts'
import { Furniture } from './furniture.ts'
import { GodRays, shaftMotesOf } from './godRays.ts'
import { GroundRects, splitGround } from './groundRects.ts'
import {
  type ArtMesh,
  type Caster,
  type Plant,
  buildArtQuads,
  buildFannedBlocks,
  buildLintels,
  buildWallArt,
  buildWallDark,
  buildWalls,
  cutoutBoxOf,
  floorArtOf,
  plantCastersOf,
  plantsOf,
  standPlant,
} from './house.ts'
import { LeakLayer } from './leakLayer.ts'
import { dripsOf } from './leaks.ts'
import { aimSceneCamera, sceneLensOf } from './lensCamera.ts'
import { AMBIENT, type LightsFrame, lightsFrameOf } from './lightSpecs.ts'
import { type HouseLights, houseLightsOf } from './lights.ts'
import { LOOK_TUNING } from './lookSpecs.ts'
import { mixColor } from './mood.ts'
import { FloorLayer, FloorPicture } from './painter.ts'
import { type PlinthPicture, PlinthStage } from './plinth.ts'
import type { PlinthPose } from './plinthPose.ts'
import {
  auraCubesOf,
  auraFeetOf,
  auraFrameOf,
  isPowerupImage,
  pickupRingOf,
  pickupSpinOf,
} from './powerups.ts'
import type { QualityTier } from './quality.ts'
import { WorldQuality } from './qualityControl.ts'
import { ShadowWatch } from './shadowWatch.ts'
import {
  type Chandelier,
  type Shelf,
  chandelierOf,
  isChandelierSprite,
  shelfOf,
} from './showpieces.ts'
import { SoupLayer } from './soupLayer.ts'
import { OVERHEAD_FOOT_PX, UNIT, standingPointOf, zOf } from './space.ts'
import { FAR_KEY, stormKeyOf, stormOf, stormQuadsOf } from './storm.ts'
import { Textures, colorOf } from './textures.ts'
import { VoxelBatch, newReach } from './voxels.ts'
import { chandelierSwayAt, windClockOf } from './wind.ts'

export const STORM_COLOR = 0xdce6ff
export const STORM_LIFT = AMBIENT * 3

const BACKGROUND = 0x000000
const GROUND_LIFT = 0.012
const LENS_NEAR = 4
const LENS_FAR = 200
const TRACER_RADIUS = 0.05

const MOST_DEPTH: Readonly<Partial<Record<Drawable['rank'], number>>> = {
  Zombie: 16,
  Player: 16,
  Pickup: 8,
  Trap: 6,
  Prop: 6,
}

const BLAST_LIGHT_COLOR = 0xffa850
const BLAST_LIGHT_PEAK = 60
const BLAST_LIGHT_REACH = 2.5

const LAMP_OUT = 1.41
const FLASH_OUT = 0.8
const BLAST_OUT = 1.06

const GLOW_FOOT_PX = 1

const OVERHEAD_HOVER = 6

const DECALS_COAT = 0
const LANDED_COAT = 1

type Built = Readonly<{
  level: Level
  holder: Container3D
  room: FloorPicture
  floor: FloorLayer
  ground: FloorLayer
  groundRects: GroundRects
  storm: FloorPicture
  leaks: LeakLayer
  soup: SoupLayer
  floorArt: ReadonlyArray<Leaf>
  plants: ReadonlyArray<Plant>
  furniture: Furniture
  lights: HouseLights
  rays: GodRays
  glows: HouseGlows
  fans: ReadonlyArray<ArtMesh>
  chandelier: Option.Option<Chandelier>
  shelf: Option.Option<Shelf>
}>

const bottomOf = ({ shape, matrix }: Leaf): number =>
  shape._tag === 'Image' || shape._tag === 'Rect'
    ? matrix.b * shape.x + matrix.d * (shape.y + shape.height) + matrix.f
    : 0

const lookLightsOf = (frame: LightsFrame, level: Level): LightsFrame => {
  const look = LOOK_TUNING.now
  return {
    ...frame,
    fillShares: Array.map(frame.fillShares, (share, index) =>
      Option.match(Array.get(level.rooms, index), {
        onNone: () => 0,
        onSome: ({ id, isOpen }) =>
          isOpen ? share * (look.rooms[id]?.fill ?? look.roomFill) : 0,
      }),
    ),
  }
}

const isCarved = (built: Built, drawable: Drawable): boolean => {
  const [first] = drawable.shapes
  return (
    Option.isSome(built.chandelier) &&
    drawable.shapes.length === 1 &&
    first?._tag === 'Image' &&
    isChandelierSprite(first)
  )
}

export class IsoScene {
  private readonly app: Application
  private readonly textures: Textures
  private readonly view: View3D
  private readonly lamp: PointLight
  private readonly ambient: AmbientLight
  private readonly storm: AmbientLight
  private ambientColor = 0xffffff
  private readonly flash: PointLight
  private readonly tracerMaterial: Material3D
  private readonly tracerGeometry = new SphereGeometry({
    radius: TRACER_RADIUS,
  })
  private readonly tracers: Array<Mesh3D> = []
  private readonly wallMaterial: ToonMaterial
  private readonly billboards: BillboardPool
  private readonly glowing: BillboardPool
  private readonly rims: BillboardPool
  private readonly voxels: VoxelBatch
  private readonly blastLight: PointLight
  private built: Built | undefined
  private casters: Container3D | undefined
  private plantCasters: ReadonlyArray<Caster> = []
  private readonly shadowWatch = new ShadowWatch()
  private lastDecals: unknown
  private wasLanded = false
  private stormKey: string | undefined
  private lastPreload: ReadonlyArray<string> = []
  private lastLoaded = -1
  private plinth: PlinthStage | undefined
  private readonly quality: WorldQuality

  constructor(app: Application, onLoaded: () => void) {
    this.app = app
    this.textures = new Textures(app, onLoaded)
    this.quality = new WorldQuality(app)
    this.view = new View3D({
      autoResize: true,
      toneMapping: 'none',
      environment: { skyColor: 0x9db4ff, groundColor: 0x3a2a30, intensity: 0 },
      ...this.quality.viewOptions,
    })
    app.stage.addChild(this.view)
    const { camera, root } = this.view
    camera.mode = 'perspective'
    camera.near = LENS_NEAR
    camera.far = LENS_FAR
    this.ambient = new AmbientLight({ color: 0xffffff, intensity: AMBIENT })
    this.storm = new AmbientLight({ color: STORM_COLOR, intensity: 0 })
    root.addChild(this.ambient, this.storm)
    this.lamp = new PointLight({ color: 0xffc27a, intensity: 6, range: 6 })
    this.flash = new PointLight({ color: 0xffe08a, intensity: 0, range: 7 })
    this.blastLight = new PointLight({
      color: BLAST_LIGHT_COLOR,
      intensity: 0,
      range: 4,
    })
    root.addChild(this.lamp, this.flash, this.blastLight)
    this.tracerMaterial = new Material3D({
      baseColor: 0x000000,
      emissive: { color: 0xffb040, strength: 6 },
    })
    this.wallMaterial = new ToonMaterial({
      baseColor: 0x5a4458,
      bands: 3,
      specularSize: 0,
      rimIntensity: 0.3,
      outline: false,
      ...this.textures.lookOptions('Toon'),
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
    this.voxels = new VoxelBatch({
      parent: standing,
      textures,
      watch: this.shadowWatch,
    })
  }

  draw(
    frame: IsoFrame,
    size: Readonly<{ width: number; height: number }>,
    options: Readonly<{ isStill: boolean }>,
  ): void {
    const { model, strata, camera, shake } = frame
    const atMs = this.quality.begin()
    if (frame.preload !== this.lastPreload) {
      this.lastPreload = frame.preload
      Array.forEach(frame.preload, src => {
        this.textures.preload(src)
      })
    }
    const ratio = window.devicePixelRatio
    const devicePerGamePixel = (size.width * ratio) / Math.max(1, camera.width)
    const step = IsoLens.match(frame.lens, {
      Play: () => this.quality.playStepOf({ devicePerGamePixel, ratio }),
      Diorama: () => dioramaStepOf(devicePerGamePixel),
    })
    const resolution = ratio / step
    const width = Math.max(
      1,
      Math.ceil((size.width * ratio) / step) / resolution,
    )
    const height = Math.max(
      1,
      Math.ceil((size.height * ratio) / step) / resolution,
    )
    if (
      this.app.renderer.width !== width ||
      this.app.renderer.height !== height ||
      this.app.renderer.resolution !== resolution
    ) {
      this.app.renderer.resize(width, height, resolution)
      this.quality.hold(atMs)
    }
    const wasBuilt = this.built
    const built = this.builtFor(standingLevelOf(levelOf(model)))
    if (built !== wasBuilt) {
      this.quality.hold(atMs)
    }
    if (
      this.textures.loaded !== this.lastLoaded &&
      (this.textures.isSettled || this.lastLoaded < 0)
    ) {
      this.lastLoaded = this.textures.loaded
      built.room.paintLeaves(built.floorArt)
      this.lastDecals = undefined
    }
    const decals = model.cosmetics.decals
    const isDecalsChanged = decals !== this.lastDecals
    if (isDecalsChanged) {
      this.lastDecals = decals
      built.floor.picture.paintCoat(DECALS_COAT, flatten(decalShapes(decals)))
    }

    const canvasSize = {
      width: this.app.canvas.width,
      height: this.app.canvas.height,
    }
    const lens = sceneLensOf(camera, shake, canvasSize)
    const view = IsoLens.match(frame.lens, {
      Play: () => {
        this.view.camera.mode = 'perspective'
        aimSceneCamera(this.view.camera, lens, canvasSize)
        return viewBoxOf(lens.frame)
      },
      Diorama: ({ clockMs }) => {
        const diorama = dioramaCameraOf({
          clockMs,
          isStill: options.isStill,
          target: lens.lookedAt,
          centerX: camera.x + camera.width / 2,
          centerY: camera.y + camera.height / 2,
          canvasWidth: canvasSize.width,
          canvasHeight: canvasSize.height,
        })
        this.view.camera.mode = 'orthographic'
        this.view.camera.position.set(
          diorama.position.x,
          diorama.position.y,
          diorama.position.z,
        )
        this.view.camera.lookAt(diorama.target)
        this.view.camera.orthographicSize = diorama.orthographicSize
        return diorama.view
      },
    })

    const fanEye = IsoLens.match(frame.lens, {
      Play: () => Option.some(lens.eye),
      Diorama: () => Option.none(),
    })
    Array.forEach(built.fans, fan => {
      fan.fanFrom(fanEye)
    })
    built.glows.fanFrom(fanEye)

    const { player } = focusOf(model)
    const rattle = houseRattleOf(model.shake.trauma)

    const landed = flatten(groundParticleShapes(model.cosmetics.particles))
    const isLanded = landed.length > 0
    if (isDecalsChanged || isLanded || this.wasLanded) {
      built.floor.picture.paintCoat(LANDED_COAT, landed)
      built.floor.picture.render()
    }
    this.wasLanded = isLanded
    const isDown = isChandelierDown(model)
    const ground = splitGround([
      ...Option.match(built.chandelier, {
        onNone: () => [],
        onSome: chandelier => chandelier.floorMarks(isDown),
      }),
      ...flatten(strata.ground),
    ])
    built.ground.paintLeaves(ground.rest)
    built.groundRects.draw(ground.rects)
    const stormKey = stormKeyOf({
      world: model,
      level: built.level,
      viewer: player,
    })
    if (stormKey !== this.stormKey) {
      this.stormKey = stormKey
      built.storm.paint(
        stormKey === FAR_KEY
          ? []
          : stormOf({ world: model, level: built.level }),
      )
    }
    built.leaks.paint({ world: model, viewer: player })
    built.soup.paint({
      world: model,
      isSpilled: Option.isSome(puddleOf(model)),
    })

    const flashLevel = muzzleFlashLevel(player)
    const lamp = { x: player.x, y: player.y, flash: flashLevel }
    const fades = new Map<TallCover, number>()
    this.billboards.begin()
    this.glowing.begin()
    this.rims.begin()
    this.voxels.begin()
    this.shadowWatch.begin()
    for (const drawable of strata.standing) {
      if (drawable.rank === 'Glow') {
        const glow = flatten(drawable.shapes)
        let footY = drawable.footY
        for (const leaf of glow) {
          footY = Math.max(footY, bottomOf(leaf) + GLOW_FOOT_PX)
        }
        this.glowing.standLeaves(glow, footY, 0, 1)
        continue
      }
      if (isCarved(built, drawable)) {
        continue
      }
      const maybePiece = built.furniture.fadeOf(drawable.shapes)
      if (Option.isSome(maybePiece)) {
        fades.set(maybePiece.value.cover, maybePiece.value.opacity)
      } else {
        const leaves = flatten(drawable.shapes)
        const most = MOST_DEPTH[drawable.rank]
        if (most !== undefined) {
          this.standBody({
            leaves,
            footY: drawable.footY,
            elapsedMs: model.elapsedMs,
            most,
          })
        } else {
          const lit: Array<Leaf> = []
          const flashing: Array<Leaf> = []
          for (const leaf of leaves) {
            ;(isFlashShape(leaf.shape) || isGlowShape(leaf.shape)
              ? flashing
              : lit
            ).push(leaf)
          }
          this.billboards.standLeaves(lit, drawable.footY, 0, 1)
          this.glowing.standLeaves(flashing, drawable.footY, 0, 1)
          rimUp({
            pool: this.rims,
            textures: this.textures,
            leaves,
            footY: drawable.footY,
            lamp,
          })
        }
      }
    }
    this.shadowWatch.note(built.furniture.apply({ fades, view }))
    let plantsShown = 0
    for (const { mesh, box } of this.plantCasters) {
      mesh.visible = isNearView(box, view)
      plantsShown = Math.imul(plantsShown, 31) + (mesh.visible ? 1 : 2)
    }
    this.shadowWatch.note(plantsShown)
    const t = windClockOf(model.elapsedMs)
    for (const plant of built.plants) {
      if (isNearView(cutoutBoxOf(plant.caster), view)) {
        standPlant({ pool: this.billboards, plant, t })
      }
    }

    const sway = chandelierSwayAt(t) + Math.round(Math.sin(t * 38) * rattle * 3)
    Option.map(built.chandelier, carved => {
      this.shadowWatch.note(carved.apply({ isDown, sway, view }))
    })
    Option.map(built.shelf, shelf => {
      shelf.apply(view)
    })
    for (const particle of airborneParticlesOf(model.cosmetics.particles)) {
      const { shape } = particle
      if (shape._tag !== 'Rect') {
        continue
      }
      const look = colorOf(shape.fill ?? '#000')
      const isCubed =
        look.alpha >= 0.98 &&
        this.voxels.standCube({
          x: particle.x,
          footY: particle.footY,
          rise: particle.rise,
          width: shape.width,
          height: shape.height,
          color: look.color,
          glow: particle.isGlowing ? 1 : 0,
        })
      if (!isCubed) {
        const leaf = { shape, matrix: IDENTITY, alpha: 1 }
        this.billboards.standLeaves(
          [leaf],
          bottomOf(leaf) + OVERHEAD_FOOT_PX,
          OVERHEAD_HOVER,
          1,
        )
      }
    }
    this.standBlasts(model)
    for (const leaf of flatten(strata.overhead)) {
      const { shape, matrix, alpha } = leaf
      const isChandelier = shape._tag === 'Image' && isChandelierSprite(shape)
      if (isChandelier && Option.isSome(built.chandelier)) {
        continue
      }
      const pool = isChandelier ? this.billboards : this.glowing
      pool.standLeaves(
        [
          {
            shape,
            matrix: isChandelier ? { ...matrix, e: matrix.e + sway } : matrix,
            alpha,
          },
        ],
        bottomOf(leaf) + OVERHEAD_FOOT_PX,
        OVERHEAD_HOVER,
        1,
      )
    }

    for (const mote of [
      ...airOf({ world: model, level: built.level, viewer: player, rattle }),
      ...crittersOf({ world: model, level: built.level }),
      ...dripsOf({ world: model, level: built.level }),
      ...built.soup.bubblesOf(model),
      ...shaftMotesOf({ world: model, level: built.level, viewer: player }),
    ]) {
      ;(mote.isGlowing ? this.glowing : this.billboards).place({
        texture: Texture.WHITE,
        centerX: mote.x + (mote.width ?? 1) / 2,
        bottom: mote.y,
        drawnWidth: mote.width ?? 1,
        drawnHeight: 1,
        tint: mote.color,
        alpha: mote.alpha,
        footY: mote.y,
        hover: mote.hover,
        part: 0,
      })
    }
    this.billboards.end()
    this.glowing.end()
    this.rims.end()
    this.voxels.end()
    this.shadowWatch.end()

    const lampAt = standingPointOf({
      x: player.x,
      footY: playerFootY(player),
      atY: playerFootY(player) - FRAME_ROWS,
      out: LAMP_OUT,
    })
    this.lamp.position.set(lampAt.x, lampAt.y, lampAt.z)
    const lights = lookLightsOf(
      lightsFrameOf({
        world: model,
        level: built.level,
        viewer: player,
        rattle,
      }),
      built.level,
    )
    built.lights.apply({
      frame: lights,
      player,
      floor: IsoLens.match(frame.lens, {
        Play: () => viewFloorOf(lens.frame),
        Diorama: () => boxFloorOf(view),
      }),
    })
    this.textures.lookAt(built.level, lights.isDark)
    built.rays.apply({ world: model, player, isInDark: lights.isInDark })
    const { mood } = lights
    this.ambient.intensity =
      AMBIENT *
      mood.ambient *
      LOOK_TUNING.now.ambient *
      IsoLens.match(frame.lens, {
        Play: () => 1,
        Diorama: () => DIORAMA_AMBIENT,
      })
    const ambientColor = mixColor({
      from: 0xffffff,
      to: mood.tint,
      share: mood.tintShare,
    })
    if (ambientColor !== this.ambientColor) {
      this.ambientColor = ambientColor
      this.ambient.color.setValue(ambientColor)
    }
    this.storm.intensity = lights.isInDark ? 0 : STORM_LIFT * mood.strike
    const muzzle = muzzlePointOf(player)
    const flashAt = standingPointOf({
      x: muzzle.x,
      footY: Math.max(playerFootY(player), muzzle.y + GLOW_FOOT_PX),
      atY: muzzle.y,
      out: FLASH_OUT,
    })
    this.flash.position.set(flashAt.x, flashAt.y, flashAt.z)
    this.flash.intensity = 24 * flashLevel
    this.drawTracers(model)

    this.app.render()
    this.quality.end(frame, this.view)
  }

  get tier(): QualityTier {
    return this.quality.tier
  }

  private standBody(
    input: Readonly<{
      leaves: ReadonlyArray<Leaf>
      footY: number
      elapsedMs: number
      most: number
    }>,
  ): void {
    const { leaves, footY, elapsedMs, most } = input
    const reach = newReach()
    const isPowerup = Array.some(
      leaves,
      ({ shape }) => shape._tag === 'Image' && isPowerupImage(shape),
    )
    let part = 0
    for (const leaf of leaves) {
      const { shape, matrix } = leaf
      if (shape._tag === 'Image' && Option.isSome(auraFrameOf(shape))) {
        this.standAura(shape, matrix)
      } else if (isPowerup && shape._tag === 'Circle') {
        this.standPickupRing(shape, matrix, footY, elapsedMs)
      } else {
        const isFlash = isFlashShape(shape)
        const spin =
          shape._tag === 'Image' && isPowerupImage(shape)
            ? pickupSpinOf({ elapsedMs, x: matrix.e })
            : undefined
        if (
          !this.voxels.standLeaf({
            leaf,
            footY,
            part,
            isFlash,
            isGlowing: isGlowingShape(shape),
            most,
            reach,
            ...(spin === undefined ? {} : { spin }),
            eyes: eyePixelsOf(shape),
          })
        ) {
          ;(isFlash || isGlowShape(shape)
            ? this.glowing
            : this.billboards
          ).standLeaf(leaf, footY, part)
        }
      }
      part += 1
    }
  }

  private standAura(image: Draw.Image, matrix: Leaf['matrix']): void {
    Option.match(auraFrameOf(image), {
      onNone: () => undefined,
      onSome: ({ kind, frame }) => {
        for (const cube of auraCubesOf({
          kind,
          frame,
          feet: auraFeetOf({ image, matrix }),
        })) {
          this.voxels.standCube({ ...cube, width: 1, height: 1 })
        }
      },
    })
  }

  private standPickupRing(
    circle: Draw.Circle,
    matrix: Leaf['matrix'],
    footY: number,
    elapsedMs: number,
  ): void {
    if (circle.fill === undefined) {
      return
    }
    const { color } = colorOf(circle.fill)
    for (const cube of pickupRingOf({
      x: matrix.a * circle.x + matrix.c * circle.y + matrix.e,
      footY,
      radius: circle.radius,
      color,
      elapsedMs,
    })) {
      this.voxels.standCube({ ...cube, width: 1, height: 1 })
    }
  }

  private standBlasts(model: Model): void {
    let brightest = 0
    for (const blast of model.cosmetics.blasts) {
      for (const piece of blastPiecesOf(blast)) {
        this.voxels.standCube({
          x: piece.x,
          footY: piece.footY,
          rise: piece.rise,
          width: piece.width,
          height: piece.height,
          color: piece.color,
          glow: piece.glow,
        })
      }
      const level = blastLightOf(blast)
      if (level > brightest) {
        brightest = level
        const blastAt = standingPointOf({
          x: blast.x,
          footY: blast.y,
          atY: blast.y - ballMiddleOf(blast),
          out: BLAST_OUT,
        })
        this.blastLight.position.set(blastAt.x, blastAt.y, blastAt.z)
        this.blastLight.range = Math.max(
          3,
          blast.radius * UNIT * BLAST_LIGHT_REACH,
        )
      }
    }
    this.blastLight.intensity = BLAST_LIGHT_PEAK * brightest
  }

  private drawTracers(model: Model): void {
    Array.forEach(model.bullets, (bullet, index) => {
      const tracer = this.tracers[index] ?? this.newTracer()
      tracer.visible = true
      tracer.position.set(bullet.x * UNIT, TRACER_RADIUS, zOf(bullet.y))
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
    const app = this.app
    const textures = this.textures
    const room = new FloorPicture({ app, textures, level })
    const floor = new FloorLayer({
      app,
      textures,
      level,
      lift: 0,
      isLit: true,
      coats: 2,
      base: room.texture,
    })
    const ground = new FloorLayer({
      app,
      textures,
      level,
      lift: GROUND_LIFT,
      isLit: false,
    })
    const storm = new FloorPicture({ app, textures, level })
    const stormQuads = buildArtQuads({
      level,
      material: new FlatMaterial({
        baseColorTexture: storm.texture,
        alphaMode: 'blend',
      }),
      quads: stormQuadsOf(level),
    })
    const walls = [
      ...buildWalls({ level, material: this.wallMaterial }),
      ...buildLintels({ level, material: this.wallMaterial }),
    ]
    const wallArt = new Material3D({
      baseColorTexture: room.texture,
      roughness: 1,
      metallic: 0,
      specular: { factor: 0 },
      ...textures.lookOptions('House'),
    })
    const wallQuads = buildWallArt({ level, material: wallArt })
    const wallDark = buildWallDark(level)
    const fannedBlocks = buildFannedBlocks({
      level,
      material: this.wallMaterial,
    })
    const leaks = new LeakLayer({ app, textures, level })
    const soup = new SoupLayer({ app, textures, level })
    holder.addChild(
      floor.mesh,
      ground.mesh,
      leaks.body,
      leaks.glints,
      soup.mesh,
      wallQuads.mesh,
      wallDark.mesh,
      stormQuads.mesh,
      fannedBlocks.mesh,
    )
    Array.forEach(walls, mesh => {
      holder.addChild(mesh)
    })
    const floorArt = floorArtOf(level)
    room.paintLeaves(floorArt)
    this.lastDecals = undefined
    this.stormKey = undefined
    const built: Built = {
      level,
      holder,
      room,
      floor,
      ground,
      groundRects: new GroundRects({
        parent: holder,
        lift: GROUND_LIFT,
        under: ground.mesh.position,
      }),
      storm,
      leaks,
      soup,
      floorArt,
      plants: plantsOf({ app: this.app, level }),
      furniture: new Furniture({ level, parent: holder, voxels: this.voxels }),
      lights: houseLightsOf({ level, parent: holder, watch: this.shadowWatch }),
      rays: new GodRays({ level, parent: holder }),
      glows: new HouseGlows({ app, textures, level, parent: holder }),
      fans: [wallQuads, wallDark, stormQuads, fannedBlocks],
      chandelier: chandelierOf({ level, parent: holder }),
      shelf: shelfOf({ level, parent: holder }),
    }
    this.built = built
    this.castPlants(built)
    return built
  }

  private castPlants(built: Built): void {
    this.dropCasters()
    const casters = new Container3D()
    built.holder.addChild(casters)
    this.casters = casters
    this.plantCasters = plantCastersOf({
      parent: casters,
      plants: built.plants,
    })
  }

  private dropCasters(): void {
    this.casters?.destroy({ children: true })
    this.casters = undefined
    this.plantCasters = []
  }

  private dropLevel(): void {
    this.dropCasters()
    const built = this.built
    if (built === undefined) {
      return
    }
    this.billboards.release()
    this.glowing.release()
    this.rims.release()
    Option.map(built.chandelier, chandelier => {
      chandelier.destroy()
    })
    Option.map(built.shelf, shelf => {
      shelf.destroy()
    })
    built.rays.destroy()
    built.glows.destroy()
    built.furniture.destroy()
    built.groundRects.destroy()
    built.holder.destroy({ children: true })
    Array.forEach(
      [
        built.room,
        built.floor,
        built.ground,
        built.storm,
        built.leaks,
        built.soup,
      ],
      layer => {
        layer.destroy()
      },
    )
    Array.forEach(built.plants, ({ clumps, caster }) => {
      Array.forEach([...clumps, caster], ({ texture }) => {
        texture.destroy(true)
      })
    })
    this.built = undefined
  }

  get isSettled(): boolean {
    return this.textures.isSettled
  }

  drawPlinth(
    pose: PlinthPose,
    options: Readonly<{ isStill: boolean }>,
  ): Option.Option<PlinthPicture> {
    const room = Option.flatMap(Option.fromNullishOr(this.built), built =>
      Array.findFirst(built.level.rooms, ({ isOpen }) => isOpen),
    )
    if (Option.isNone(room)) {
      return Option.none()
    }
    const { box } = room.value
    const stage = this.plinth ?? new PlinthStage(this.app, this.textures)
    this.plinth = stage
    return stage.draw({
      pose,
      at: {
        x: ((box.left + box.right) / 2) * UNIT,
        z: zOf((box.top + box.bottom) / 2),
      },
      isStill: options.isStill,
    })
  }

  destroy(): void {
    this.quality.destroy()
    this.plinth?.destroy()
    this.dropLevel()
    this.voxels.destroy()
    this.textures.destroy()
    this.app.destroy(true, { children: true })
  }
}

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
          preference: 'webgl',
          background: BACKGROUND,
          antialias: false,
          autoStart: false,
          width: Math.max(1, host.clientWidth),
          height: Math.max(1, host.clientHeight),
          resolution: window.devicePixelRatio,
          autoDensity: true,
        }),
      catch: toBrowserError,
    })
    app.canvas.classList.add('world-canvas')
    host.append(app.canvas)
    return new IsoScene(app, onLoaded)
  })
