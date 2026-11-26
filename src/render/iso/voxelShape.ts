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

export const DEPTH_BACK = Math.cos(PITCH) / Math.sin(PITCH)

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

const FOOT_SHADE = 0.5
const SHADE_RISE = 6

export const sideShadeOf = (height: number): number =>
  FOOT_SHADE + (1 - FOOT_SHADE) * Math.min(1, Math.max(0, height / SHADE_RISE))

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
      plate[index] = isTop && isBottom ? 1 : 0
      back[index] = isTop && isBottom ? start + 1 : Math.max(start + 1, ownBack)
      over = start
      shallowest = Math.min(shallowest, start)
    }
  }
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
  colors: Float32Array
  indices: Uint32Array
}>

export type CasterMeshData = Readonly<{
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array
}>

type Point = readonly [number, number, number]

const pointOf = (x: number, y: number, d: number): Point => [
  x,
  d - y,
  -d * DEPTH_BACK,
]

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

class Builder {
  readonly positions: Array<number> = []
  readonly normals: Array<number> = []
  readonly uvs: Array<number> = []
  readonly colors: Array<number> = []
  readonly indices: Array<number> = []

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

type FaceSpec = Readonly<{
  normal: Point
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
  isUpright?: boolean
}>): VoxelMeshData &
  Readonly<{
    lift: number
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
          const isFoldTop = spec.normal === TOP && isFoldedAt(column, row - 1)
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

export type SlabPlacement = Readonly<{
  matrix: Affine
  box: Readonly<{ x: number; y: number; width: number; height: number }>
  texels: Readonly<{ width: number; height: number }>
  footY: number
  hover: number
  nudge: number
  depth: number
  spin?: number
}>

const SPIN_STEP = Math.PI / 8

export const snappedSpinOf = (spin: number): number => {
  const steps = Math.round(spin / SPIN_STEP) % 16
  return steps === 0 ? 0 : steps * SPIN_STEP
}

const GROUND_SLACK = 3

const MOST_LEAN = 0.6

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
  const left = isFlipped ? box.x + box.width : box.x
  const originX = matrix.a * left + matrix.c * box.y + matrix.e
  const originY = matrix.b * left + matrix.d * box.y + matrix.f
  const sign = isFlipped ? -1 : 1
  const isTurned = Math.abs(matrix.b) > 1e-6 || Math.abs(matrix.c) > 1e-6
  const x = isTurned ? originX : Math.round(originX)
  const y = isTurned ? originY : Math.round(originY)
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
