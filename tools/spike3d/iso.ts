// The 3D spike: the game's own World drawn isometric with PixiJS 3D, over
// the audit harness's page. It reads `window.__model` every frame and never
// writes it, so the game plays exactly as it does in 2D.
//
// How the 2D picture becomes 3D, with no art redrawn:
// - The room's floor art (and the decals) paint into textures on a floor
//   plane, through the same Canvas shapes the game paints.
// - Each wall tile ('#') stands up as an ink-outlined toon block.
// - Every standing drawable (zombies, players, props) is made of shapes
//   placed above its foot, so each Image stands up as a billboard at that
//   foot, as tall as it is drawn.
// - What lies on the floor (shadows, bullets on the ground, blood) paints
//   into a third floor texture each frame.
// - Lights, shadows, and bloom are new: a sun, a lamp that follows the
//   player, a muzzle flash, and glowing tracers.
//
// Keys (they never reach the game's own bindings): , and . turn the camera,
// - and = zoom, 0 resets, \ toggles the 2D game underneath.

import {
  AmbientLight,
  Container3D,
  ContainerTexture,
  CubeGeometry,
  DirectionalLight,
  FlatMaterial,
  Material3D,
  Mesh3D,
  PlaneGeometry,
  Plane,
  PointLight,
  SphereGeometry,
  Sprite3D,
  Vector3,
  View3D,
} from '@pixi/3d'
import { BloomEffect, OutlinePass, ToonMaterial } from '@pixi/3d/extras'
import {
  Application,
  Color,
  Container,
  Graphics,
  Matrix,
  Rectangle,
  Sprite,
  Texture,
  TextureSource,
  groupD8,
} from 'pixi.js'
import type { Canvas } from 'foldkit'

import type { Model } from '@game/app/model'
import { viewToWorld, worldCameraFor } from '@game/render/camera'
import {
  airborneParticleShapes,
  decalShapes,
  groundParticleShapes,
} from '@game/render/effectsView'
import { hungChandelierShapes, roomArtOf } from '@game/render/room/room'
import { COVER_DRAWINGS, coverBlocks } from '@game/render/room/roomCover'
import {
  ESCAPE_COVER_DRAWINGS,
  isEscapeCoverKind,
} from '@game/render/room/escapeCover'
import { tallCoverOf } from '@game/render/room/tallCover'
import type { TallCover } from '@game/render/room/tallCover'
import { clientToView, screenOf } from '@game/render/screen'
import { worldStrataOf } from '@game/screens/game/worldView'
import { TILE_SIZE } from '@game/shared/constants'
import { levelOf } from '@game/world/level/arena'
import type { Level } from '@game/world/level/arena'
import { COVER_SYMBOLS, WALL_SYMBOL } from '@game/world/level/tileGrid'
import type { CoverKind } from '@game/world/level/tileGrid'
import { focusOf } from '@game/world/party/party'

import { AMBIENT, lightsOf } from './lights'
import type { Lights } from './lights'
import { PITCH, STRETCH, UNIT, zOf } from './space'

// UNITS

const WALL_HEIGHT = 1.4
const YAW = 0
const CUTAWAY_HEIGHT = 0.25

TextureSource.defaultOptions.scaleMode = 'nearest'

// FLATTENED SHAPES

// NOTE: a 2D affine matrix as the canvas keeps it: x' = a x + c y + e,
// y' = b x + d y + f.
type Affine = Readonly<{
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}>

const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

const multiply = (m: Affine, n: Affine): Affine => ({
  a: m.a * n.a + m.c * n.b,
  b: m.b * n.a + m.d * n.b,
  c: m.a * n.c + m.c * n.d,
  d: m.b * n.c + m.d * n.d,
  e: m.a * n.e + m.c * n.f + m.e,
  f: m.b * n.e + m.d * n.f + m.f,
})

// NOTE: the painter's order: translate, then rotate, then scale.
const groupMatrix = (group: Canvas.Shape & { _tag: 'Group' }): Affine => {
  let m = IDENTITY
  if (group.translate !== undefined) {
    m = multiply(m, {
      ...IDENTITY,
      e: group.translate.x,
      f: group.translate.y,
    })
  }
  if (group.rotate !== undefined && group.rotate !== 0) {
    const cos = Math.cos(group.rotate)
    const sin = Math.sin(group.rotate)
    m = multiply(m, { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 })
  }
  if (group.scale !== undefined) {
    m = multiply(m, { ...IDENTITY, a: group.scale.x, d: group.scale.y })
  }
  return m
}

type Leaf = Readonly<{ shape: Canvas.Shape; matrix: Affine; alpha: number }>

const flatten = (
  shapes: ReadonlyArray<Canvas.Shape>,
  matrix: Affine = IDENTITY,
  alpha = 1,
  out: Array<Leaf> = [],
): Array<Leaf> => {
  for (const shape of shapes) {
    if (shape._tag === 'Group') {
      flatten(
        shape.shapes,
        multiply(matrix, groupMatrix(shape)),
        alpha * (shape.opacity ?? 1),
        out,
      )
    } else {
      out.push({ shape, matrix, alpha })
    }
  }
  return out
}

// TEXTURES

const images = new Map<string, Texture | 'Loading'>()
const crops = new Map<string, Texture>()
let imagesLoaded = 0

const baseTexture = (src: string): Texture | undefined => {
  const known = images.get(src)
  if (known === 'Loading') {
    return undefined
  }
  if (known !== undefined) {
    return known
  }
  images.set(src, 'Loading')
  const image = new Image()
  image.onload = () => {
    images.set(src, Texture.from(image))
    imagesLoaded += 1
  }
  image.src = src
  return undefined
}

// NOTE: a cropped frame of an image, mirrored when the shape is drawn
// flipped, cached by everything that makes it.
const textureOf = (
  image: Canvas.Shape & { _tag: 'Image' },
  isFlipped: boolean,
): Texture | undefined => {
  const base = baseTexture(image.src)
  if (base === undefined) {
    return undefined
  }
  const crop = image.crop ?? {
    x: 0,
    y: 0,
    width: base.source.width,
    height: base.source.height,
  }
  const key = `${image.src}|${crop.x},${crop.y},${crop.width},${crop.height}|${isFlipped}`
  const cached = crops.get(key)
  if (cached !== undefined) {
    return cached
  }
  const texture = new Texture({
    source: base.source,
    frame: new Rectangle(crop.x, crop.y, crop.width, crop.height),
    rotate: isFlipped ? groupD8.MIRROR_HORIZONTAL : 0,
  })
  crops.set(key, texture)
  return texture
}

const colorOf = (css: string): Readonly<{ color: number; alpha: number }> => {
  const color = new Color(css)
  return { color: color.toNumber(), alpha: color.alpha }
}

// FLAT PAINTER

// NOTE: paints Canvas shapes into a pixi Container: consecutive vector shapes
// share one Graphics, and each image gets a pooled Sprite, in the shapes'
// own order. The 3D scene shows the Container through a ContainerTexture.
class FlatPainter {
  readonly container = new Container()
  private readonly graphics: Array<Graphics> = []
  private readonly sprites: Array<Sprite> = []

  paint(shapes: ReadonlyArray<Canvas.Shape>): void {
    this.paintLeaves(flatten(shapes))
  }

  paintLeaves(leaves: ReadonlyArray<Leaf>): void {
    let graphicsUsed = 0
    let spritesUsed = 0
    let current: Graphics | undefined
    this.container.removeChildren()
    for (const { shape, matrix, alpha } of leaves) {
      if (shape._tag === 'Image') {
        const texture = textureOf(shape, false)
        if (texture === undefined) {
          continue
        }
        const sprite = this.sprites[spritesUsed] ?? new Sprite()
        this.sprites[spritesUsed] = sprite
        spritesUsed += 1
        sprite.texture = texture
        sprite.setFromMatrix(
          new Matrix(
            matrix.a,
            matrix.b,
            matrix.c,
            matrix.d,
            matrix.e,
            matrix.f,
          ).append(
            new Matrix(
              shape.width / texture.frame.width,
              0,
              0,
              shape.height / texture.frame.height,
              shape.x,
              shape.y,
            ),
          ),
        )
        sprite.alpha = alpha
        this.container.addChild(sprite)
        current = undefined
        continue
      }
      if (current === undefined) {
        current = this.graphics[graphicsUsed] ?? new Graphics()
        this.graphics[graphicsUsed] = current
        graphicsUsed += 1
        current.clear()
        this.container.addChild(current)
      }
      current.setTransform(
        new Matrix(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f),
      )
      drawVector(current, shape, alpha)
    }
  }
}

const drawVector = (g: Graphics, shape: Canvas.Shape, alpha: number): void => {
  const finish = (fill: string | undefined, stroke: string | undefined, lineWidth: number | undefined) => {
    if (fill !== undefined) {
      const { color, alpha: a } = colorOf(fill)
      g.fill({ color, alpha: a * alpha })
    }
    if (stroke !== undefined) {
      const { color, alpha: a } = colorOf(stroke)
      g.stroke({ color, alpha: a * alpha, width: lineWidth ?? 1 })
    }
  }
  switch (shape._tag) {
    case 'Rect':
      g.rect(shape.x, shape.y, shape.width, shape.height)
      finish(shape.fill, shape.stroke, shape.lineWidth)
      return
    case 'Circle':
      g.circle(shape.x, shape.y, shape.radius)
      finish(shape.fill, shape.stroke, shape.lineWidth)
      return
    case 'Path':
      for (const step of shape.instructions) {
        switch (step._tag) {
          case 'MoveTo':
            g.moveTo(step.x, step.y)
            break
          case 'LineTo':
            g.lineTo(step.x, step.y)
            break
          case 'QuadTo':
            g.quadraticCurveTo(step.cpx, step.cpy, step.x, step.y)
            break
          case 'BezierTo':
            g.bezierCurveTo(step.cp1x, step.cp1y, step.cp2x, step.cp2y, step.x, step.y)
            break
          case 'Close':
            g.closePath()
            break
        }
      }
      finish(shape.fill, shape.stroke, shape.lineWidth)
      return
    default:
      return
  }
}

// FLOOR LAYERS

// NOTE: a floor-sized texture painted from shapes in level pixels, on a
// plane just above the floor. `lift` keeps the layers from fighting.
class FloorLayer {
  readonly painter = new FlatPainter()
  readonly frame = new Container()
  readonly texture: ContainerTexture
  readonly mesh: Mesh3D

  constructor(
    app: Application,
    level: Level,
    lift: number,
    isLit: boolean,
  ) {
    this.frame.addChild(this.painter.container)
    this.frame.position.set(-level.left, -level.top)
    this.texture = new ContainerTexture({
      container: this.frame,
      width: level.width,
      height: level.height,
      renderer: app.renderer,
    })
    this.texture.source.scaleMode = 'nearest'
    const material = isLit
      ? new Material3D({
          baseColorTexture: this.texture,
          roughness: 1,
          metallic: 0,
          specular: { factor: 0 },
          alphaMode: lift === 0 ? 'opaque' : 'blend',
        })
      : new FlatMaterial({ baseColorTexture: this.texture, alphaMode: 'blend' })
    this.mesh = new Mesh3D({
      geometry: new PlaneGeometry({
        width: level.width * UNIT,
        height: level.height * UNIT * STRETCH,
      }),
      material,
      rotation: { x: -Math.PI / 2, y: 0, z: 0 },
      position: {
        x: (level.left + level.width / 2) * UNIT,
        y: lift,
        z: zOf(level.top + level.height / 2),
      },
      castShadow: false,
      receiveShadow: isLit,
    })
  }

  paint(shapes: ReadonlyArray<Canvas.Shape>): void {
    this.paintLeaves(flatten(shapes))
  }

  paintLeaves(leaves: ReadonlyArray<Leaf>): void {
    this.painter.paintLeaves(leaves)
    this.texture.render()
  }
}

// STANDING SPRITES

// NOTE: where "up" and "toward the lens" point in the world this frame. The
// bird's-eye camera looks down steeply, and every billboard faces it square
// (spherical), so a sprite's parts are offset from its foot along the
// camera's own up: that keeps the whole sprite at its foot's depth, which
// is exactly the game's foot sort, and keeps the parts of one body (a hat
// over a head, a gun in a hand) where the 2D game drew them.
type Vec3 = { x: number; y: number; z: number }
type Basis = { up: Vec3; toward: Vec3 }

// NOTE: parts later in a drawable win ties, nudged this far toward the lens.
const PART_BIAS = 0.002

type Placement = Readonly<{
  texture: Texture
  centerX: number
  bottom: number
  drawnWidth: number
  drawnHeight: number
  footY: number
  hover: number
  tint: number
  alpha: number
  part: number
}>

// NOTE: a leaf as it is drawn: its texture (a white quad for a Rect), the
// middle of its bottom edge, its size, and its tint, or nothing when it
// draws nothing (an outline, an image still loading).
type DrawnLeaf = Readonly<{
  texture: Texture
  centerX: number
  bottom: number
  drawnWidth: number
  drawnHeight: number
  tint: number
  alpha: number
}>

const drawnLeafOf = ({ shape, matrix, alpha }: Leaf): DrawnLeaf | undefined => {
  if (shape._tag !== 'Image' && shape._tag !== 'Rect') {
    return undefined
  }
  if (shape._tag === 'Rect' && shape.fill === undefined) {
    return undefined
  }
  const left = matrix.a * shape.x + matrix.c * shape.y + matrix.e
  const top = matrix.b * shape.x + matrix.d * shape.y + matrix.f
  const width = matrix.a * shape.width + matrix.c * shape.height
  const height = matrix.b * shape.width + matrix.d * shape.height
  const drawnWidth = Math.abs(width)
  const drawnHeight = Math.abs(height)
  if (drawnWidth < 0.01 || drawnHeight < 0.01) {
    return undefined
  }
  const texture =
    shape._tag === 'Image' ? textureOf(shape, width < 0) : Texture.WHITE
  if (texture === undefined) {
    return undefined
  }
  const fill =
    shape._tag === 'Rect' && shape.fill !== undefined
      ? colorOf(shape.fill)
      : { color: 0xffffff, alpha: 1 }
  return {
    texture,
    centerX: left + width / 2,
    bottom: Math.max(top, top + height),
    drawnWidth,
    drawnHeight,
    tint: fill.color,
    alpha: fill.alpha * alpha,
  }
}

// NOTE: every Image of a standing drawable as a billboard at its foot: its
// bottom edge stands as far above the foot as it is drawn above it. Rects
// (bars, small bits of a body) stand the same way as tinted white quads.
// Sprites are lit (Material3D) so the lamp and the muzzle flash fall on
// them, or flat for what glows of itself (flashes, health bars).
class BillboardPool {
  private readonly sprites: Array<Sprite3D> = []
  private used = 0
  private readonly parent: Container3D
  private readonly isLit: boolean
  basis: Basis = { up: { x: 0, y: 1, z: 0 }, toward: { x: 0, y: 0, z: 1 } }
  // NOTE: one screen pixel, in game pixels: every edge snaps to it.
  grid = 1

  constructor(parent: Container3D, isLit: boolean) {
    this.parent = parent
    this.isLit = isLit
  }

  begin(): void {
    this.used = 0
  }

  end(): void {
    for (let index = this.used; index < this.sprites.length; index += 1) {
      const sprite = this.sprites[index]
      if (sprite !== undefined) {
        sprite.visible = false
      }
    }
  }

  standUp(
    shapes: ReadonlyArray<Canvas.Shape>,
    footY: number,
    hover = 0,
    opacity = 1,
  ): void {
    this.standLeaves(flatten(shapes), footY, hover, opacity)
  }

  standLeaves(
    leaves: ReadonlyArray<Leaf>,
    footY: number,
    hover = 0,
    opacity = 1,
  ): void {
    let part = 0
    for (const leaf of leaves) {
      const drawn = drawnLeafOf(leaf)
      if (drawn === undefined) {
        continue
      }
      this.place({
        ...drawn,
        footY,
        hover,
        alpha: drawn.alpha * opacity,
        part,
      })
      part += 1
    }
  }

  place(p: Placement): void {
    const sprite = this.next()
    if (sprite.texture !== p.texture) {
      sprite.texture = p.texture
    }
    const pixel = p.drawnHeight / p.texture.frame.height
    sprite.pixelSize = pixel * UNIT
    sprite.scale.x = p.drawnWidth / p.texture.frame.width / pixel
    sprite.tint = p.tint
    sprite.alpha = p.alpha
    const mode = p.alpha < 0.98 ? 'blend' : 'mask'
    if (sprite.alphaMode !== mode) {
      sprite.alphaMode = mode
    }
    const { up, toward } = this.basis
    const snap = (value: number): number =>
      Math.round(value / this.grid) * this.grid
    const left = snap(p.centerX - p.drawnWidth / 2)
    const footY = snap(p.footY)
    const bottom = snap(p.bottom)
    const rise = (footY - bottom + p.hover + p.drawnHeight / 2) * UNIT
    const nudge = p.part * PART_BIAS
    sprite.position.set(
      (left + p.drawnWidth / 2) * UNIT + up.x * rise + toward.x * nudge,
      up.y * rise + toward.y * nudge,
      zOf(footY) + up.z * rise + toward.z * nudge,
    )
    sprite.visible = true
  }

  private next(): Sprite3D {
    const existing = this.sprites[this.used]
    this.used += 1
    if (existing !== undefined) {
      return existing
    }
    const sprite = new Sprite3D({
      texture: Texture.WHITE,
      ...(this.isLit
        ? { material: new Material3D({
            roughness: 1,
            metallic: 0,
            specular: { factor: 0 },
          }) }
        : {}),
      anchor: { x: 0.5, y: 0.5 },
      billboardMode: 'spherical',
      alphaMode: 'mask',
      alphaCutoff: 0.5,
      position: { x: 0, y: 0, z: 0 },
    })
    this.parent.addChild(sprite)
    this.sprites.push(sprite)
    return sprite
  }
}

// WALLS

type Wall = Readonly<{ mesh: Mesh3D; x: number; z: number }>

const WALL_GEOMETRY = new CubeGeometry({ width: 1, height: 1, depth: 1 })

const buildWalls = (level: Level, material: ToonMaterial): ReadonlyArray<Wall> => {
  const walls: Array<Wall> = []
  level.tiles.forEach((line, row) => {
    for (let column = 0; column < line.length; column += 1) {
      if (line[column] !== WALL_SYMBOL) {
        continue
      }
      const x = (level.left + column * TILE_SIZE) * UNIT + 0.5
      const z = zOf(level.top + (row + 0.5) * TILE_SIZE)
      walls.push({
        x,
        z,
        mesh: new Mesh3D({
          geometry: WALL_GEOMETRY,
          material,
          position: { x, y: WALL_HEIGHT / 2, z },
          scale: { x: 1, y: WALL_HEIGHT, z: STRETCH },
          castShadow: true,
          receiveShadow: true,
        }),
      })
    }
  })
  return walls
}

// NOTE: walls between the camera and the player drop low, as a dollhouse
// cutaway, so the camera never loses the player behind one.
const cutAway = (
  walls: ReadonlyArray<Wall>,
  player: Readonly<{ x: number; z: number }>,
  toCamera: Readonly<{ x: number; z: number }>,
): void => {
  for (const { mesh, x, z } of walls) {
    const dx = x - player.x
    const dz = z - player.z
    const ahead = dx * toCamera.x + dz * toCamera.z
    const side = Math.abs(dx * toCamera.z - dz * toCamera.x)
    const isInFront = ahead > 0.5 && ahead < 9 && side < 5
    const height = isInFront ? CUTAWAY_HEIGHT : WALL_HEIGHT
    if (mesh.scale.y !== height) {
      mesh.scale.y = height
      mesh.position.y = height / 2
    }
  }
}

// FURNITURE

// NOTE: the kinds the game redraws over whoever stands behind them
// (src/render/room/tallCover.ts), and the ferns, which sway. In 3D they
// leave the floor and stand up for good, so nothing pops in or out.
const STANDING_KINDS: ReadonlyArray<string> = [
  'Piano',
  'Bookshelf',
  'Pantry',
  'PartyTable',
  'Hutch',
  'Candelabra',
  'BookStack',
  'Desk',
  'WineRack',
  'Fern',
]

const FERN_SYMBOL = 'V'

type Box = Readonly<{ x: number; y: number; width: number; height: number }>

const drawingOf = (
  kind: CoverKind,
): ((box: Box, level: Level) => ReadonlyArray<Canvas.Shape>) =>
  isEscapeCoverKind(kind) ? ESCAPE_COVER_DRAWINGS[kind] : COVER_DRAWINGS[kind]

const rectKey = (shape: Canvas.Shape & { _tag: 'Rect' }): string =>
  `${shape.x},${shape.y},${shape.width},${shape.height},${shape.fill ?? ''}`

const isFaint = (fill: string | undefined): boolean => {
  const match = /^rgba\([^)]*,\s*([\d.]+)\)$/.exec(fill ?? '')
  return match !== null && Number(match[1]) < 0.2
}

// NOTE: the room's art with every standing piece taken out, rect by rect:
// the pieces' own drawings give the rects to leave out (their faint floor
// glows stay on the floor).
const floorArtOf = (level: Level): ReadonlyArray<Leaf> => {
  const lifted = new Set<string>()
  for (const [symbol, kind] of Object.entries(COVER_SYMBOLS)) {
    if (!STANDING_KINDS.includes(kind)) {
      continue
    }
    for (const box of coverBlocks(level, symbol)) {
      for (const { shape } of flatten(drawingOf(kind)(box, level))) {
        if (shape._tag === 'Rect' && !isFaint(shape.fill)) {
          lifted.add(rectKey(shape))
        }
      }
    }
  }
  return flatten(roomArtOf(level)).filter(
    ({ shape }) => shape._tag !== 'Rect' || !lifted.has(rectKey(shape)),
  )
}

// WIND

// NOTE: the spritecook.ai tree wind, indoors as a draft through the manor:
// each plant is cut into clumps of leaves that move by whole pixels, posed
// at 10 Hz from a fixed 20 s gust loop, a breeze wave running across the
// room, and a lean that lags the gusts. It reads only the World's clock,
// so it is the same on every machine and never touches the game.
type Clump = Readonly<{
  texture: Texture
  left: number
  top: number
  width: number
  height: number
  weight: number
}>

type Plant = Readonly<{ footY: number; clumps: ReadonlyArray<Clump> }>

const GUST_LOOP_S = 20
const POSE_HZ = 10
const BREEZE = 0.6

const bump = (u: number, center: number, width: number): number =>
  Math.exp(-(((u - center) / width) ** 2))

const gustAt = (t: number): number => {
  const u = (((t % GUST_LOOP_S) + GUST_LOOP_S) % GUST_LOOP_S) / GUST_LOOP_S
  return bump(u, 0.22, 0.05) + 0.7 * bump(u, 0.6, 0.07) + 0.5 * bump(u, 0.85, 0.03)
}

// NOTE: a spring's lean behind the gust: it pushes over, overshoots, and
// settles, about one sway each 2.2 s.
const leanAt = (t: number): number =>
  2.2 * gustAt(t - 0.3) +
  0.8 * gustAt(t - 0.9) * Math.sin((2 * Math.PI * t) / 2.2)

const windOffset = (
  t: number,
  x: number,
  y: number,
  weight: number,
): Readonly<{ dx: number; dy: number }> => {
  const gust = gustAt(t)
  const along = x + 0.25 * y
  const a = 2 * Math.PI * (t / 1.54 - along / 69)
  const dx =
    leanAt(t) * weight +
    weight * (0.9 * BREEZE + 1.3 * gust) * (0.5 - 0.5 * Math.cos(a))
  const dy = -weight * (0.75 * BREEZE + 0.5 * gust) * Math.max(Math.sin(a), 0)
  return { dx: Math.round(dx), dy: Math.round(dy) }
}

// NOTE: a fern's leaves (its top 13 rows) in six clumps, thirds across and
// two bands down, and its pot, which never moves.
const LEAF_ROWS = 13

const plantsOf = (app: Application, level: Level): ReadonlyArray<Plant> =>
  coverBlocks(level, FERN_SYMBOL).map(box => {
    const rects = flatten(COVER_DRAWINGS.Fern(box, level)).flatMap(
      ({ shape }) => (shape._tag === 'Rect' ? [shape] : []),
    )
    const left = Math.min(...rects.map(r => r.x))
    const right = Math.max(...rects.map(r => r.x + r.width))
    const top = Math.min(...rects.map(r => r.y))
    const bottom = Math.max(...rects.map(r => r.y + r.height))
    const third = (right - left) / 3
    const groups = new Map<string, Array<Canvas.Shape & { _tag: 'Rect' }>>()
    for (const rect of rects) {
      const row = rect.y - top
      const key =
        row >= LEAF_ROWS
          ? 'pot'
          : `${Math.min(2, Math.floor((rect.x + rect.width / 2 - left) / third))}${row < 6 ? 'top' : 'low'}`
      groups.set(key, [...(groups.get(key) ?? []), rect])
    }
    const center = { x: (left + right) / 2, y: top + LEAF_ROWS }
    const reach = Math.hypot((right - left) / 2, LEAF_ROWS)
    const clumps = [...groups.entries()].map(([key, members]): Clump => {
      const cl = Math.min(...members.map(r => r.x))
      const ct = Math.min(...members.map(r => r.y))
      const cr = Math.max(...members.map(r => r.x + r.width))
      const cb = Math.max(...members.map(r => r.y + r.height))
      const g = new Graphics()
      for (const r of members) {
        const { color, alpha } = colorOf(r.fill ?? '#000')
        g.rect(r.x - cl, r.y - ct, r.width, r.height).fill({ color, alpha })
      }
      const texture = app.renderer.generateTexture({
        target: g,
        frame: new Rectangle(0, 0, cr - cl, cb - ct),
        resolution: 1,
      })
      texture.source.scaleMode = 'nearest'
      const distance = Math.hypot((cl + cr) / 2 - center.x, (ct + cb) / 2 - center.y)
      return {
        texture,
        left: cl,
        top: ct,
        width: cr - cl,
        height: cb - ct,
        weight: key === 'pot' ? 0 : 0.35 + 0.65 * Math.min(1, distance / reach),
      }
    })
    return { footY: bottom, clumps }
  })

const standPlant = (pool: BillboardPool, plant: Plant, t: number): void => {
  plant.clumps.forEach((clump, part) => {
    const { dx, dy } =
      clump.weight === 0
        ? { dx: 0, dy: 0 }
        : windOffset(t, clump.left, clump.top, clump.weight)
    pool.place({
      texture: clump.texture,
      centerX: clump.left + clump.width / 2 + dx,
      bottom: clump.top + clump.height + dy,
      drawnWidth: clump.width,
      drawnHeight: clump.height,
      footY: plant.footY,
      hover: 0,
      tint: 0xffffff,
      alpha: 1,
      part,
    })
  })
}

// NOTE: the chandelier swings a pixel or two on its chain, harder in a gust.
const chandelierSway = (t: number): number =>
  Math.round(
    (1 + 1.5 * gustAt(t - 0.2)) * Math.sin((2 * Math.PI * t) / 3.4),
  )

const imageKey = (shape: Canvas.Shape, matrix: Affine): string =>
  shape._tag === 'Image'
    ? `${shape.src}|${shape.x + matrix.e}|${shape.y + matrix.f}`
    : ''

// SHADOWS

// NOTE: a billboard turns to the lens, and the shadow pass does not turn
// it (nor draws a sprite kept out of the opaque pass), so each tall piece
// and fern casts through a stand-in: its art baked into one texture and
// cut out upright on a plain mesh at its foot, in no pass but the shadow's.
const CASTER_GEOMETRY = new PlaneGeometry({ width: 1, height: 1 })

type Cutout = Readonly<{
  texture: Texture
  left: number
  top: number
  width: number
  height: number
  footY: number
}>

const bakePiece = (app: Application, piece: TallCover): Cutout | undefined => {
  const drawn = flatten(piece.shapes).flatMap(leaf => {
    const one = drawnLeafOf(leaf)
    return one === undefined || one.alpha < 0.5 ? [] : [one]
  })
  if (drawn.length === 0) {
    return undefined
  }
  const left = Math.min(...drawn.map(d => d.centerX - d.drawnWidth / 2))
  const right = Math.max(...drawn.map(d => d.centerX + d.drawnWidth / 2))
  const top = Math.min(...drawn.map(d => d.bottom - d.drawnHeight))
  const bottom = Math.max(...drawn.map(d => d.bottom))
  const painter = new FlatPainter()
  painter.paint(piece.shapes)
  painter.container.position.set(-left, -top)
  const holder = new Container()
  holder.addChild(painter.container)
  const texture = app.renderer.generateTexture({
    target: holder,
    frame: new Rectangle(0, 0, Math.ceil(right - left), Math.ceil(bottom - top)),
    resolution: 1,
  })
  return {
    texture,
    left,
    top,
    width: right - left,
    height: bottom - top,
    footY: piece.footY,
  }
}

const shadowCastersOf = (
  app: Application,
  parent: Container3D,
  pieces: ReadonlyArray<TallCover>,
  plants: ReadonlyArray<Plant>,
): Container3D => {
  const holder = new Container3D()
  parent.addChild(holder)
  const stand = (cutout: Cutout): void => {
    const mesh = new Mesh3D({
      geometry: CASTER_GEOMETRY,
      material: new Material3D({
        baseColorTexture: cutout.texture,
        alphaMode: 'mask',
        alphaCutoff: 0.5,
        // NOTE: the lights shine from the north, onto its back.
        doubleSided: true,
      }),
      castShadow: true,
      receiveShadow: false,
    })
    // NOTE: #casters shows the stand-ins, to check them.
    if (!location.hash.includes('casters')) {
      mesh.disablePass('opaque')
      mesh.disablePass('outline')
    }
    mesh.scale.set(cutout.width * UNIT, cutout.height * UNIT, 1)
    // NOTE: a plane's v runs up and a texture's rows run down: turn it over.
    mesh.rotation.z = Math.PI
    mesh.rotation.y = Math.PI
    mesh.position.set(
      (cutout.left + cutout.width / 2) * UNIT,
      (cutout.footY - cutout.top - cutout.height / 2) * UNIT,
      zOf(cutout.footY),
    )
    holder.addChild(mesh)
  }
  for (const piece of pieces) {
    const cutout = bakePiece(app, piece)
    if (cutout !== undefined) {
      stand(cutout)
    }
  }
  for (const plant of plants) {
    for (const clump of plant.clumps) {
      stand({ ...clump, footY: plant.footY })
    }
  }
  return holder
}

// THE SCENE

type Level3D = Readonly<{
  level: Level
  room: FloorLayer
  decals: FloorLayer
  ground: FloorLayer
  // NOTE: what has landed (casings, gibs, dust), lit as the floor is, so
  // it sinks into the cellar's dark where the glows and rings do not.
  landed: FloorLayer
  walls: ReadonlyArray<Wall>
  holder: Container3D
  floorArt: ReadonlyArray<Leaf>
  furniture: ReadonlyArray<TallCover>
  plants: ReadonlyArray<Plant>
  lights: Lights
}>

const mountPoint = async (): Promise<HTMLElement> => {
  for (;;) {
    const found = document.querySelector<HTMLElement>('.world-window')
    if (found !== null && window.__model !== undefined) {
      return found
    }
    await new Promise(resolve => requestAnimationFrame(resolve))
  }
}

export const startIsometric = async (): Promise<void> => {
  const host = await mountPoint()
  const app = new Application()
  await app.init({
    preference: location.hash === '#webgl' ? 'webgl' : 'webgpu',
    background: 0x16121c,
    antialias: false,
    resizeTo: host,
    resolution: Math.min(window.devicePixelRatio, 2),
    autoDensity: true,
  })
  Object.assign(app.canvas.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
  })
  host.appendChild(app.canvas)
  const lens = host.querySelector<HTMLElement>('.world-lens')
  const show2d = (isShown: boolean) => {
    if (lens !== null) {
      lens.style.opacity = isShown ? '1' : '0'
    }
    app.canvas.style.opacity = isShown ? '0' : '1'
  }
  show2d(false)

  const badge = document.createElement('div')
  Object.assign(badge.style, {
    position: 'fixed',
    left: '8px',
    bottom: '8px',
    zIndex: '99',
    font: '12px ui-monospace, monospace',
    color: '#f5c542',
    background: 'rgba(0,0,0,0.6)',
    padding: '4px 8px',
    borderRadius: '6px',
    pointerEvents: 'none',
  })
  document.body.appendChild(badge)

  const view = new View3D({
    autoResize: true,
    shadowQuality: 'high',
    toneMapping: 'none',
    environment: { skyColor: 0x9db4ff, groundColor: 0x3a2a30, intensity: 0 },
    passes: [
      new OutlinePass({ width: 0.04, color: 0x1a1220 }),
      new BloomEffect({ threshold: 2, intensity: 1.1, radius: 0.6 }),
    ],
  })
  app.stage.addChild(view)

  const camera = view.camera
  camera.mode = 'orthographic'
  camera.near = 0.1
  camera.far = 400

  const sun = new DirectionalLight({
    color: 0xffe6c4,
    intensity: 0.2,
    castShadow: false,
  })
  view.root.addChild(sun)
  // NOTE: the rest of the light is each room's own (lights.ts).
  view.root.addChild(new AmbientLight({ color: 0xffffff, intensity: AMBIENT }))
  const lamp = new PointLight({ color: 0xffc27a, intensity: 6, range: 6 })
  const flash = new PointLight({ color: 0xffe08a, intensity: 0, range: 7 })
  view.root.addChild(lamp, flash)

  const tracerMaterial = new Material3D({
    baseColor: 0x000000,
    emissive: { color: 0xffb040, strength: 6 },
  })
  const tracerGeometry = new SphereGeometry({ radius: 0.12 })
  const tracers: Array<Mesh3D> = []
  const muzzle = new Mesh3D({
    geometry: new SphereGeometry({ radius: 0.28 }),
    material: new Material3D({
      baseColor: 0x000000,
      emissive: { color: 0xfff0a0, strength: 0 },
    }),
    castShadow: false,
  })
  view.root.addChild(muzzle)

  const wallMaterial = new ToonMaterial({
    baseColor: 0x5a4458,
    bands: 3,
    specularSize: 0,
    rimIntensity: 0.3,
    outline: true,
  })

  const standing = new Container3D()
  view.root.addChild(standing)
  const billboards = new BillboardPool(standing, true)
  const glowing = new BillboardPool(standing, false)

  let built: Level3D | undefined
  let casters: Container3D | undefined
  const castShadows = (level3d: Level3D): void => {
    casters?.destroy({ children: true })
    casters = shadowCastersOf(app, level3d.holder, level3d.furniture, level3d.plants)
  }
  let lastDecals: unknown
  let lastImagesLoaded = -1
  let yaw = YAW
  // NOTE: zoom is whole screen pixels per game pixel more or less than the
  // 2D game's own scale.
  let zoom = 0
  const focus = { x: 0, z: 0, isSet: false }
  let flashLevel = 0
  let lastCooldown = 0

  window.addEventListener(
    'keydown',
    event => {
      const turn = { Comma: -Math.PI / 12, Period: Math.PI / 12 }
      if (event.code === 'Comma' || event.code === 'Period') {
        yaw += turn[event.code]
      } else if (event.code === 'Minus') {
        zoom -= 1
      } else if (event.code === 'Equal') {
        zoom += 1
      } else if (event.code === 'Digit0') {
        yaw = YAW
        zoom = 0
      } else if (event.code === 'Backslash') {
        show2d(app.canvas.style.opacity !== '0')
      } else {
        return
      }
      event.stopPropagation()
      event.preventDefault()
    },
    { capture: true },
  )

  // THE MOUSE
  // NOTE: the game aims through its own 2D camera. Each mouse move or press
  // is caught before the game sees it, cast as a ray through the 3D view
  // onto the floor, and sent on again at the client point where the 2D
  // game draws that spot of floor, so the crosshair lands where it looks.
  const floor = new Plane(new Vector3(0, 1, 0), 0)
  const remapped = new WeakSet<Event>()
  // NOTE: the last real cursor, sent again each frame: both cameras move
  // under a still cursor (the game's leans toward the aim), so the spot
  // under it changes even when the mouse does not.
  let cursor: { x: number; y: number; buttons: number } | undefined
  const remap = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse' || remapped.has(event)) {
      return
    }
    cursor = { x: event.clientX, y: event.clientY, buttons: event.buttons }
    const model: Model = window.__model
    if (model.maybeSurface._tag === 'None') {
      return
    }
    const surface = model.maybeSurface.value
    const rect = app.canvas.getBoundingClientRect()
    const hit = view.screenToWorld(
      { x: event.clientX - rect.left, y: event.clientY - rect.top },
      floor,
    )
    if (hit === null) {
      return
    }
    const gameCamera = worldCameraFor(model, screenOf(model))
    const inView = {
      x: (hit.x / UNIT - gameCamera.x) * gameCamera.scale + gameCamera.left,
      y: (hit.z / UNIT / STRETCH - gameCamera.y) * gameCamera.scale + gameCamera.top,
    }
    const origin = clientToView(surface, { x: 0, y: 0 })
    const far = clientToView(surface, { x: 1000, y: 1000 })
    if (origin._tag === 'None' || far._tag === 'None') {
      return
    }
    const kx = (far.value.x - origin.value.x) / 1000
    const ky = (far.value.y - origin.value.y) / 1000
    const again = new PointerEvent(event.type, {
      clientX: (inView.x - origin.value.x) / kx,
      clientY: (inView.y - origin.value.y) / ky,
      pointerId: event.pointerId,
      pointerType: 'mouse',
      button: event.button,
      buttons: event.buttons,
      isPrimary: event.isPrimary,
      bubbles: true,
      cancelable: true,
      composed: true,
    })
    remapped.add(again)
    event.stopImmediatePropagation()
    ;(event.target ?? document).dispatchEvent(again)
  }
  window.addEventListener('pointermove', remap, { capture: true })
  window.addEventListener('pointerdown', remap, { capture: true })
  // NOTE: for the spike's own checks (the aim test reads it).
  Object.assign(window, {
    __iso: {
      view,
      // NOTE: where the cursor's floor point is, and where the game now aims.
      check: (clientX: number, clientY: number) => {
        const model: Model = window.__model
        const rect = app.canvas.getBoundingClientRect()
        const hit = view.screenToWorld(
          { x: clientX - rect.left, y: clientY - rect.top },
          floor,
        )
        const gameCamera = worldCameraFor(model, screenOf(model))
        const aim =
          model.input.maybeMouseInView._tag === 'Some'
            ? viewToWorld(gameCamera, model.input.maybeMouseInView.value)
            : undefined
        return {
          hit: hit && { x: hit.x / UNIT, y: hit.z / UNIT / STRETCH },
          aim,
        }
      },
    },
  })

  const buildLevel = (level: Level): Level3D => {
    if (built !== undefined) {
      built.holder.destroy({ children: true })
    }
    const holder = new Container3D()
    view.root.addChild(holder)
    const room = new FloorLayer(app, level, 0, true)
    const decals = new FloorLayer(app, level, 0.005, true)
    const landed = new FloorLayer(app, level, 0.008, true)
    const ground = new FloorLayer(app, level, 0.012, false)
    const walls = buildWalls(level, wallMaterial)
    holder.addChild(room.mesh, decals.mesh, landed.mesh, ground.mesh)
    for (const wall of walls) {
      holder.addChild(wall.mesh)
    }
    const floorArt = floorArtOf(level)
    room.paintLeaves(floorArt)
    lastDecals = undefined
    return {
      level,
      room,
      decals,
      ground,
      landed,
      walls,
      holder,
      floorArt,
      furniture: tallCoverOf(level),
      lights: lightsOf(level, holder),
      plants: plantsOf(app, level),
    }
  }

  app.ticker.add(ticker => {
    const model: Model = window.__model
    const level = levelOf(model)
    if (built === undefined || built.level !== level) {
      built = buildLevel(level)
      casters = undefined
      castShadows(built)
    }
    if (imagesLoaded !== lastImagesLoaded) {
      lastImagesLoaded = imagesLoaded
      built.room.paintLeaves(built.floorArt)
      lastDecals = undefined
      castShadows(built)
    }
    if (model.decals !== lastDecals) {
      lastDecals = model.decals
      built.decals.paint(decalShapes(model.decals))
    }

    // THE CAMERA
    // NOTE: the game culls to its own camera; the 3D view shows a little
    // more, so it asks with a camera three times as wide and tall.
    const screen = screenOf(model)
    const gameCamera = worldCameraFor(model, screen)
    const { player } = focusOf(model)
    const target = { x: player.x * UNIT, z: zOf(player.y) }
    const across = app.canvas.width
    const pixels = Math.max(
      1,
      Math.round(across / gameCamera.width) + zoom,
    )
    billboards.grid = 1 / pixels
    glowing.grid = 1 / pixels
    const k = focus.isSet ? 1 - Math.exp(-6 * (ticker.deltaMS / 1000)) : 1
    focus.x += (target.x - focus.x) * k
    focus.z += (target.z - focus.z) * k
    focus.isSet = true
    // NOTE: the camera moves by whole screen pixels, so the art never
    // shimmers between them.
    const stepX = UNIT / pixels
    const stepZ = (UNIT * STRETCH) / pixels
    const lookX = Math.round(focus.x / stepX) * stepX
    const lookZ = Math.round(focus.z / stepZ) * stepZ
    const toCamera = { x: Math.sin(yaw), z: Math.cos(yaw) }
    const distance = 80
    camera.position.set(
      lookX + toCamera.x * Math.cos(PITCH) * distance,
      Math.sin(PITCH) * distance,
      lookZ + toCamera.z * Math.cos(PITCH) * distance,
    )
    camera.lookAt({ x: lookX, y: 0, z: lookZ })
    camera.orthographicSize = (across * UNIT) / (2 * pixels)
    cutAway(built.walls, target, toCamera)
    const basis: Basis = {
      up: {
        x: -toCamera.x * Math.sin(PITCH),
        y: Math.cos(PITCH),
        z: -toCamera.z * Math.sin(PITCH),
      },
      toward: {
        x: toCamera.x * Math.cos(PITCH),
        y: Math.sin(PITCH),
        z: toCamera.z * Math.cos(PITCH),
      },
    }
    billboards.basis = basis
    glowing.basis = basis
    if (cursor !== undefined) {
      remap(
        new PointerEvent('pointermove', {
          clientX: cursor.x,
          clientY: cursor.y,
          buttons: cursor.buttons,
          pointerType: 'mouse',
          pointerId: 1,
          isPrimary: true,
        }),
      )
    }

    const wide = {
      ...gameCamera,
      x: gameCamera.x - gameCamera.width,
      y: gameCamera.y - gameCamera.height,
      width: gameCamera.width * 3,
      height: gameCamera.height * 3,
    }
    const strata = worldStrataOf(model, wide)
    const landed = flatten(groundParticleShapes(model.particles))
    const landedKeys = new Set(
      landed.flatMap(({ shape }) =>
        shape._tag === 'Rect' ? [rectKey(shape)] : [],
      ),
    )
    built.landed.paintLeaves(landed)
    built.ground.paintLeaves(
      flatten(strata.ground).filter(
        ({ shape }) => !(shape._tag === 'Rect' && landedKeys.has(rectKey(shape))),
      ),
    )

    // NOTE: the game hands back a tall piece only while someone is behind
    // it, faded for them. Every piece stands here all the time, at the
    // game's fade when it gives one.
    const fades = new Map<ReadonlyArray<Canvas.Shape>, number>()
    const t = Math.floor((model.elapsedMs / 1000) * POSE_HZ) / POSE_HZ
    billboards.begin()
    glowing.begin()
    for (const drawable of strata.standing) {
      const [first] = drawable.shapes
      const piece = built.furniture.find(
        ({ shapes }) =>
          shapes === drawable.shapes ||
          (drawable.shapes.length === 1 &&
            first?._tag === 'Group' &&
            first.shapes === shapes),
      )
      if (piece !== undefined) {
        fades.set(piece.shapes, first?._tag === 'Group' ? (first.opacity ?? 1) : 1)
        continue
      }
      billboards.standUp(drawable.shapes, drawable.footY)
    }
    for (const piece of built.furniture) {
      billboards.standUp(piece.shapes, piece.footY, 0, fades.get(piece.shapes) ?? 1)
    }
    for (const plant of built.plants) {
      standPlant(billboards, plant, t)
    }
    const chandelier = new Set(
      flatten(hungChandelierShapes(model)).map(({ shape, matrix }) =>
        imageKey(shape, matrix),
      ),
    )
    const sway = chandelierSway(t)
    // NOTE: sparks, blood, and dust in the air are lit as the bodies are,
    // so they vanish into the cellar's dark with them.
    const airborne = new Set(
      flatten(airborneParticleShapes(model.particles)).flatMap(({ shape }) =>
        shape._tag === 'Rect' ? [rectKey(shape)] : [],
      ),
    )
    for (const { shape, matrix, alpha } of flatten(strata.overhead)) {
      const bottom =
        shape._tag === 'Image' || shape._tag === 'Rect'
          ? matrix.b * shape.x + matrix.d * (shape.y + shape.height) + matrix.f
          : 0
      const isChandelier =
        shape._tag === 'Image' && chandelier.has(imageKey(shape, matrix))
      const swung = isChandelier
        ? { ...matrix, e: matrix.e + sway }
        : matrix
      const isLitInAir =
        isChandelier || (shape._tag === 'Rect' && airborne.has(rectKey(shape)))
      ;(isLitInAir ? billboards : glowing).standLeaves(
        [{ shape, matrix: swung, alpha }],
        bottom + 2,
        6,
      )
    }
    billboards.end()
    glowing.end()

    // THE LIGHTS
    sun.position.set(focus.x - 20, 30, focus.z - 10)
    sun.lookAt({ x: focus.x, y: 0, z: focus.z })
    lamp.position.set(target.x, 1.6, target.z)
    built.lights.update(model)
    if (player.fireCooldownMs > lastCooldown + 1) {
      flashLevel = 1
    }
    lastCooldown = player.fireCooldownMs
    flashLevel *= Math.exp(-18 * (ticker.deltaMS / 1000))
    const muzzleX = target.x + player.facing.x * 0.9
    const muzzleZ = target.z + player.facing.y * 0.9 * STRETCH
    flash.position.set(muzzleX, 0.9, muzzleZ)
    flash.intensity = 24 * flashLevel
    muzzle.position.set(muzzleX, 0.8, muzzleZ)
    muzzle.scale.set(flashLevel, flashLevel, flashLevel)
    if (muzzle.material instanceof Material3D && muzzle.material.emissive !== undefined) {
      muzzle.material.emissive.strength = 8 * flashLevel
    }

    // NOTE: each bullet glows as a tracer over the floor's own drawing.
    model.bullets.forEach((bullet, index) => {
      const tracer =
        tracers[index] ??
        new Mesh3D({
          geometry: tracerGeometry,
          material: tracerMaterial,
          castShadow: false,
        })
      if (tracers[index] === undefined) {
        tracers[index] = tracer
        view.root.addChild(tracer)
      }
      tracer.visible = true
      tracer.position.set(bullet.x * UNIT, 0.7, zOf(bullet.y))
    })
    for (let index = model.bullets.length; index < tracers.length; index += 1) {
      const tracer = tracers[index]
      if (tracer !== undefined) {
        tracer.visible = false
      }
    }

    badge.textContent = `${app.renderer.name.toUpperCase()} · ${Math.round(ticker.FPS)} fps · ${model.zombies.length} zombies · , . turn  - = zoom  \\ 2D`
  })
}
