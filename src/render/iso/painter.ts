// Canvas shapes painted flat into pixi: consecutive vector shapes share one
// Graphics, and each image gets a pooled Sprite, in the shapes' own order.
// A floor layer shows what it paints on a plane over the floor.

import { Match } from 'effect'
import type { Canvas } from 'foldkit'
import { type Application, Container, Graphics, Matrix, Sprite } from 'pixi.js'

import {
  ContainerTexture,
  FlatMaterial,
  Material3D,
  Mesh3D,
  PlaneGeometry,
} from '@pixi/3d'

import type { Level } from '../../world/level/arena'
import { type Affine, type Leaf, flatten } from './flatten'
import { STRETCH, UNIT, zOf } from './space'
import { type Textures, colorOf } from './textures'

const matrixOf = (m: Affine): Matrix => new Matrix(m.a, m.b, m.c, m.d, m.e, m.f)

const fillAndStroke = (
  graphics: Graphics,
  shape: Readonly<{
    fill?: string | undefined
    stroke?: string | undefined
    lineWidth?: number | undefined
  }>,
  alpha: number,
): void => {
  if (shape.fill !== undefined) {
    const fill = colorOf(shape.fill)
    graphics.fill({ color: fill.color, alpha: fill.alpha * alpha })
  }
  if (shape.stroke !== undefined) {
    const stroke = colorOf(shape.stroke)
    graphics.stroke({
      color: stroke.color,
      alpha: stroke.alpha * alpha,
      width: shape.lineWidth ?? 1,
    })
  }
}

type Trace = (graphics: Graphics) => void

const traceStep = Match.type<Canvas.Path['instructions'][number]>().pipe(
  Match.tagsExhaustive({
    MoveTo:
      ({ x, y }): Trace =>
      graphics => {
        graphics.moveTo(x, y)
      },
    LineTo:
      ({ x, y }): Trace =>
      graphics => {
        graphics.lineTo(x, y)
      },
    QuadTo:
      ({ cpx, cpy, x, y }): Trace =>
      graphics => {
        graphics.quadraticCurveTo(cpx, cpy, x, y)
      },
    BezierTo:
      ({ cp1x, cp1y, cp2x, cp2y, x, y }): Trace =>
      graphics => {
        graphics.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y)
      },
    Close: (): Trace => graphics => {
      graphics.closePath()
    },
  }),
)

const tracePath = (graphics: Graphics, path: Canvas.Path): void => {
  for (const step of path.instructions) {
    traceStep(step)(graphics)
  }
}

type VectorShape = Exclude<Canvas.Shape, Canvas.Group | Canvas.Image>

type Draw = (graphics: Graphics, alpha: number) => void

// NOTE: text never lies on the floor or stands in the world; the overlay
// canvas draws it.
const drawOf = Match.type<VectorShape>().pipe(
  Match.tagsExhaustive({
    Rect:
      (shape): Draw =>
      (graphics, alpha) => {
        graphics.rect(shape.x, shape.y, shape.width, shape.height)
        fillAndStroke(graphics, shape, alpha)
      },
    Circle:
      (shape): Draw =>
      (graphics, alpha) => {
        graphics.circle(shape.x, shape.y, shape.radius)
        fillAndStroke(graphics, shape, alpha)
      },
    Path:
      (shape): Draw =>
      (graphics, alpha) => {
        tracePath(graphics, shape)
        fillAndStroke(graphics, shape, alpha)
      },
    Text: (): Draw => () => undefined,
  }),
)

const drawVector = (
  graphics: Graphics,
  shape: VectorShape,
  alpha: number,
): void => {
  drawOf(shape)(graphics, alpha)
}

// NOTE: mutable on purpose: it pools pixi's own mutable objects.
export class FlatPainter {
  readonly container = new Container()
  private readonly textures: Textures
  private readonly graphics: Array<Graphics> = []
  private readonly sprites: Array<Sprite> = []

  constructor(textures: Textures) {
    this.textures = textures
  }

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
        const texture = this.textures.imageOf(shape, false)
        if (texture !== undefined) {
          const sprite = this.sprites[spritesUsed] ?? new Sprite()
          this.sprites[spritesUsed] = sprite
          spritesUsed += 1
          sprite.texture = texture
          sprite.setFromMatrix(
            matrixOf(matrix).append(
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
        }
      } else {
        if (current === undefined) {
          current = this.graphics[graphicsUsed] ?? new Graphics()
          this.graphics[graphicsUsed] = current
          graphicsUsed += 1
          current.clear()
          this.container.addChild(current)
        }
        // NOTE: the transform of what the Graphics draws next, not of the
        // Graphics itself, so shapes under different groups share one.
        current.setTransform(matrixOf(matrix))
        drawVector(current, shape, alpha)
      }
    }
  }
}

// NOTE: a floor-sized texture painted from shapes in level pixels, on a plane
// just above the floor. `lift` keeps the layers from fighting. A lit layer
// takes the room's light (it sinks into the cellar's dark); an unlit one
// glows of itself (the rings, the sights).
export class FloorLayer {
  readonly mesh: Mesh3D
  private readonly painter: FlatPainter
  private readonly texture: ContainerTexture

  constructor(
    input: Readonly<{
      app: Application
      textures: Textures
      level: Level
      lift: number
      isLit: boolean
    }>,
  ) {
    const { app, textures, level, lift, isLit } = input
    this.painter = new FlatPainter(textures)
    const frame = new Container()
    frame.addChild(this.painter.container)
    frame.position.set(-level.left, -level.top)
    this.texture = new ContainerTexture({
      container: frame,
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

  destroy(): void {
    this.texture.destroy(true)
  }
}
