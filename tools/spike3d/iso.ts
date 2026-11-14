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
  PointLight,
  SphereGeometry,
  Sprite3D,
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
import { worldCameraFor } from '@game/render/camera'
import { decalShapes } from '@game/render/effectsView'
import { roomShapes } from '@game/render/room/room'
import { screenOf } from '@game/render/screen'
import { worldStrataOf } from '@game/screens/game/worldView'
import { TILE_SIZE } from '@game/shared/constants'
import { levelOf } from '@game/world/level/arena'
import type { Level } from '@game/world/level/arena'
import { WALL_SYMBOL } from '@game/world/level/tileGrid'
import { focusOf } from '@game/world/party/party'

// UNITS

// NOTE: one world unit is one tile. A game pixel is a tenth of a unit, x runs
// east and z runs south (the game's y), and y is up.
const UNIT = 1 / TILE_SIZE
const WALL_HEIGHT = 1.4
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
    let graphicsUsed = 0
    let spritesUsed = 0
    let current: Graphics | undefined
    this.container.removeChildren()
    for (const { shape, matrix, alpha } of flatten(shapes)) {
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
          roughness: 0.9,
          alphaMode: lift === 0 ? 'opaque' : 'blend',
        })
      : new FlatMaterial({ baseColorTexture: this.texture, alphaMode: 'blend' })
    this.mesh = new Mesh3D({
      geometry: new PlaneGeometry({
        width: level.width * UNIT,
        height: level.height * UNIT,
      }),
      material,
      rotation: { x: -Math.PI / 2, y: 0, z: 0 },
      position: {
        x: (level.left + level.width / 2) * UNIT,
        y: lift,
        z: (level.top + level.height / 2) * UNIT,
      },
      castShadow: false,
      receiveShadow: isLit,
    })
  }

  paint(shapes: ReadonlyArray<Canvas.Shape>): void {
    this.painter.paint(shapes)
    this.texture.render()
  }
}

// STANDING SPRITES

// NOTE: every Image of a standing drawable as a billboard at its foot: its
// bottom edge stands as far above the foot as it is drawn above it, and the
// billboard sits on the foot's row, so the depth buffer sorts what the
// game's foot sort did. Rects (bars, small bits of a body) stand the same
// way as tinted white quads.
class BillboardPool {
  private readonly sprites: Array<Sprite3D> = []
  private used = 0

  private readonly parent: Container3D

  constructor(parent: Container3D) {
    this.parent = parent
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

  standUp(shapes: ReadonlyArray<Canvas.Shape>, footY: number, hover = 0): void {
    for (const { shape, matrix, alpha } of flatten(shapes)) {
      if (shape._tag !== 'Image' && shape._tag !== 'Rect') {
        continue
      }
      if (shape._tag === 'Rect' && shape.fill === undefined) {
        continue
      }
      const left = matrix.a * shape.x + matrix.c * shape.y + matrix.e
      const top = matrix.b * shape.x + matrix.d * shape.y + matrix.f
      const width = matrix.a * shape.width + matrix.c * shape.height
      const height = matrix.b * shape.width + matrix.d * shape.height
      const isFlipped = width < 0
      const drawnWidth = Math.abs(width)
      const drawnHeight = Math.abs(height)
      if (drawnWidth < 0.01 || drawnHeight < 0.01) {
        continue
      }
      const bottom = Math.max(top, top + height)
      const centerX = left + width / 2
      const texture =
        shape._tag === 'Image' ? textureOf(shape, isFlipped) : Texture.WHITE
      if (texture === undefined) {
        continue
      }
      const sprite = this.next()
      if (sprite.texture !== texture) {
        sprite.texture = texture
      }
      sprite.pixelSize = (drawnHeight / texture.frame.height) * UNIT
      // NOTE: a white quad is square; stretch it to the rect.
      sprite.scale.x =
        shape._tag === 'Rect'
          ? drawnWidth / texture.frame.width / (drawnHeight / texture.frame.height)
          : 1
      if (shape._tag === 'Rect' && shape.fill !== undefined) {
        const { color, alpha: a } = colorOf(shape.fill)
        sprite.tint = color
        sprite.alpha = a * alpha
      } else {
        sprite.tint = 0xffffff
        sprite.alpha = alpha
      }
      sprite.position.set(
        centerX * UNIT,
        (footY - bottom + hover) * UNIT,
        footY * UNIT,
      )
      sprite.visible = true
    }
  }

  private next(): Sprite3D {
    const existing = this.sprites[this.used]
    this.used += 1
    if (existing !== undefined) {
      return existing
    }
    const sprite = new Sprite3D({
      texture: Texture.WHITE,
      anchor: { x: 0.5, y: 1 },
      billboardMode: 'cylindrical',
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
      const z = (level.top + row * TILE_SIZE) * UNIT + 0.5
      walls.push({
        x,
        z,
        mesh: new Mesh3D({
          geometry: WALL_GEOMETRY,
          material,
          position: { x, y: WALL_HEIGHT / 2, z },
          scale: { x: 1, y: WALL_HEIGHT, z: 1 },
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

// THE SCENE

type Level3D = Readonly<{
  level: Level
  room: FloorLayer
  decals: FloorLayer
  ground: FloorLayer
  walls: ReadonlyArray<Wall>
  holder: Container3D
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
    antialias: true,
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
    toneMapping: 'aces',
    environment: { skyColor: 0x9db4ff, groundColor: 0x3a2a30, intensity: 0.55 },
    passes: [
      new OutlinePass({ width: 0.04, color: 0x1a1220 }),
      new BloomEffect({ threshold: 1.2, intensity: 1.1, radius: 0.6 }),
    ],
  })
  app.stage.addChild(view)

  const camera = view.camera
  camera.mode = 'orthographic'
  camera.near = 0.1
  camera.far = 400

  const sun = new DirectionalLight({
    color: 0xffe6c4,
    intensity: 1.4,
    castShadow: true,
  })
  view.root.addChild(sun)
  view.root.addChild(new AmbientLight({ color: 0x8090ff, intensity: 0.6 }))
  const lamp = new PointLight({ color: 0xffc27a, intensity: 18, range: 9 })
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
    baseColor: 0x7a5c58,
    bands: 3,
    rimIntensity: 0.3,
    passes: { outline: true },
  })

  const standing = new Container3D()
  view.root.addChild(standing)
  const billboards = new BillboardPool(standing)

  let built: Level3D | undefined
  let lastDecals: unknown
  let lastImagesLoaded = -1
  let yaw = Math.PI / 4
  let zoom = 1
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
        zoom = Math.max(0.4, zoom / 1.15)
      } else if (event.code === 'Equal') {
        zoom = Math.min(3, zoom * 1.15)
      } else if (event.code === 'Digit0') {
        yaw = Math.PI / 4
        zoom = 1
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

  const buildLevel = (level: Level): Level3D => {
    if (built !== undefined) {
      built.holder.destroy({ children: true })
    }
    const holder = new Container3D()
    view.root.addChild(holder)
    const room = new FloorLayer(app, level, 0, true)
    const decals = new FloorLayer(app, level, 0.005, true)
    const ground = new FloorLayer(app, level, 0.012, false)
    const walls = buildWalls(level, wallMaterial)
    holder.addChild(room.mesh, decals.mesh, ground.mesh)
    for (const wall of walls) {
      holder.addChild(wall.mesh)
    }
    room.paint(roomShapes(level))
    lastDecals = undefined
    sun.fitShadowBounds()
    return { level, room, decals, ground, walls, holder }
  }

  app.ticker.add(ticker => {
    const model: Model = window.__model
    const level = levelOf(model)
    if (built === undefined || built.level !== level) {
      built = buildLevel(level)
    }
    if (imagesLoaded !== lastImagesLoaded) {
      lastImagesLoaded = imagesLoaded
      built.room.paint(roomShapes(level))
      lastDecals = undefined
    }
    if (model.decals !== lastDecals) {
      lastDecals = model.decals
      built.decals.paint(decalShapes(model.decals))
    }

    // NOTE: the game culls to its own camera; the isometric view shows more,
    // so it asks with a camera three times as wide and tall.
    const screen = screenOf(model)
    const gameCamera = worldCameraFor(model, screen)
    const wide = {
      ...gameCamera,
      x: gameCamera.x - gameCamera.width,
      y: gameCamera.y - gameCamera.height,
      width: gameCamera.width * 3,
      height: gameCamera.height * 3,
    }
    const strata = worldStrataOf(model, wide)
    built.ground.paint(strata.ground)

    billboards.begin()
    for (const drawable of strata.standing) {
      billboards.standUp(drawable.shapes, drawable.footY)
    }
    for (const { shape, matrix } of flatten(strata.overhead)) {
      const bottom =
        shape._tag === 'Image' || shape._tag === 'Rect'
          ? matrix.b * shape.x + matrix.d * (shape.y + shape.height) + matrix.f
          : 0
      billboards.standUp([shape], bottom + 2, 6)
    }
    billboards.end()

    // THE CAMERA
    const { player } = focusOf(model)
    const target = { x: player.x * UNIT, z: player.y * UNIT }
    const k = focus.isSet ? 1 - Math.exp(-6 * (ticker.deltaMS / 1000)) : 1
    focus.x += (target.x - focus.x) * k
    focus.z += (target.z - focus.z) * k
    focus.isSet = true
    const pitch = (35 * Math.PI) / 180
    const toCamera = { x: Math.sin(yaw), z: Math.cos(yaw) }
    const distance = 80
    camera.position.set(
      focus.x + toCamera.x * Math.cos(pitch) * distance,
      Math.sin(pitch) * distance,
      focus.z + toCamera.z * Math.cos(pitch) * distance,
    )
    camera.lookAt({ x: focus.x, y: 0, z: focus.z })
    camera.orthographicSize = (gameCamera.width * UNIT * 0.62) / zoom
    cutAway(built.walls, target, toCamera)

    // THE LIGHTS
    sun.position.set(focus.x - 20, 30, focus.z - 10)
    sun.lookAt({ x: focus.x, y: 0, z: focus.z })
    lamp.position.set(target.x, 1.6, target.z)
    if (player.fireCooldownMs > lastCooldown + 1) {
      flashLevel = 1
    }
    lastCooldown = player.fireCooldownMs
    flashLevel *= Math.exp(-18 * (ticker.deltaMS / 1000))
    const muzzleX = target.x + player.facing.x * 0.9
    const muzzleZ = target.z + player.facing.y * 0.9
    flash.position.set(muzzleX, 0.9, muzzleZ)
    flash.intensity = 40 * flashLevel
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
      tracer.position.set(bullet.x * UNIT, 0.7, bullet.y * UNIT)
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
