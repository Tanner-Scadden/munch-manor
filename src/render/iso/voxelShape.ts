// A sprite as voxels: each solid pixel of its art a little block, deepest
// down the middle of each row and thin at its edges, so a body is round. The
// front of every block lies on the sprite's own plane, where its billboard
// stood, so the art from the front is exactly the 2D art; the depth runs
// north along the floor, which the camera sees as each block's top, one
// screen pixel per pixel of depth. So a body shows its thickness as a lit
// band over every edge that faces up, and the light rounds it with its true
// faces, with no art redrawn.
//
// Plain data, no pixi: the geometry's arrays, and the matrix that stands a
// sprite's blocks at its foot.

import type { Affine } from './flatten'
import { CAMERA_UP, PITCH, TOWARD_CAMERA, UNIT, zOf } from './space'

// NOTE: one pixel of depth sinks this far toward the lens's back, in game
// pixels along the camera's view, while it rises one along its up: together
// one game pixel north along the floor.
const DEPTH_BACK = Math.cos(PITCH) / Math.sin(PITCH)

// NOTE: the deepest a sprite's blocks go, in pixels: a quarter of its
// narrower side, at least one and at most three, so a gun is a sliver and a
// body is chunky but never deeper than the wall it stands against allows.
const MOST_DEPTH = 3

export const maxDepthOf = ({
  width,
  height,
}: Readonly<{ width: number; height: number }>): number =>
  Math.max(1, Math.min(MOST_DEPTH, Math.floor(Math.min(width, height) / 4)))

// NOTE: the box of a sprite's solid pixels: a gun turned in its big square
// cell is only as thick as its own art.
const solidBoundsOf = ({
  width,
  height,
  isSolid,
}: Readonly<{
  width: number
  height: number
  isSolid: (column: number, row: number) => boolean
}>): Readonly<{ width: number; height: number }> => {
  let left = width
  let right = -1
  let top = height
  let bottom = -1
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      if (isSolid(column, row)) {
        left = Math.min(left, column)
        right = Math.max(right, column)
        top = Math.min(top, row)
        bottom = Math.max(bottom, row)
      }
    }
  }
  return {
    width: Math.max(0, right - left + 1),
    height: Math.max(0, bottom - top + 1),
  }
}

// NOTE: how far a pixel sits in from the nearer end of its run of solid
// pixels, along a row (`step` 1) or a column (`step` the width).
const inwardOf = (
  solid: Uint8Array,
  start: number,
  count: number,
  step: number,
  into: Uint8Array,
): void => {
  let runStart = 0
  for (let at = 0; at <= count; at += 1) {
    if (at < count && solid[start + at * step] === 1) {
      continue
    }
    for (let inside = runStart; inside < at; inside += 1) {
      const index = start + inside * step
      into[index] = Math.min(
        into[index] ?? 0,
        Math.min(inside - runStart, at - 1 - inside),
      )
    }
    runStart = at + 1
  }
}

// NOTE: each solid pixel's depth: one at the art's edge, then two more for
// each pixel in from the nearest edge, across or down, up to the most for
// the art's own size. So a body rounds and a thin gun or arm stays thin.
// Zero where the art is clear.
export const depthsOf = ({
  width,
  height,
  isSolid,
}: Readonly<{
  width: number
  height: number
  isSolid: (column: number, row: number) => boolean
}>): Uint8Array => {
  const most = maxDepthOf(solidBoundsOf({ width, height, isSolid }))
  const solid = new Uint8Array(width * height)
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      solid[row * width + column] = isSolid(column, row) ? 1 : 0
    }
  }
  const inward = new Uint8Array(width * height).fill(255)
  for (let row = 0; row < height; row += 1) {
    inwardOf(solid, row * width, width, 1, inward)
  }
  for (let column = 0; column < width; column += 1) {
    inwardOf(solid, column, height, width, inward)
  }
  const depths = new Uint8Array(width * height)
  for (let index = 0; index < depths.length; index += 1) {
    depths[index] =
      solid[index] === 1 ? Math.min(most, 1 + 2 * (inward[index] ?? 0)) : 0
  }
  return depths
}

export type VoxelMeshData = Readonly<{
  positions: Float32Array
  normals: Float32Array
  uvs: Float32Array
  indices: Uint32Array
}>

type Point = readonly [number, number, number]

// NOTE: a point of the blocks, from its column, its row (down), and its
// depth, in the geometry's own space: x across, y up (the depth lifts it),
// z toward the lens (the depth sinks it).
const pointOf = (x: number, y: number, d: number): Point => [
  x,
  d - y,
  -d * DEPTH_BACK,
]

const TOP_LENGTH = Math.hypot(DEPTH_BACK, 1)
const FRONT: Point = [0, 0, 1]
const BACK: Point = [0, 0, -1]
const TOP: Point = [0, DEPTH_BACK / TOP_LENGTH, 1 / TOP_LENGTH]
const BOTTOM: Point = [0, -DEPTH_BACK / TOP_LENGTH, -1 / TOP_LENGTH]
const LEFT: Point = [-1, 0, 0]
const RIGHT: Point = [1, 0, 0]

// NOTE: mutable on purpose: the arrays are filled once, as the geometry is
// built.
class Builder {
  readonly positions: Array<number> = []
  readonly normals: Array<number> = []
  readonly uvs: Array<number> = []
  readonly indices: Array<number> = []

  // NOTE: one face, its corners turned to wind counterclockwise seen from
  // its outside, as the renderer culls the rest.
  quad(
    corners: readonly [Point, Point, Point, Point],
    normal: Point,
    uv: readonly [number, number],
  ): void {
    const [p0, p1, p2] = corners
    const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]] as const
    const e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]] as const
    const facing =
      (e1[1] * e2[2] - e1[2] * e2[1]) * normal[0] +
      (e1[2] * e2[0] - e1[0] * e2[2]) * normal[1] +
      (e1[0] * e2[1] - e1[1] * e2[0]) * normal[2]
    const base = this.positions.length / 3
    for (const corner of corners) {
      this.positions.push(corner[0], corner[1], corner[2])
      this.normals.push(normal[0], normal[1], normal[2])
      this.uvs.push(uv[0], uv[1])
    }
    if (facing >= 0) {
      this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
    } else {
      this.indices.push(base, base + 2, base + 1, base, base + 3, base + 2)
    }
  }
}

// NOTE: the blocks of a sprite: a front face for every solid pixel, its back,
// and the sides, top, and bottom where its neighbor is shallower, each
// colored by the middle of its pixel (`uvOf`).
export const voxelMeshOf = ({
  width,
  height,
  isSolid,
  uvOf,
}: Readonly<{
  width: number
  height: number
  isSolid: (column: number, row: number) => boolean
  uvOf: (column: number, row: number) => readonly [number, number]
}>): VoxelMeshData => {
  const depths = depthsOf({ width, height, isSolid })
  const depthAt = (column: number, row: number): number =>
    column < 0 || row < 0 || column >= width || row >= height
      ? 0
      : (depths[row * width + column] ?? 0)
  const out = new Builder()
  // NOTE: every front face first, so a fading body, drawn blended with its
  // depth written (voxels.ts), hides the tops and sides behind its own front
  // rather than showing its insides through it.
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      if (depthAt(column, row) === 0) {
        continue
      }
      out.quad(
        [
          pointOf(column, row, 0),
          pointOf(column, row + 1, 0),
          pointOf(column + 1, row + 1, 0),
          pointOf(column + 1, row, 0),
        ],
        FRONT,
        uvOf(column, row),
      )
    }
  }
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const depth = depthAt(column, row)
      if (depth === 0) {
        continue
      }
      const uv = uvOf(column, row)
      const x0 = column
      const x1 = column + 1
      const y0 = row
      const y1 = row + 1
      out.quad(
        [
          pointOf(x0, y0, depth),
          pointOf(x1, y0, depth),
          pointOf(x1, y1, depth),
          pointOf(x0, y1, depth),
        ],
        BACK,
        uv,
      )
      const above = depthAt(column, row - 1)
      if (above < depth) {
        out.quad(
          [
            pointOf(x0, y0, above),
            pointOf(x1, y0, above),
            pointOf(x1, y0, depth),
            pointOf(x0, y0, depth),
          ],
          TOP,
          uv,
        )
      }
      const below = depthAt(column, row + 1)
      if (below < depth) {
        out.quad(
          [
            pointOf(x0, y1, below),
            pointOf(x1, y1, below),
            pointOf(x1, y1, depth),
            pointOf(x0, y1, depth),
          ],
          BOTTOM,
          uv,
        )
      }
      const left = depthAt(column - 1, row)
      if (left < depth) {
        out.quad(
          [
            pointOf(x0, y0, left),
            pointOf(x0, y1, left),
            pointOf(x0, y1, depth),
            pointOf(x0, y0, depth),
          ],
          LEFT,
          uv,
        )
      }
      const right = depthAt(column + 1, row)
      if (right < depth) {
        out.quad(
          [
            pointOf(x1, y0, right),
            pointOf(x1, y1, right),
            pointOf(x1, y1, depth),
            pointOf(x1, y0, depth),
          ],
          RIGHT,
          uv,
        )
      }
    }
  }
  return {
    positions: Float32Array.from(out.positions),
    normals: Float32Array.from(out.normals),
    uvs: Float32Array.from(out.uvs),
    indices: Uint32Array.from(out.indices),
  }
}

// NOTE: where a sprite's blocks stand: its box as the game draws it (the
// shape's own box under its groups' matrix), its texture's size in pixels,
// its foot, and how far it hovers and is nudged toward the lens.
export type SlabPlacement = Readonly<{
  matrix: Affine
  box: Readonly<{ x: number; y: number; width: number; height: number }>
  texels: Readonly<{ width: number; height: number }>
  footY: number
  hover: number
  nudge: number
  // NOTE: game pixels of depth for each pixel of the blocks' own: 1 for a
  // sprite, its width for a cube of color.
  depth: number
  // NOTE: a turn about the floor's upright through the sprite's middle, in
  // radians, so a power-up spins like a coin; 0 faces the lens.
  spin?: number
}>

// NOTE: the matrix (sixteen numbers, column by column) that stands the
// blocks where the billboard stood: across and down the sprite through the
// shapes' own matrix, so a lean, a turn, and a squash all show; and the
// depth straight toward the lens's back, whatever the sprite's turn, so the
// light sees true faces (the renderer's normals want its columns square to
// one another). `isFlipped` says the art is mirrored top to bottom by its
// matrix, so the blocks are built with their rows reversed and the matrix
// keeps a positive turn, or the renderer would cull their fronts.
export const slabMatrixOf = (
  placement: SlabPlacement,
): Readonly<{ elements: ReadonlyArray<number>; isFlipped: boolean }> => {
  const { matrix, box, texels, footY, hover, nudge, depth } = placement
  const spin = placement.spin ?? 0
  const across = box.width / texels.width
  const down = box.height / texels.height
  const ux = matrix.a * across
  const uy = matrix.b * across
  const vx = matrix.c * down
  const vy = matrix.d * down
  const isFlipped = ux * vy - uy * vx < 0
  const originX =
    matrix.a * box.x +
    matrix.c * (isFlipped ? box.y + box.height : box.y) +
    matrix.e
  const originY =
    matrix.b * box.x +
    matrix.d * (isFlipped ? box.y + box.height : box.y) +
    matrix.f
  const sign = isFlipped ? -1 : 1
  // NOTE: whole game pixels, as the billboards snap, unless the sprite is
  // turned, when its corner falls where its turn puts it.
  const isTurned = Math.abs(matrix.b) > 1e-6 || Math.abs(matrix.c) > 1e-6
  const x = isTurned ? originX : Math.round(originX)
  const y = isTurned ? originY : Math.round(originY)
  const foot = Math.round(footY)
  const rise = (foot - y + Math.round(hover)) * UNIT
  // NOTE: a step across the sprite in the world, and a step up it (the
  // geometry's y runs up, the sprite's rows down).
  const column = [ux * UNIT, -uy * UNIT * CAMERA_UP.y, -uy * UNIT * CAMERA_UP.z]
  const up = [
    -vx * sign * UNIT,
    vy * sign * UNIT * CAMERA_UP.y,
    vy * sign * UNIT * CAMERA_UP.z,
  ]
  const toward = [
    TOWARD_CAMERA.x * UNIT * depth,
    TOWARD_CAMERA.y * UNIT * depth,
    TOWARD_CAMERA.z * UNIT * depth,
  ]
  const translation = [
    x * UNIT + CAMERA_UP.x * rise + TOWARD_CAMERA.x * nudge,
    CAMERA_UP.y * rise + TOWARD_CAMERA.y * nudge,
    zOf(foot) + CAMERA_UP.z * rise + TOWARD_CAMERA.z * nudge,
  ]
  if (spin !== 0) {
    // NOTE: the whole map turned about the sprite's own upright (the lens's
    // up) through its middle column, so it turns like a coin held up to the
    // lens with no lean, and its columns stay square to one another.
    const cos = Math.cos(spin)
    const sin = Math.sin(spin)
    const axis = [CAMERA_UP.x, CAMERA_UP.y, CAMERA_UP.z]
    const turn = (vector: Array<number>): void => {
      const [px = 0, py = 0, pz = 0] = vector
      const [kx = 0, ky = 0, kz = 0] = axis
      const along = (kx * px + ky * py + kz * pz) * (1 - cos)
      vector[0] = px * cos + (ky * pz - kz * py) * sin + kx * along
      vector[1] = py * cos + (kz * px - kx * pz) * sin + ky * along
      vector[2] = pz * cos + (kx * py - ky * px) * sin + kz * along
    }
    const half = texels.width / 2
    const pivot = [
      (translation[0] ?? 0) + (column[0] ?? 0) * half,
      (translation[1] ?? 0) + (column[1] ?? 0) * half,
      (translation[2] ?? 0) + (column[2] ?? 0) * half,
    ]
    const offset = [
      (translation[0] ?? 0) - (pivot[0] ?? 0),
      (translation[1] ?? 0) - (pivot[1] ?? 0),
      (translation[2] ?? 0) - (pivot[2] ?? 0),
    ]
    turn(column)
    turn(up)
    turn(toward)
    turn(offset)
    translation[0] = (pivot[0] ?? 0) + (offset[0] ?? 0)
    translation[1] = (pivot[1] ?? 0) + (offset[1] ?? 0)
    translation[2] = (pivot[2] ?? 0) + (offset[2] ?? 0)
  }
  return {
    isFlipped,
    elements: [
      column[0] ?? 0,
      column[1] ?? 0,
      column[2] ?? 0,
      0,
      up[0] ?? 0,
      up[1] ?? 0,
      up[2] ?? 0,
      0,
      toward[0] ?? 0,
      toward[1] ?? 0,
      toward[2] ?? 0,
      0,
      translation[0] ?? 0,
      translation[1] ?? 0,
      translation[2] ?? 0,
      1,
    ],
  }
}
