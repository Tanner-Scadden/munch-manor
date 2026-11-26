import { Array, Match, Option } from 'effect'
import {
  type Application,
  Container,
  Graphics,
  Matrix,
  Sprite,
  type Texture,
} from 'pixi.js'

import {
  ContainerTexture,
  FlatMaterial,
  Material3D,
  Mesh3D,
  PlaneGeometry,
} from '@pixi/3d'

import type { Level } from '../../world/level/arena'
import type * as Draw from '../draw'
import { type Affine, type Leaf, flatten, isSameLeaves } from './flatten'
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

const traceStep = Match.type<Draw.Path['instructions'][number]>().pipe(
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

const tracePath = (graphics: Graphics, path: Draw.Path): void => {
  for (const step of path.instructions) {
    traceStep(step)(graphics)
  }
}

type VectorShape = Exclude<Draw.Shape, Draw.Group | Draw.Image>

type Draw = (graphics: Graphics, alpha: number) => void

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
  }),
)

const drawVector = (
  graphics: Graphics,
  shape: VectorShape,
  alpha: number,
): void => {
  drawOf(shape)(graphics, alpha)
}

export class FlatPainter {
  readonly container = new Container()
  private readonly textures: Textures
  private readonly graphics: Array<Graphics> = []
  private readonly sprites: Array<Sprite> = []

  constructor(textures: Textures) {
    this.textures = textures
  }

  paint(shapes: ReadonlyArray<Draw.Shape>): void {
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
        current.setTransform(matrixOf(matrix))
        drawVector(current, shape, alpha)
      }
    }
  }
}

export class FloorPicture {
  readonly texture: ContainerTexture
  private readonly coats: ReadonlyArray<FlatPainter>

  constructor(
    input: Readonly<{
      app: Application
      textures: Textures
      level: Level
      coats?: number
      base?: Texture
    }>,
  ) {
    const { app, textures, level, coats = 1, base } = input
    this.coats = Array.makeBy(coats, () => new FlatPainter(textures))
    const frame = new Container()
    if (base !== undefined) {
      const under = new Sprite(base)
      under.position.set(level.left, level.top + level.height)
      under.scale.set(1, -1)
      frame.addChild(under)
    }
    for (const coat of this.coats) {
      frame.addChild(coat.container)
    }
    frame.position.set(-level.left, -level.top)
    this.texture = new ContainerTexture({
      container: frame,
      width: level.width,
      height: level.height,
      renderer: app.renderer,
    })
    this.texture.source.scaleMode = 'nearest'
  }

  paintCoat(coat: number, leaves: ReadonlyArray<Leaf>): void {
    Option.map(Array.get(this.coats, coat), painter => {
      painter.paintLeaves(leaves)
    })
  }

  paint(shapes: ReadonlyArray<Draw.Shape>): void {
    this.paintLeaves(flatten(shapes))
  }

  paintLeaves(leaves: ReadonlyArray<Leaf>): void {
    this.paintCoat(0, leaves)
    this.render()
  }

  render(): void {
    this.texture.render()
  }

  destroy(): void {
    this.texture.destroy(true)
  }
}

export class FloorLayer {
  readonly mesh: Mesh3D
  readonly picture: FloorPicture
  private readonly textures: Textures
  private shown: ReadonlyArray<Leaf> | undefined
  private shownLoaded = -1

  constructor(
    input: Readonly<{
      app: Application
      textures: Textures
      level: Level
      lift: number
      isLit: boolean
      coats?: number
      base?: Texture
    }>,
  ) {
    const { level, lift, isLit, textures } = input
    this.textures = textures
    this.picture = new FloorPicture(input)
    const texture = this.picture.texture
    const material = isLit
      ? new Material3D({
          baseColorTexture: texture,
          roughness: 1,
          metallic: 0,
          specular: { factor: 0 },
          alphaMode: lift === 0 ? 'opaque' : 'blend',
          ...textures.lookOptions('House'),
        })
      : new FlatMaterial({ baseColorTexture: texture, alphaMode: 'blend' })
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

  paintLeaves(leaves: ReadonlyArray<Leaf>): void {
    const loaded = this.textures.loaded
    if (
      loaded === this.shownLoaded &&
      this.shown !== undefined &&
      isSameLeaves(this.shown, leaves)
    ) {
      return
    }
    this.shown = leaves
    this.shownLoaded = loaded
    this.mesh.visible = leaves.length > 0
    this.picture.paintLeaves(leaves)
  }

  destroy(): void {
    this.picture.destroy()
  }
}
