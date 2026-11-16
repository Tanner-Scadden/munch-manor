// A sprite as voxels: each solid pixel of its art a stack of little blocks,
// carved round by `formOf` (src/art/carve.ts): a torso as deep as it is
// wide, a limb thin. Each block one deeper sits one row lower, so a stack
// runs back along the lens's ray and the art from the lens is exactly the
// 2D art, its edges' tops folded in so it stands as tall as its art. The
// light rounds it with its true faces, and a turn or a shadow shows its
// volume, with no art redrawn.
//
// Plain data, no pixi: the geometry's arrays, and the matrix that stands a
// sprite's blocks at its foot.

import { type SpriteForm, formOf } from '../../art/carve'
import type { Affine } from './flatten'
import {
  CAMERA_UP,
  PITCH,
  SOUTH_NORMAL,
  TOWARD_CAMERA,
  UNIT,
  UP_NORMAL,
  standingPointOf,
} from './space'

// NOTE: one pixel of depth sinks this far toward the lens's back, in game
// pixels along the camera's view, while it rises one along its up: together
// one game pixel north along the floor.
export const DEPTH_BACK = Math.cos(PITCH) / Math.sin(PITCH)

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
// alone and the sides show no dark rim. An outline with nothing inside it
// keeps its own color.
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

// NOTE: a sprite's carved form (`formOf`, src/art/carve.ts) set for the
// lens, per pixel:
// - near and back: the depths its stack of blocks runs over, `back` past
//   its last. Each block one deeper sits one row lower too, along the lens's
//   ray, so the stack shows from the lens as exactly its one pixel.
// - folded: a pixel with nothing over it and a solid pixel under it stands
//   as the tops of the stack under it, in its own color, rather than as
//   blocks with a row of tops over them, so the body is as tall as its art.
// - plate: a pixel with nothing over it and nothing under it (a toe, a gun's
//   barrel) has no stack to fold into, and a block of it would show its
//   front and a row of top over it, two rows for its one. So it stands as a
//   plate: one block's floor, facing up, which the lens sees as exactly its
//   pixel.
// Down each column a stack never starts nearer the lens than the one over
// it, or its top would show in front of that pixel in the wrong color.
// `lift` is how many blocks the whole form moves toward the lens, along the
// ray, so its lowest block stands on the floor at the art's foot.
export type LensForm = Readonly<{
  width: number
  height: number
  depth: number
  near: Uint8Array
  back: Uint8Array
  folded: Uint8Array
  plate: Uint8Array
  lift: number
}>

// NOTE: how many blocks deep a pixel stands, set by hand for a sprite that
// reads wrong round (a fridge is a box, src/art/sprite.ts `deepSprite`):
// its stack starts at the sprite's own plane, flush, and runs that many
// back. Undefined, or 0, keeps the round default.
export type DepthOf = (column: number, row: number) => number | undefined

const handFormOf = (form: SpriteForm, depthOf: DepthOf): SpriteForm => {
  const near = new Uint8Array(form.near)
  const thick = new Uint8Array(form.thick)
  let depth = form.depth
  for (let row = 0; row < form.height; row += 1) {
    for (let column = 0; column < form.width; column += 1) {
      const index = row * form.width + column
      const blocks = depthOf(column, row) ?? 0
      if ((thick[index] ?? 0) > 0 && blocks > 0) {
        near[index] = 0
        thick[index] = blocks
        depth = Math.max(depth, blocks)
      }
    }
  }
  return { ...form, depth, near, thick }
}

export const lensFormOf = ({
  width,
  height,
  isSolid,
  most,
  depthOf,
}: Readonly<{
  width: number
  height: number
  isSolid: (column: number, row: number) => boolean
  most?: number
  depthOf?: DepthOf
}>): LensForm => {
  const round = formOf({
    width,
    height,
    isSolid,
    ...(most === undefined ? {} : { most }),
  })
  const form = depthOf === undefined ? round : handFormOf(round, depthOf)
  const count = width * height
  const near = new Uint8Array(count)
  const back = new Uint8Array(count)
  const folded = new Uint8Array(count)
  const plate = new Uint8Array(count)
  const isSolidAt = (column: number, row: number): boolean =>
    row >= 0 && row < height && (form.thick[row * width + column] ?? 0) > 0
  let shallowest = 255
  for (let column = 0; column < width; column += 1) {
    let over = -1
    for (let row = 0; row < height; row += 1) {
      const index = row * width + column
      if (!isSolidAt(column, row)) {
        over = -1
        continue
      }
      const isTop = !isSolidAt(column, row - 1)
      const isBottom = !isSolidAt(column, row + 1)
      if (isTop && !isBottom) {
        folded[index] = 1
        continue
      }
      const ownNear = form.near[index] ?? 0
      const ownBack = ownNear + (form.thick[index] ?? 1)
      const start = Math.max(ownNear, over)
      near[index] = start
      // NOTE: a plate is one block's floor, so one deep.
      plate[index] = isTop && isBottom ? 1 : 0
      back[index] = isTop && isBottom ? start + 1 : Math.max(start + 1, ownBack)
      over = start
      shallowest = Math.min(shallowest, start)
    }
  }
  // NOTE: the nearest stack starts at depth 0, the sprite's own plane.
  const shift = shallowest === 255 ? 0 : shallowest
  let lowest = -1
  let bottom = -1
  for (let index = 0; index < count; index += 1) {
    if ((back[index] ?? 0) > 0) {
      near[index] = (near[index] ?? 0) - shift
      back[index] = (back[index] ?? 0) - shift
      const row = Math.floor(index / width)
      lowest = Math.max(lowest, row + (back[index] ?? 0))
      bottom = Math.max(bottom, row)
    }
  }
  let depth = 1
  for (let index = 0; index < count; index += 1) {
    depth = Math.max(depth, back[index] ?? 0)
  }
  return {
    width,
    height,
    depth,
    near,
    back,
    folded,
    plate,
    lift: Math.max(0, lowest - (bottom + 1)),
  }
}

export type VoxelMeshData = Readonly<{
  positions: Float32Array
  normals: Float32Array
  uvs: Float32Array
  // NOTE: each corner's color the material multiplies by, RGBA: white on
  // the front faces, darker toward the foot on the sides.
  colors: Float32Array
  indices: Uint32Array
}>

// NOTE: what a carve casts its shadow through: its blocks' outer faces,
// each flat run of them merged into one quad, with no color, since the
// shadow pass draws depth alone.
export type CasterMeshData = Readonly<{
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array
}>

type Point = readonly [number, number, number]

// NOTE: a point of the blocks, from its column, its row (down), and its
// depth, in the geometry's own space: x across, y up (the depth lifts it),
// z toward the lens (the depth sinks it). A step of depth alone runs north
// along the floor; a block of a pixel's stack one deeper is also one row
// lower (`lensFormOf`), so together they run back along the lens's ray.
const pointOf = (x: number, y: number, d: number): Point => [
  x,
  d - y,
  -d * DEPTH_BACK,
]

// NOTE: how far a piece standing upright (`isUpright`) leans back, in
// radians from straight up: until the top of its front stands over the back
// of its own blocks, `most` game pixels north of its foot, and never past
// the lens's own lean. A front straight up is nearer the lens at its top
// than at its foot, so the lens's slight perspective drew it wider at the
// top, a cabinet tipping over; leaning back puts the top as far off as the
// piece's own tiles allow, and a tall, deep cabinet stands nearly square to
// the lens. Its top stays over its own tiles, so it reads as standing there
// against its wall, never as lying back over the floor behind.
export const uprightLeanOf = (
  input: Readonly<{ rows: number; most: number }>,
): number =>
  Math.min(
    PITCH,
    Math.atan2(
      input.most * Math.cos(PITCH),
      Math.max(0, input.rows - input.most) * Math.sin(PITCH),
    ),
  )

// NOTE: the points of the blocks of a piece standing upright, leaning back
// (`uprightLeanOf`), in game pixels: x across, y up, z south. A grid row of
// its art runs up its front, 1 / cos(PITCH - lean) long, so its front shows
// the lens the art's own rows, and a step of depth runs one game pixel
// north along the floor. A block one deeper still sits one row lower, so
// each stack runs back along the lens's ray as a leaning body's does.
const UPRIGHT_DEPTH = 1 / Math.sin(PITCH)

const uprightPointsOf = (lean: number): PointAt => {
  const row = 1 / Math.cos(PITCH - lean)
  const up = Math.cos(lean) * row
  const back = Math.sin(lean) * row
  return (x, y, d) => [x, -y * up, y * back - d * UPRIGHT_DEPTH]
}

type PointAt = (x: number, y: number, d: number) => Point

export const STRAIGHT_DOWN: Point = [0, -1, 0]

const TOP_LENGTH = Math.hypot(DEPTH_BACK, 1)
const FRONT: Point = SOUTH_NORMAL
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

// NOTE: one face of a block: the neighbor whose block hides it, and its
// corners as offsets in the grid (column, grid row, depth).
type FaceSpec = Readonly<{
  normal: Point
  // NOTE: the face's normal for a piece standing upright (`isUpright`),
  // leaning back this far (`uprightLeanOf`).
  uprightNormalOf: (lean: number) => Point
  neighbor: readonly [number, number, number]
  corners: readonly [Point, Point, Point, Point]
}>

const TOP_FACE: FaceSpec = {
  normal: TOP,
  uprightNormalOf: () => UP_NORMAL,
  neighbor: [0, -1, 0],
  corners: [
    [0, 0, 0],
    [1, 0, 0],
    [1, 0, 1],
    [0, 0, 1],
  ],
}

const SIDE_FACES: ReadonlyArray<FaceSpec> = [
  {
    normal: BACK,
    uprightNormalOf: lean => [0, -Math.sin(lean), -Math.cos(lean)],
    neighbor: [0, 0, 1],
    corners: [
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
    ],
  },
  TOP_FACE,
  {
    normal: BOTTOM,
    uprightNormalOf: () => STRAIGHT_DOWN,
    neighbor: [0, 1, 0],
    corners: [
      [0, 1, 0],
      [1, 1, 0],
      [1, 1, 1],
      [0, 1, 1],
    ],
  },
  {
    normal: LEFT,
    uprightNormalOf: () => LEFT,
    neighbor: [-1, 0, 0],
    corners: [
      [0, 0, 0],
      [0, 1, 0],
      [0, 1, 1],
      [0, 0, 1],
    ],
  },
  {
    normal: RIGHT,
    uprightNormalOf: () => RIGHT,
    neighbor: [1, 0, 0],
    corners: [
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1],
      [1, 0, 1],
    ],
  },
]

const FRONT_FACE: FaceSpec = {
  normal: FRONT,
  uprightNormalOf: lean => [0, Math.sin(lean), Math.cos(lean)],
  neighbor: [0, 0, -1],
  corners: [
    [0, 0, 0],
    [0, 1, 0],
    [1, 1, 0],
    [1, 0, 0],
  ],
}

const ALL_FACES: ReadonlyArray<FaceSpec> = [FRONT_FACE, ...SIDE_FACES]

// NOTE: the blocks of a sprite's carve (`lensFormOf`): a face for every side
// of a block that meets no other, each colored by the middle of a pixel
// (`uvOf`). A front wears its own pixel's color, and a folded pixel's color
// lies on the tops under it; every other face wears the color inside a dark
// outline pixel (`isDark`, `sideSourcesOf`), so the outline shows on the
// front alone, and on a body standing on the floor (`isGrounded`) darkens
// toward it. The front faces of the pixels that glow of themselves
// (`isGlow`, a zombie's eyes) go apart, into `glow`, for a glowing material
// on those few faces alone.
export const voxelMeshOf = ({
  width,
  height,
  isSolid,
  uvOf,
  isDark = () => false,
  isGrounded = false,
  most,
  depthOf,
  isGlow,
  isUpright = false,
}: Readonly<{
  width: number
  height: number
  isSolid: (column: number, row: number) => boolean
  uvOf: (column: number, row: number) => readonly [number, number]
  isDark?: (column: number, row: number) => boolean
  isGrounded?: boolean
  most?: number
  depthOf?: DepthOf
  isGlow?: (column: number, row: number) => boolean
  // NOTE: built to stand upright (`uprightMatrixOf`), not leaned square to
  // the pitch.
  isUpright?: boolean
}>): VoxelMeshData &
  Readonly<{
    lift: number
    // NOTE: how far a piece standing upright leans back (`uprightLeanOf`),
    // which its matrix stands it at too; 0 for the rest.
    lean: number
    caster: CasterMeshData
    glow: VoxelMeshData | undefined
  }> => {
  const form = lensFormOf({
    width,
    height,
    isSolid,
    ...(most === undefined ? {} : { most }),
    ...(depthOf === undefined ? {} : { depthOf }),
  })
  const { depth } = form
  const sources = sideSourcesOf({ width, height, isSolid, isDark })
  // NOTE: the grid: a block of pixel (column, row) at depth d sits on grid
  // row row + d.
  const rows = height + depth
  const filled = new Uint8Array(width * rows * depth)
  const cellOf = (column: number, gridRow: number, d: number): number =>
    column + width * (gridRow + rows * d)
  let floor = 0
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const index = row * width + column
      if (form.plate[index] === 1) {
        floor = Math.max(floor, row + (form.near[index] ?? 0) + 1)
        continue
      }
      for (let d = form.near[index] ?? 0; d < (form.back[index] ?? 0); d += 1) {
        filled[cellOf(column, row + d, d)] = 1
        floor = Math.max(floor, row + d + 1)
      }
    }
  }
  const isFilled = (column: number, gridRow: number, d: number): boolean =>
    column >= 0 &&
    column < width &&
    gridRow >= 0 &&
    gridRow < rows &&
    d >= 0 &&
    d < depth &&
    filled[cellOf(column, gridRow, d)] === 1
  const sideUvOf = (column: number, row: number): readonly [number, number] => {
    const source = sources[row * width + column] ?? row * width + column
    const sourceColumn = source % width
    return uvOf(sourceColumn, (source - sourceColumn) / width)
  }
  const isFoldedAt = (column: number, row: number): boolean =>
    row >= 0 && form.folded[row * width + column] === 1
  const shadeOf = (gridRow: number): number =>
    isGrounded ? sideShadeOf(floor - gridRow - 0.5) : 1
  const lean = isUpright ? uprightLeanOf({ rows: height, most: depth }) : 0
  const pointAt: PointAt = isUpright ? uprightPointsOf(lean) : pointOf
  const normalOf = (spec: FaceSpec): Point =>
    isUpright ? spec.uprightNormalOf(lean) : spec.normal
  const out = new Builder()
  const glowOut = new Builder()
  const faceOf = (
    spec: FaceSpec,
    at: readonly [number, number, number],
    uv: readonly [number, number],
    shade: number,
    into: Builder = out,
  ): void => {
    const [column, gridRow, d] = at
    const [c0, c1, c2, c3] = spec.corners
    const corner = ([x, y, z]: Point): Point =>
      pointAt(column + x, gridRow + y, d + z)
    into.quad(
      [corner(c0), corner(c1), corner(c2), corner(c3)],
      normalOf(spec),
      uv,
      shade,
    )
  }
  const isOpen = (
    spec: FaceSpec,
    column: number,
    gridRow: number,
    d: number,
  ): boolean => {
    const [dx, dy, dz] = spec.neighbor
    return !isFilled(column + dx, gridRow + dy, d + dz)
  }
  // NOTE: every front face first, so a fading body, drawn blended with its
  // depth written (voxels.ts), hides the tops and sides behind its own front
  // rather than showing its insides through it.
  for (let d = 0; d < depth; d += 1) {
    for (let gridRow = d; gridRow < d + height; gridRow += 1) {
      for (let column = 0; column < width; column += 1) {
        if (
          isFilled(column, gridRow, d) &&
          isOpen(FRONT_FACE, column, gridRow, d)
        ) {
          const row = gridRow - d
          faceOf(
            FRONT_FACE,
            [column, gridRow, d],
            uvOf(column, row),
            1,
            isGlow?.(column, row) === true ? glowOut : out,
          )
        }
      }
    }
  }
  // NOTE: a plate (`lensFormOf`) is the top of the block under its own
  // place, which the lens sees on exactly its pixel's row: its front's
  // color, unshaded.
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const index = row * width + column
      if (form.plate[index] === 1) {
        const d = form.near[index] ?? 0
        faceOf(TOP_FACE, [column, row + d + 1, d], uvOf(column, row), 1)
      }
    }
  }
  for (let d = 0; d < depth; d += 1) {
    for (let gridRow = d; gridRow < d + height; gridRow += 1) {
      for (let column = 0; column < width; column += 1) {
        if (!isFilled(column, gridRow, d)) {
          continue
        }
        const row = gridRow - d
        const shade = shadeOf(gridRow)
        for (const spec of SIDE_FACES) {
          if (!isOpen(spec, column, gridRow, d)) {
            continue
          }
          // NOTE: a folded pixel's tops stand for its front: its own
          // color, unshaded, as the art draws it.
          const isFoldTop = spec.normal === TOP && isFoldedAt(column, row - 1)
          // NOTE: a side of a piece standing upright wears the front's
          // color at its own height, so it shows level rows running back
          // to the wall, not the art's rows slanting down the lens's ray.
          const isUprightSide =
            isUpright &&
            spec.neighbor[0] !== 0 &&
            gridRow < height &&
            isSolid(column, gridRow)
          faceOf(
            spec,
            [column, gridRow, d],
            isFoldTop
              ? uvOf(column, row - 1)
              : sideUvOf(column, isUprightSide ? gridRow : row),
            isFoldTop ? 1 : shade,
          )
        }
      }
    }
  }
  return {
    ...meshDataOf(out),
    lift: form.lift,
    lean,
    caster: casterOf({
      size: [width, rows, depth],
      isFilled,
      pointAt,
      normalOf,
    }),
    glow: glowOut.indices.length === 0 ? undefined : meshDataOf(glowOut),
  }
}

// NOTE: the outer faces of a grid of blocks merged greedily: in each slice
// across a face's normal, the open faces are taken as the widest runs, then
// as many rows of that run as match, each run one quad. A body of hundreds
// of faces casts through a few dozen, so a crowd's shadows stay cheap.
const casterOf = (
  input: Readonly<{
    size: readonly [number, number, number]
    isFilled: (column: number, gridRow: number, d: number) => boolean
    pointAt: PointAt
    normalOf: (spec: FaceSpec) => Point
  }>,
): CasterMeshData => {
  const { size, isFilled, pointAt, normalOf } = input
  const out = new Builder()
  for (const spec of ALL_FACES) {
    const axis = spec.neighbor[0] !== 0 ? 0 : spec.neighbor[1] !== 0 ? 1 : 2
    const across = (axis + 1) % 3
    const down = (axis + 2) % 3
    const spanAcross = size[across] ?? 0
    const spanDown = size[down] ?? 0
    const cellAt = (
      slice: number,
      a: number,
      b: number,
    ): [number, number, number] => {
      const cell: [number, number, number] = [0, 0, 0]
      cell[axis] = slice
      cell[across] = a
      cell[down] = b
      return cell
    }
    const isOpenAt = (slice: number, a: number, b: number): boolean => {
      const [column, gridRow, d] = cellAt(slice, a, b)
      const [dx, dy, dz] = spec.neighbor
      return (
        isFilled(column, gridRow, d) &&
        !isFilled(column + dx, gridRow + dy, d + dz)
      )
    }
    for (let slice = 0; slice < size[axis]; slice += 1) {
      const taken = new Uint8Array(spanAcross * spanDown)
      const isFree = (a: number, b: number): boolean =>
        taken[a + spanAcross * b] === 0 && isOpenAt(slice, a, b)
      for (let b = 0; b < spanDown; b += 1) {
        for (let a = 0; a < spanAcross; a += 1) {
          if (!isFree(a, b)) {
            continue
          }
          let wide = 1
          while (a + wide < spanAcross && isFree(a + wide, b)) {
            wide += 1
          }
          let tall = 1
          const isRowFree = (row: number): boolean => {
            for (let at = a; at < a + wide; at += 1) {
              if (!isFree(at, row)) {
                return false
              }
            }
            return true
          }
          while (b + tall < spanDown && isRowFree(b + tall)) {
            tall += 1
          }
          for (let row = b; row < b + tall; row += 1) {
            taken.fill(1, a + spanAcross * row, a + wide + spanAcross * row)
          }
          const origin = cellAt(slice, a, b)
          const corner = (offset: Point): Point => {
            const at: [number, number, number] = [
              origin[0] + offset[0],
              origin[1] + offset[1],
              origin[2] + offset[2],
            ]
            at[across] = (origin[across] ?? 0) + (offset[across] ?? 0) * wide
            at[down] = (origin[down] ?? 0) + (offset[down] ?? 0) * tall
            return pointAt(at[0], at[1], at[2])
          }
          const [c0, c1, c2, c3] = spec.corners
          out.quad(
            [corner(c0), corner(c1), corner(c2), corner(c3)],
            normalOf(spec),
            [0, 0],
          )
        }
      }
    }
  }
  return {
    positions: Float32Array.from(out.positions),
    normals: Float32Array.from(out.normals),
    indices: Uint32Array.from(out.indices),
  }
}

const meshDataOf = (built: Builder): VoxelMeshData => ({
  positions: Float32Array.from(built.positions),
  normals: Float32Array.from(built.normals),
  uvs: Float32Array.from(built.uvs),
  colors: Float32Array.from(built.colors),
  indices: Uint32Array.from(built.indices),
})

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
// one another). `isFlipped` says the art is mirrored by its matrix (a body
// facing west), so the blocks are built with their columns reversed and the
// matrix keeps a positive turn, or the renderer would cull their fronts.
// NOTE: whether a sprite's matrix mirrors its art (a body facing west), as
// `slabMatrixOf` stands it.
export const isFlippedOf = (
  input: Readonly<{
    matrix: Affine
    box: Readonly<{ width: number; height: number }>
  }>,
): boolean => {
  const { matrix, box } = input
  return (
    (matrix.a * matrix.d - matrix.b * matrix.c) * box.width * box.height < 0
  )
}

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
  const isFlipped = isFlippedOf(placement)
  // NOTE: a mirrored sprite's blocks are built with their columns reversed
  // and stand from its other side, so its rows still run down and its depth
  // north.
  const left = isFlipped ? box.x + box.width : box.x
  const originX = matrix.a * left + matrix.c * box.y + matrix.e
  const originY = matrix.b * left + matrix.d * box.y + matrix.f
  const sign = isFlipped ? -1 : 1
  // NOTE: whole game pixels, as the billboards snap, unless the sprite is
  // turned, when its corner falls where its turn puts it.
  const isTurned = Math.abs(matrix.b) > 1e-6 || Math.abs(matrix.c) > 1e-6
  const x = isTurned ? originX : Math.round(originX)
  const y = isTurned ? originY : Math.round(originY)
  // NOTE: a step across the sprite in the world, and a step up it (the
  // geometry's y runs up, the sprite's rows down).
  const column = [
    ux * sign * UNIT,
    -uy * sign * UNIT * CAMERA_UP.y,
    -uy * sign * UNIT * CAMERA_UP.z,
  ]
  const up = [-vx * UNIT, vy * UNIT * CAMERA_UP.y, vy * UNIT * CAMERA_UP.z]
  const toward = [
    TOWARD_CAMERA.x * UNIT * depth,
    TOWARD_CAMERA.y * UNIT * depth,
    TOWARD_CAMERA.z * UNIT * depth,
  ]
  const at = standingPointOf({
    x,
    footY: Math.round(footY),
    atY: y - Math.round(hover),
    out: nudge,
  })
  const translation = [at.x, at.y, at.z]
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

// NOTE: the matrix that stands a piece's upright blocks (`isUpright`) at
// its foot: its art's top left corner up its front from the foot, leaning
// back (`uprightLeanOf`), on the very ray `slabMatrixOf` puts it on, so the
// lens sees the same pixels, its depth running north from there. A piece of
// the house stands as it leans, never turned or spun.
export const uprightMatrixOf = (
  placement: SlabPlacement & Readonly<{ lean: number }>,
): Readonly<{ elements: ReadonlyArray<number>; isFlipped: boolean }> => {
  const { matrix, box, texels, footY, nudge, depth, lean } = placement
  const across = box.width / texels.width
  const down = box.height / texels.height
  const isFlipped = isFlippedOf(placement)
  const left = isFlipped ? box.x + box.width : box.x
  const x = Math.round(matrix.a * left + matrix.c * box.y + matrix.e)
  const y = Math.round(matrix.b * left + matrix.d * box.y + matrix.f)
  const foot = Math.round(footY)
  // NOTE: up the camera's up from the foot, then along the ray to the
  // front: a rise of r up the camera's up is r / cos(PITCH - lean) up a
  // front leaning back that far, and r tan(PITCH - lean) toward the lens.
  const at = standingPointOf({
    x,
    footY: foot,
    atY: y,
    out: nudge + (foot - y) * UNIT * Math.tan(PITCH - lean),
  })
  return {
    isFlipped,
    elements: [
      matrix.a * across * (isFlipped ? -1 : 1) * UNIT,
      0,
      0,
      0,
      0,
      matrix.d * down * UNIT,
      0,
      0,
      0,
      0,
      UNIT * depth,
      0,
      at.x,
      at.y,
      at.z,
      1,
    ],
  }
}
