// The game's world drawn in 3D with PixiJS 3D: the bird's-eye view, the
// rooms' light, the cellar's dark, shadows, and wind. It reads each frame the
// view hands it and never writes the Model, so the game plays the same.
//
// How the game's picture becomes 3D, with no art redrawn:
// - The room's floor art (and the decals) paint into textures on a floor
//   plane, through the same Canvas shapes the game builds.
// - Each wall tile ('#') stands up as a toon block wearing the room's art
//   on its top, its front, and the sides the lens sees.
// - Every standing drawable (zombies, players, props) is made of shapes
//   placed above its foot, so each Image stands up as a billboard at that
//   foot, as tall as it is drawn.
// - What lies on the floor (shadows, bullets, rings) paints into floor
//   textures each frame.
// - Light is new: each room's own, the flames, the lamp that follows the
//   player, the muzzle flash, and glowing tracers.
//
// The camera looks through the game's lens (src/render/lens.ts), turned off
// north with a slight perspective, on the game's own camera
// (src/render/camera.ts): the aim, the touch controls, and the overlay's
// markers place themselves through the same lens, so they line up.
//
// Everything that moves reads the Model: the wind and the flicker from its
// clock, the flash from the gun's recoil, the camera from the game's. So the
// same frame draws the same picture, as a screenshot or a video wants.

import { Array, Effect, Option } from 'effect'
import type { Canvas } from 'foldkit'
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
import { BloomEffect, ToonMaterial } from '@pixi/3d/extras'

import type { Model } from '../../app/model'
import { FRAME_ROWS } from '../../art/appearance'
import {
  eyePixelsOf,
  isFlashShape,
  isGlowShape,
  isGlowingShape,
} from '../../art/sprite'
import { type BrowserError, toBrowserError } from '../../shared/describeError'
import { isChandelierDown } from '../../world/dining/chandelier'
import { puddleOf } from '../../world/kitchen/soupPot'
import type { Level } from '../../world/level/arena'
import { levelOf, standingLevelOf } from '../../world/level/arena'
import { focusOf } from '../../world/party/party'
import { type Drawable, TALL_MOST } from '../depth'
import {
  airborneParticlesOf,
  decalShapes,
  groundParticleShapes,
} from '../effectsView'
import { houseRattleOf } from '../juice'
import { muzzleFlashLevel, muzzlePointOf, playerFootY } from '../playerView'
import { type TallCover, tallCoverOf } from '../room/tallCover'
import { airOf } from './air'
import { BillboardPool, rimUp } from './billboards'
import { crittersOf } from './critters'
import { isNearView, viewBoxOf } from './cull'
import {
  DIORAMA_AMBIENT,
  IsoLens,
  dioramaCameraOf,
  dioramaStepOf,
} from './diorama'
import { HouseGlows } from './emissives'
import { ballMiddleOf, blastLightOf, blastPiecesOf } from './explosions'
import { IDENTITY, type Leaf, flatten } from './flatten'
import type { IsoFrame } from './frame'
import { GodRays, shaftMotesOf } from './godRays'
import {
  type Caster,
  type Plant,
  buildLintels,
  buildTileQuads,
  buildWallFaces,
  buildWallSides,
  buildWallTops,
  buildWalls,
  cutoutBoxOf,
  floorArtOf,
  plantCastersOf,
  plantsOf,
  standPlant,
} from './house'
import { LeakLayer } from './leakLayer'
import { dripsOf } from './leaks'
import { aimSceneCamera, sceneLensOf } from './lensCamera'
import { AMBIENT, type LightsFrame, lightsFrameOf } from './lightSpecs'
import { type HouseLights, houseLightsOf } from './lights'
import { LOOK_TUNING } from './lookSpecs'
import { mixColor } from './mood'
import { FloorLayer, FloorPicture } from './painter'
import { type PlinthPicture, PlinthStage } from './plinth'
import type { PlinthPose } from './plinthPose'
import {
  auraCubesOf,
  auraFeetOf,
  auraFrameOf,
  isPowerupImage,
  pickupRingOf,
  pickupSpinOf,
} from './powerups'
import { type Chandelier, chandelierOf, isChandelierSprite } from './showpieces'
import { SoupLayer } from './soupLayer'
import {
  OVERHEAD_FOOT_PX,
  UNIT,
  canvasStepOf,
  standingPointOf,
  zOf,
} from './space'
import { FAR_KEY, stormKeyOf, stormOf, stormTilesOf } from './storm'
import { Textures, colorOf } from './textures'
import { VoxelBatch, newReach } from './voxels'
import { chandelierSwayAt, windClockOf } from './wind'

// NOTE: the lightning's flash: a cold white, at its peak four times
// the ambient light.
export const STORM_COLOR = 0xdce6ff
export const STORM_LIFT = AMBIENT * 3

// NOTE: the void behind the house: black, as shut rooms and the yard draw.
const BACKGROUND = 0x000000
// NOTE: the lens's depth range, in world units from the lens: it stands 36
// to 46 tiles from the floor it looks at by the view's height
// (src/render/lens.ts), and the house is about three screens wide.
const LENS_NEAR = 4
const LENS_FAR = 200
const TRACER_RADIUS = 0.05

// NOTE: what stands carved (voxels.ts), by its rank, and the most blocks
// deep each is carved: a body as deep as it is wide, up to a big zombie's
// belly; the house's pieces, the traps, and the pickups flatter, so a wide
// table or a barricade does not swell into a ball.
const MOST_DEPTH: Readonly<Partial<Record<Drawable['rank'], number>>> = {
  Zombie: 16,
  Player: 16,
  Pickup: 8,
  Trap: 6,
  Prop: 6,
}

const FURNITURE_MOST = TALL_MOST

// NOTE: a blast's flash of light: its color, its peak, and its reach, as
// many times the blast's own radius.
const BLAST_LIGHT_COLOR = 0xffa850
const BLAST_LIGHT_PEAK = 60
const BLAST_LIGHT_REACH = 2.5

// NOTE: the lights that go with a body stand on its pixels
// (`standingPointOf`), then this many world units toward the lens, so they
// light its front: the player's lamp on the top of their head, the muzzle flash's on
// the flash, and a blast's in its fireball's middle.
const LAMP_OUT = 1.41
const FLASH_OUT = 0.8
const BLAST_OUT = 1.06

// NOTE: a glow reaching past its body's foot stands this far under its own
// bottom edge, so none of it sinks into the floor.
const GLOW_FOOT_PX = 1

// NOTE: whatever floats overhead stands this far over its own bottom edge,
// so it never sinks into what it hangs over.
const OVERHEAD_HOVER = 6

// NOTE: the floor plane's coats over the room's art.
const DECALS_COAT = 0
const LANDED_COAT = 1

type Built = Readonly<{
  level: Level
  holder: Container3D
  // NOTE: the room's own art, which the walls' tops and faces wear too.
  room: FloorPicture
  // NOTE: the one lit plane over the floor: the room's art, then the decals,
  // then what has landed (casings, gibs, dust), lit as the floor is, so it
  // sinks into the cellar's dark where the glows and rings do not. One plane
  // and not three, since every pixel of a lit plane is shaded for every
  // light that reaches it.
  floor: FloorLayer
  ground: FloorLayer
  // NOTE: the storm at the windows (storm.ts), unlit, on its own quads over
  // the glass and the floor it lights.
  storm: FloorPicture
  // NOTE: the roof leaks' puddles (leaks.ts).
  leaks: LeakLayer
  // NOTE: the kitchen's goop, the soup pot's puddle too (soup.ts).
  soup: SoupLayer
  floorArt: ReadonlyArray<Leaf>
  plants: ReadonlyArray<Plant>
  // NOTE: each tall piece by the shapes the game draws it with, to read the
  // fade the game gives one while someone stands behind it.
  furniture: ReadonlyMap<ReadonlyArray<Canvas.Shape>, TallCover>
  lights: HouseLights
  // NOTE: the god rays and what glows in the dark (godRays.ts,
  // emissives.ts).
  rays: GodRays
  glows: HouseGlows
  // NOTE: the dining room's carved chandelier (showpieces.ts), where the
  // level has one.
  chandelier: Option.Option<Chandelier>
}>

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

// NOTE: a shut room's fill is put out (it draws black anyway) and an open
// room's is turned down, so the flames and the lamp carry the picture
// (src/render/iso/lookSpecs.ts).
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

// NOTE: whether a drawable is the 2D sprite of a carved showpiece the house
// stands for it.
const isCarved = (built: Built, drawable: Drawable): boolean => {
  const [first] = drawable.shapes
  return (
    Option.isSome(built.chandelier) &&
    drawable.shapes.length === 1 &&
    first?._tag === 'Image' &&
    isChandelierSprite(first)
  )
}

// NOTE: mutable on purpose: a renderer owns pixi's mutable scene and keeps
// what it built until the level changes.
export class IsoScene {
  private readonly app: Application
  private readonly textures: Textures
  private readonly view: View3D
  private readonly lamp: PointLight
  private readonly ambient: AmbientLight
  private readonly storm: AmbientLight
  // NOTE: the mood's ambient color last set, so it is set only on a change.
  private ambientColor = 0xffffff
  private readonly flash: PointLight
  private readonly tracerMaterial: Material3D
  // NOTE: a game pixel across: the glowing core of the bullet the floor
  // draws, the bloom its glow (owner, 2026-11-14: bullets were massive).
  private readonly tracerGeometry = new SphereGeometry({
    radius: TRACER_RADIUS,
  })
  private readonly tracers: Array<Mesh3D> = []
  private readonly wallMaterial: ToonMaterial
  private readonly billboards: BillboardPool
  private readonly glowing: BillboardPool
  private readonly rims: BillboardPool
  private readonly voxels: VoxelBatch
  // NOTE: the newest blast's flash over the room.
  private readonly blastLight: PointLight
  private built: Built | undefined
  private casters: Container3D | undefined
  private plantCasters: ReadonlyArray<Caster> = []
  private lastDecals: unknown
  // NOTE: whether anything had landed on the floor last frame, so a frame
  // with nothing there and nothing before draws the floor's picture again
  // only when the decals change.
  private wasLanded = false
  // NOTE: what the storm's layer was last painted for (storm.ts).
  private stormKey: string | undefined
  private lastPreload: ReadonlyArray<string> = []
  private lastLoaded = -1
  // NOTE: the Munchopedia's plinths, drawn with this renderer (plinth.ts),
  // built at the first one asked for.
  private plinth: PlinthStage | undefined

  constructor(app: Application, onLoaded: () => void) {
    this.app = app
    this.textures = new Textures(app, onLoaded)
    this.view = new View3D({
      autoResize: true,
      shadowQuality: 'high',
      toneMapping: 'none',
      environment: { skyColor: 0x9db4ff, groundColor: 0x3a2a30, intensity: 0 },
      passes: [new BloomEffect({ threshold: 2, intensity: 1.1, radius: 0.6 })],
    })
    app.stage.addChild(this.view)
    const { camera, root } = this.view
    camera.mode = 'perspective'
    camera.near = LENS_NEAR
    camera.far = LENS_FAR
    // NOTE: the rest of the light is each room's own (lights.ts).
    this.ambient = new AmbientLight({ color: 0xffffff, intensity: AMBIENT })
    // NOTE: the storm's lightning, a cold flash over the whole house.
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
      // NOTE: no ink round the walls. The pass pushed their back faces out
      // less than half a game pixel, and against the dark of a doorway and
      // the black round the house that sliver of ink read as grey specks
      // under every lintel and a grey line along every wall (owner,
      // 2026-11-15). The walls' own art draws their edges.
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
    this.voxels = new VoxelBatch({ parent: standing, textures })
  }

  draw(
    frame: IsoFrame,
    size: Readonly<{ width: number; height: number }>,
    options: Readonly<{ isStill: boolean }>,
  ): void {
    const { model, strata, camera, shake } = frame
    if (frame.preload !== this.lastPreload) {
      this.lastPreload = frame.preload
      Array.forEach(frame.preload, src => {
        this.textures.preload(src)
      })
    }
    // NOTE: the renderer's size is in CSS pixels, fractions kept. Its canvas
    // holds a canvas pixel for each square of `step` device pixels
    // (canvasStepOf), so the page stretches it by exactly that, pixelated.
    // A box whose device pixels the step does not divide is drawn a canvas
    // pixel wider or taller, past its right and bottom edges, which the box
    // clips: the view is anchored on its top left corner.
    const ratio = window.devicePixelRatio
    const devicePerGamePixel = (size.width * ratio) / Math.max(1, camera.width)
    const step = IsoLens.match(frame.lens, {
      Play: () => canvasStepOf({ devicePerGamePixel, ratio }),
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
    }
    const built = this.builtFor(standingLevelOf(levelOf(model)))
    this.textures.lookAt(built.level)
    // NOTE: the floor is painted again once what it waits on has loaded,
    // not as each file comes in: a first visit loads a few dozen, and
    // painting the whole floor for each held the splash in a hitch apiece.
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

    // THE CAMERA
    // NOTE: the lens (src/render/lens.ts) on the game's camera, less the
    // shake, on this canvas (src/render/iso/lensCamera.ts): the same
    // projection the overlay, the aim, and culling read. The title's
    // diorama (diorama.ts) is a camera of its own, swinging round the house.
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

    const { player } = focusOf(model)
    const rattle = houseRattleOf(model.shake.trauma)

    // THE FLOOR
    // NOTE: what has landed is painted into the floor's own picture alone,
    // never in the ground's strata, so the ground needs no sorting out.
    const landed = flatten(groundParticleShapes(model.cosmetics.particles))
    const isLanded = landed.length > 0
    if (isDecalsChanged || isLanded || this.wasLanded) {
      built.floor.picture.paintCoat(LANDED_COAT, landed)
      built.floor.picture.render()
    }
    this.wasLanded = isLanded
    const isDown = isChandelierDown(model)
    built.ground.paintLeaves([
      ...Option.match(built.chandelier, {
        onNone: () => [],
        onSome: chandelier => chandelier.floorMarks(isDown),
      }),
      ...flatten(strata.ground),
    ])
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

    // WHAT STANDS
    const flashLevel = muzzleFlashLevel(player)
    const lamp = { x: player.x, y: player.y, flash: flashLevel }
    const fades = new Map<TallCover, number>()
    this.billboards.begin()
    this.glowing.begin()
    this.rims.begin()
    this.voxels.begin()
    for (const drawable of strata.standing) {
      // NOTE: a muzzle flash glows on its body's own plane, so it sits on
      // the gun's tip; it lights, casts, and takes no rim. Aimed down the
      // screen it reaches past the body's foot, so there it stands on its
      // own bottom edge instead, in front of the body, never under the floor.
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
      const maybePiece = furnitureOf(built.furniture, drawable.shapes)
      if (Option.isSome(maybePiece)) {
        fades.set(maybePiece.value.piece, maybePiece.value.opacity)
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
          // NOTE: a hit flash glows white in any light, the cellar's dark
          // too, so it stands with what glows of itself rather than what is
          // lit.
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
          // NOTE: only a flat billboard takes the lamp's rim: a body of
          // blocks is lit on its sides by the room's own lights, and the
          // rim's flat cutout would stand round it as a tan outline.
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
    // NOTE: the house's own pieces stand only near the view: the rest of a
    // house three screens wide would cost every pass, the shadows' too.
    for (const piece of built.furniture.values()) {
      if (
        isNearView(
          {
            left: piece.left,
            top: piece.artTop,
            right: piece.right,
            bottom: piece.footY,
          },
          view,
        )
      ) {
        const opacity = fades.get(piece) ?? 1
        this.standBody({
          leaves: Array.map(flatten(piece.shapes), leaf => ({
            ...leaf,
            alpha: leaf.alpha * opacity,
          })),
          footY: piece.footY,
          elapsedMs: model.elapsedMs,
          most: FURNITURE_MOST,
        })
      }
    }
    for (const { mesh, box } of this.plantCasters) {
      mesh.visible = isNearView(box, view)
    }
    const t = windClockOf(model.elapsedMs)
    for (const plant of built.plants) {
      if (isNearView(cutoutBoxOf(plant.caster), view)) {
        standPlant({ pool: this.billboards, plant, t })
      }
    }

    // WHAT FLOATS
    // NOTE: a rattle jolts the chandelier on its chain, a whole pixel at a
    // time.
    const sway = chandelierSwayAt(t) + Math.round(Math.sin(t * 38) * rattle * 3)
    Option.map(built.chandelier, carved => {
      carved.apply({ isDown, sway, view })
    })
    // NOTE: sparks, blood, and gibs in the air stand as cubes, lit as the
    // bodies are, so they vanish into the cellar's dark with them; one with
    // a see-through color (or with no cube left) stays a lit billboard. A
    // wading splash keeps its own blue-white in any light. The
    // scene reads them off the particles, never the overhead strata.
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
      // NOTE: the hung chandelier's sprite, known by its crop: the carved
      // one stands in its place where the level has one.
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

    // THE AIR
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

    // THE LIGHTS
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
    built.lights.apply({ frame: lights, player, view })
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
    // NOTE: no lightning reaches the dark cellar's flashlight.
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
  }

  // NOTE: what stands as its carved sprites, each part in front of the
  // parts before it as the 2D game drew it over them; a hit flash's as
  // glowing white blocks. A part that cannot stand carved stands as a
  // billboard.
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

  // NOTE: a boost's aura as blocks round the feet, the frame the game drew.
  private standAura(image: Canvas.Image, matrix: Leaf['matrix']): void {
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

  // NOTE: a goodie's glow as a ring of lights on the floor under it.
  private standPickupRing(
    circle: Canvas.Circle,
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

  // NOTE: every blast's blocks, and the newest one's flash of light over
  // the room, the brightest while two go off together.
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

  // NOTE: each bullet glows as a tracer over the floor's own drawing.
  private drawTracers(model: Model): void {
    Array.forEach(model.bullets, (bullet, index) => {
      const tracer = this.tracers[index] ?? this.newTracer()
      tracer.visible = true
      // NOTE: on the floor, where the game draws the bullet: the 2D game's
      // map already puts a shot at the gun's height.
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
      lift: 0.012,
      isLit: false,
    })
    // NOTE: the storm's picture shows only on its own quads, never on a
    // plane over the whole level.
    const storm = new FloorPicture({ app, textures, level })
    const stormQuads = buildTileQuads({
      level,
      material: new FlatMaterial({
        baseColorTexture: storm.texture,
        alphaMode: 'blend',
      }),
      tiles: stormTilesOf(level),
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
    const wallTops = buildWallTops({ level, material: wallArt })
    const wallFaces = buildWallFaces({ level, material: wallArt })
    const wallSides = buildWallSides({ level, material: wallArt })
    const leaks = new LeakLayer({ app, textures, level })
    const soup = new SoupLayer({ app, textures, level })
    holder.addChild(
      floor.mesh,
      ground.mesh,
      leaks.body,
      leaks.glints,
      soup.mesh,
      wallTops,
      wallFaces,
      wallSides,
      stormQuads,
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
      storm,
      leaks,
      soup,
      floorArt,
      plants: plantsOf({ app: this.app, level }),
      furniture: new Map(
        Array.map(tallCoverOf(level), piece => [piece.shapes, piece] as const),
      ),
      lights: houseLightsOf({ level, parent: holder }),
      rays: new GodRays({ level, parent: holder }),
      glows: new HouseGlows({ app, textures, level, parent: holder }),
      chandelier: chandelierOf({ level, parent: holder }),
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
    built.rays.destroy()
    built.glows.destroy()
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

  // NOTE: whether the last frame drew with every sprite it asked for, so the
  // splash can wait for a world that is all there.
  get isSettled(): boolean {
    return this.textures.isSettled
  }

  // NOTE: a plinth's picture, or none before a level is built or while its
  // sprite loads. It stands in the middle of the level's first open room.
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
    this.plinth?.destroy()
    this.dropLevel()
    this.voxels.destroy()
    this.textures.destroy()
    this.app.destroy(true, { children: true })
  }
}

// NOTE: the renderer on a canvas in `host`, on WebGL2 everywhere. WebGPU
// is left off: on an iPhone, Safari's WebGPU at times drew the manor with
// red and blue swapped from its first frame (zombies, candles, furniture,
// and the floating words all blue) until the page went away and came back
// (owner, 2026-11-14), and every device the game supports has WebGL2. It never runs a ticker: the element draws each frame the
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
