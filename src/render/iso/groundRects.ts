// The ground's flat rectangles (the bodies' shadows, the kitchen leak's
// light and steam, a glow on the floor) as quads of one mesh in the 3D
// scene, its corners and colors written again only when they change, in the
// ground's own order, so one draw shows them as the painter would. They
// move or pulse nearly every frame, and painted into the ground's
// level-sized picture they drew that whole picture again each frame for a
// few small boxes. What a quad cannot show (an image, a path, a circle, an
// outline, a turned shape) stays in the picture, drawn again only when it
// changes (painter.ts).

import { Array } from 'effect'

import { FlatMaterial, Geometry3D, Mesh3D, srgbToLinear } from '@pixi/3d'

import type * as Draw from '../draw'
import { type Leaf, isSameLeaves } from './flatten'
import { UNIT, zOf } from './space'
import { colorOf } from './textures'

// NOTE: a flat filled rectangle, with no outline and not turned or skewed:
// a box of game pixels on the floor.
type RectLeaf = Leaf & Readonly<{ shape: Draw.Rect }>

const isRectLeaf = (leaf: Leaf): leaf is RectLeaf =>
  leaf.shape._tag === 'Rect' &&
  leaf.shape.fill !== undefined &&
  leaf.shape.stroke === undefined &&
  leaf.matrix.b === 0 &&
  leaf.matrix.c === 0

// NOTE: the ground's leaves split in their own order: the rectangles drawn
// as quads, and the rest painted into the picture under them.
export const splitGround = (
  leaves: ReadonlyArray<Leaf>,
): Readonly<{
  rects: ReadonlyArray<RectLeaf>
  rest: ReadonlyArray<Leaf>
}> => {
  const rects: Array<RectLeaf> = []
  const rest: Array<Leaf> = []
  for (const leaf of leaves) {
    if (isRectLeaf(leaf)) {
      rects.push(leaf)
    } else {
      rest.push(leaf)
    }
  }
  return { rects, rest }
}

export type GroundBox = Readonly<{
  x: number
  y: number
  width: number
  height: number
  red: number
  green: number
  blue: number
  alpha: number
}>

// NOTE: a rectangle as the box of game pixels it covers on the floor, and
// its color with the opacity its groups give it.
export const groundBoxOf = ({ shape, matrix, alpha }: RectLeaf): GroundBox => {
  const left = matrix.a * shape.x + matrix.e
  const right = matrix.a * (shape.x + shape.width) + matrix.e
  const top = matrix.d * shape.y + matrix.f
  const bottom = matrix.d * (shape.y + shape.height) + matrix.f
  const { color, alpha: fillAlpha } = colorOf(shape.fill ?? '')
  // NOTE: every edge on a whole game pixel, as the picture's texels held
  // it (pixel-perfect settings, owner, 2026-11-14).
  const x = Math.round(Math.min(left, right))
  const y = Math.round(Math.min(top, bottom))
  return {
    x,
    y,
    width: Math.round(Math.max(left, right)) - x,
    height: Math.round(Math.max(top, bottom)) - y,
    red: ((color >> 16) & 0xff) / 255,
    green: ((color >> 8) & 0xff) / 255,
    blue: (color & 0xff) / 255,
    alpha: fillAlpha * alpha,
  }
}

// NOTE: a vertex color is taken as linear light, while a shape's color is
// a display color, as the picture's texels were before the renderer
// decoded them: decoded here the same way, so a dark red stays dark red
// rather than pink.
type QuadArrays = Readonly<{ positions: Float32Array; colors: Float32Array }>

// NOTE: where the quads' mesh stands in the world, its corners written from
// there.
export type QuadsOrigin = Readonly<{ x: number; y: number; z: number }>

// NOTE: the boxes into the quads' corners and colors, each quad's corners
// on the floor at `lift`, from `origin`, and every quad past the last box
// folded to a point, so it draws nothing.
export const writeGroundBoxes = (
  input: Readonly<{
    boxes: ReadonlyArray<GroundBox>
    lift: number
    origin: QuadsOrigin
    out: QuadArrays
  }>,
): void => {
  const { boxes, lift, origin, out } = input
  const y = lift - origin.y
  const capacity = out.positions.length / 12
  for (let index = 0; index < capacity; index += 1) {
    const box = boxes[index]
    const at = index * 12
    if (box === undefined) {
      out.positions.fill(0, at, at + 12)
      out.colors.fill(0, index * 16, index * 16 + 16)
      continue
    }
    const left = box.x * UNIT - origin.x
    const right = (box.x + box.width) * UNIT - origin.x
    const near = zOf(box.y) - origin.z
    const far = zOf(box.y + box.height) - origin.z
    out.positions.set(
      [left, y, near, right, y, near, right, y, far, left, y, far],
      at,
    )
    for (let corner = 0; corner < 4; corner += 1) {
      out.colors.set(
        [
          srgbToLinear(box.red),
          srgbToLinear(box.green),
          srgbToLinear(box.blue),
          box.alpha,
        ],
        index * 16 + corner * 4,
      )
    }
  }
}

const FIRST_CAPACITY = 64

// NOTE: how much higher than the picture's middle the quads' mesh stands,
// a hair under the puddles' lift over the ground's.
const ORDER_STEP = 0.0005

type Quads = QuadArrays & Readonly<{ mesh: Mesh3D }>

const quadsOf = (
  input: Readonly<{
    capacity: number
    material: FlatMaterial
    origin: QuadsOrigin
  }>,
): Quads => {
  const { capacity, material, origin } = input
  const positions = new Float32Array(capacity * 12)
  const colors = new Float32Array(capacity * 16)
  const normals = new Float32Array(capacity * 12)
  const uvs = new Float32Array(capacity * 8)
  const indices = new Uint32Array(capacity * 6)
  for (let index = 0; index < capacity; index += 1) {
    normals.set([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], index * 12)
    const first = index * 4
    indices.set(
      [first, first + 1, first + 2, first, first + 2, first + 3],
      index * 6,
    )
  }
  const mesh = new Mesh3D({
    geometry: new Geometry3D({
      positions,
      normals,
      uvs,
      colors,
      indices,
      dynamic: true,
    }),
    material,
    position: origin,
    castShadow: false,
    receiveShadow: false,
  })
  return { mesh, positions, colors }
}

// NOTE: mutable on purpose: it owns the mesh, grown as a frame asks more
// quads of it than it holds, and remembers what it shows.
export class GroundRects {
  private readonly parent: Readonly<{
    addChild: (mesh: Mesh3D) => unknown
  }>
  private readonly lift: number
  private readonly origin: QuadsOrigin
  private readonly material = GroundRects.materialOf()
  private quads: Quads
  private shown: ReadonlyArray<Leaf> = []

  constructor(
    input: Readonly<{
      parent: Readonly<{ addChild: (mesh: Mesh3D) => unknown }>
      lift: number
      // NOTE: where the ground's picture stands, its plane's middle.
      under: QuadsOrigin
    }>,
  ) {
    this.parent = input.parent
    this.lift = input.lift
    // NOTE: see-through meshes draw back to front by how far their middles
    // stand from the lens, so the quads stand at the picture's middle,
    // nearer the lens by a hair: they always draw over the picture, as
    // the painter drew a body's shadow over the kitchen's light.
    this.origin = {
      x: input.under.x,
      y: input.under.y + ORDER_STEP,
      z: input.under.z,
    }
    this.quads = quadsOf({
      capacity: FIRST_CAPACITY,
      material: this.material,
      origin: this.origin,
    })
    this.quads.mesh.visible = false
    this.parent.addChild(this.quads.mesh)
  }

  private static materialOf(): FlatMaterial {
    const material = new FlatMaterial({
      vertexColors: true,
      doubleSided: true,
      alphaMode: 'blend',
    })
    // NOTE: the quads lie in one plane and are drawn in the ground's order,
    // so none may keep a later one out by its depth: a bullet's head hid
    // its trail, and of two shadows over each other only one drew.
    material.state.depthMask = false
    return material
  }

  draw(rects: ReadonlyArray<RectLeaf>): void {
    if (isSameLeaves(this.shown, rects)) {
      return
    }
    this.shown = rects
    const capacity = this.quads.positions.length / 12
    if (rects.length > capacity) {
      this.quads.mesh.destroy({ geometry: true })
      let grown = capacity
      while (grown < rects.length) {
        grown *= 2
      }
      this.quads = quadsOf({
        capacity: grown,
        material: this.material,
        origin: this.origin,
      })
      this.parent.addChild(this.quads.mesh)
    }
    writeGroundBoxes({
      boxes: Array.map(rects, groundBoxOf),
      lift: this.lift,
      origin: this.origin,
      out: this.quads,
    })
    const { geometry } = this.quads.mesh
    geometry.positions.set(this.quads.positions)
    geometry.attributes['aPosition']?.buffer.update()
    const color = geometry.attributes['aColor']
    if (color !== undefined) {
      color.buffer.data.set(this.quads.colors)
      color.buffer.update()
    }
    this.quads.mesh.visible = rects.length > 0
  }

  destroy(): void {
    this.quads.mesh.destroy({ geometry: true })
    this.material.destroy()
  }
}
