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

import { Match } from 'effect'

import type { Affine } from './flatten'
import { CAMERA_UP, PITCH, TOWARD_CAMERA, UNIT, zOf } from './space'

// NOTE: one pixel of depth sinks this far toward the lens's back, in game
// pixels along the camera's view, while it rises one along its up: together
// one game pixel north along the floor.
export const DEPTH_BACK = Math.cos(PITCH) / Math.sin(PITCH)

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
// cell is only as thick as its own art. `top` and `bottom` are its highest
// and lowest solid rows (`bottom` -1 for clear art).
export const solidBoundsOf = ({
  width,
  height,
  isSolid,
}: Readonly<{
  width: number
  height: number
  isSolid: (column: number, row: number) => boolean
}>): Readonly<{
  width: number
  height: number
  top: number
  bottom: number
}> => {
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
    top,
    bottom,
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

// NOTE: whether a solid pixel lies on the art's edge: a clear pixel or the
// cell's border beside it or on a corner.
const isEdgePixel = (
  input: Readonly<{
    width: number
    height: number
    isSolid: (column: number, row: number) => boolean
  }>,
  column: number,
  row: number,
): boolean => {
  const { width, height, isSolid } = input
  for (let down = -1; down <= 1; down += 1) {
    for (let across = -1; across <= 1; across += 1) {
      const x = column + across
      const y = row + down
      if (x < 0 || y < 0 || x >= width || y >= height || !isSolid(x, y)) {
        return true
      }
    }
  }
  return false
}

// NOTE: the art's drawn outline: dark pixels on its edge that touch no dark
// pixel inside it across or down, so a one pixel line of ink over a lighter
// fill is outline, and the edge of a dark mass (hair, a coat) is not.
const outlineOf = (
  input: Readonly<{
    width: number
    height: number
    isSolid: (column: number, row: number) => boolean
    isDark: (column: number, row: number) => boolean
  }>,
): Uint8Array => {
  const { width, height, isSolid, isDark } = input
  const edge = new Uint8Array(width * height)
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      edge[row * width + column] =
        isSolid(column, row) && isEdgePixel(input, column, row) ? 1 : 0
    }
  }
  const isDarkInside = (column: number, row: number): boolean =>
    column >= 0 &&
    row >= 0 &&
    column < width &&
    row < height &&
    edge[row * width + column] === 0 &&
    isSolid(column, row) &&
    isDark(column, row)
  const outline = new Uint8Array(width * height)
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      outline[row * width + column] =
        edge[row * width + column] === 1 &&
        isDark(column, row) &&
        !isDarkInside(column - 1, row) &&
        !isDarkInside(column + 1, row) &&
        !isDarkInside(column, row - 1) &&
        !isDarkInside(column, row + 1)
          ? 1
          : 0
    }
  }
  return outline
}

// NOTE: whose color each pixel's sides wear, by index: its own, but for a
// pixel of the drawn outline (`outlineOf`), the nearest solid pixel inside it (by steps
// across and down through the art), so the outline stays on the front face
// alone and the sides show no dark rim. The scene's outline pass inks the
// body's silhouette. An outline with nothing inside it keeps its own color.
export const sideSourcesOf = (
  input: Readonly<{
    width: number
    height: number
    isSolid: (column: number, row: number) => boolean
    isDark: (column: number, row: number) => boolean
  }>,
): Int32Array => {
  const { width, height, isSolid } = input
  const sources = new Int32Array(width * height).fill(-1)
  const outline = outlineOf(input)
  const queue: Array<number> = []
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const index = row * width + column
      if (isSolid(column, row) && outline[index] === 0) {
        sources[index] = index
        queue.push(index)
      }
    }
  }
  for (let head = 0; head < queue.length; head += 1) {
    const index = queue[head] ?? 0
    const column = index % width
    const row = (index - column) / width
    const source = sources[index] ?? index
    const neighbors = [
      column > 0 ? index - 1 : -1,
      column < width - 1 ? index + 1 : -1,
      row > 0 ? index - width : -1,
      row < height - 1 ? index + width : -1,
    ]
    for (const next of neighbors) {
      if (next >= 0 && outline[next] === 1 && sources[next] === -1) {
        sources[next] = source
        queue.push(next)
      }
    }
  }
  for (let index = 0; index < sources.length; index += 1) {
    if (sources[index] === -1) {
      sources[index] = index
    }
  }
  return sources
}

// NOTE: the side faces darken toward the floor, as light reaches less of a
// body's foot: this share of their color at the foot, back to their own
// color this many pixels up. A share of linear light, as the renderer's
// vertex colors are.
const FOOT_SHADE = 0.5
const SHADE_RISE = 6

// NOTE: how much of its own color a side face shows at a height over the
// foot, in pixels, to the middle of its pixel.
export const sideShadeOf = (height: number): number =>
  FOOT_SHADE + (1 - FOOT_SHADE) * Math.min(1, Math.max(0, height / SHADE_RISE))

// NOTE: where a sprite's foot lies in its blocks' rows: past its last solid
// row, before its first, or nowhere (it is not on the floor).
export type Ground = 'Below' | 'Above' | 'None'

export type VoxelMeshData = Readonly<{
  positions: Float32Array
  normals: Float32Array
  uvs: Float32Array
  // NOTE: each corner's color the material multiplies by, RGBA: white on
  // the front faces, darker toward the foot on the sides.
  colors: Float32Array
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
  readonly colors: Array<number> = []
  readonly indices: Array<number> = []

  // NOTE: one face, its corners turned to wind counterclockwise seen from
  // its outside, as the renderer culls the rest.
  quad(
    corners: readonly [Point, Point, Point, Point],
    normal: Point,
    uv: readonly [number, number],
    shade = 1,
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
      this.colors.push(shade, shade, shade, 1)
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
// colored by the middle of its pixel (`uvOf`). The front wears the pixel's
// own color; the rest wear the color inside a dark outline pixel (`isDark`,
// `sideSourcesOf`), and on a body standing on the floor darken toward the
// solid row at its foot: its last row (`ground` Below), or its first where
// its rows are reversed and run up from the foot (Above).
export const voxelMeshOf = ({
  width,
  height,
  isSolid,
  uvOf,
  isDark = () => false,
  ground = 'None',
}: Readonly<{
  width: number
  height: number
  isSolid: (column: number, row: number) => boolean
  uvOf: (column: number, row: number) => readonly [number, number]
  isDark?: (column: number, row: number) => boolean
  ground?: Ground
}>): VoxelMeshData => {
  const depths = depthsOf({ width, height, isSolid })
  const sources = sideSourcesOf({ width, height, isSolid, isDark })
  const { top, bottom } = solidBoundsOf({ width, height, isSolid })
  const sideUvOf = (column: number, row: number): readonly [number, number] => {
    const source = sources[row * width + column] ?? row * width + column
    const sourceColumn = source % width
    return uvOf(sourceColumn, (source - sourceColumn) / width)
  }
  const shadeOf = (row: number): number =>
    Match.value(ground).pipe(
      Match.when('Below', () => sideShadeOf(bottom - row + 0.5)),
      Match.when('Above', () => sideShadeOf(row - top + 0.5)),
      Match.orElse(() => 1),
    )
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
      const uv = sideUvOf(column, row)
      const shade = shadeOf(row)
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
        shade,
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
          shade,
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
          shade,
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
          shade,
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
          shade,
        )
      }
    }
  }
  return {
    positions: Float32Array.from(out.positions),
    normals: Float32Array.from(out.normals),
    uvs: Float32Array.from(out.uvs),
    colors: Float32Array.from(out.colors),
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

// NOTE: a coin turn shows only in steps of a sixteenth of a turn (22.5
// degrees), so a spinning body jumps from one crisp pose to the next and
// never shows the pixels of an angle in between, as a sprite stack turns.
const SPIN_STEP = Math.PI / 8

export const snappedSpinOf = (spin: number): number => {
  const steps = Math.round(spin / SPIN_STEP) % 16
  return steps === 0 ? 0 : steps * SPIN_STEP
}

// NOTE: how far a body's lowest solid row may sit off its foot, in game
// pixels, and still stand on the floor: a walk's bob and a squash.
const GROUND_SLACK = 3

// NOTE: the most a body may lean and still stand on its foot, as the slope
// of its upright (across over down): a Runner's lean and a waddle, short of
// a fall.
const MOST_LEAN = 0.6

// NOTE: whether a sprite's art stands on the floor, the middle of its
// lowest solid row (`solidBottom`, in its own rows) at its foot and the art
// upright or leaning a little, so its sides may darken toward the floor. A
// gun in a hand, a body held aloft, thrown, or fallen over, and a sprite
// mirrored top to bottom do not.
export const isGroundedOf = (
  input: Readonly<{
    matrix: Affine
    box: Readonly<{ x: number; y: number; width: number; height: number }>
    texels: Readonly<{ height: number }>
    footY: number
    solidBottom: number
  }>,
): boolean => {
  const { matrix, box, texels, footY, solidBottom } = input
  if (matrix.d <= 0 || Math.abs(matrix.c) > matrix.d * MOST_LEAN) {
    return false
  }
  if (solidBottom < 0) {
    return false
  }
  const down = box.height / texels.height
  const lowest =
    matrix.b * (box.x + box.width / 2) +
    matrix.d * (box.y + (solidBottom + 1) * down) +
    matrix.f
  return Math.abs(lowest - footY) <= GROUND_SLACK
}

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
  const spin = snappedSpinOf(placement.spin ?? 0)
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
    // NOTE: the upright on a whole pixel's edge, so every pose turns about
    // the same game pixel line.
    const half = Math.round(texels.width / 2)
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
