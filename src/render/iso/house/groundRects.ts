import { Array } from 'effect'

import { FlatMaterial, Geometry3D, Mesh3D, srgbToLinear } from '@pixi/3d'

import type * as Draw from '#render/draw.ts'
import { type Leaf, isSameLeaves } from '#render/iso/flatten.ts'
import { UNIT, zOf } from '#render/iso/space.ts'
import { colorOf } from '#render/iso/textures.ts'

type RectLeaf = Leaf & Readonly<{ shape: Draw.Rect }>

const isRectLeaf = (leaf: Leaf): leaf is RectLeaf =>
  leaf.shape._tag === 'Rect' &&
  leaf.shape.fill !== undefined &&
  leaf.shape.stroke === undefined &&
  leaf.matrix.b === 0 &&
  leaf.matrix.c === 0

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

export const groundBoxOf = ({ shape, matrix, alpha }: RectLeaf): GroundBox => {
  const left = matrix.a * shape.x + matrix.e
  const right = matrix.a * (shape.x + shape.width) + matrix.e
  const top = matrix.d * shape.y + matrix.f
  const bottom = matrix.d * (shape.y + shape.height) + matrix.f
  const { color, alpha: fillAlpha } = colorOf(shape.fill ?? '')
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

type QuadArrays = Readonly<{ positions: Float32Array; colors: Float32Array }>

export type QuadsOrigin = Readonly<{ x: number; y: number; z: number }>

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
      under: QuadsOrigin
    }>,
  ) {
    this.parent = input.parent
    this.lift = input.lift
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
