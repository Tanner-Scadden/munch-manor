// A carved piece (src/art/carve.ts) as the geometry the 3D house stands
// once per level: a face for every side of a block that meets no other,
// colored by its block's view for that face, placed in the world where the
// piece stands. Its grid lies as a sprite's blocks do (voxelShape.ts): its
// columns east, its rows down the lens's up, and its depth north along the
// floor, so its fronts face the lens and its tops lie flat, and from the
// lens its front is exactly the art it was carved from.
//
// A piece set upright in a wall (the library's secret shelf) stands
// square to the wall instead, facing the room (`uprightMeshOf`).
//
// The glowing colors (a candle's flame) go in a geometry of their own, drawn
// unlit, so a flame burns in any light.
//
// Plain data, no pixi.

import { Option } from 'effect'

import {
  type CarvedModel,
  type Face,
  faceColorOf,
  isSolidAt,
  voxelsOf,
} from '../../art/carve'
import { parseColor } from '../../art/png'
import {
  TOWARD_CAMERA,
  UNIT,
  UP_NORMAL,
  WALL_ROW,
  standingPointOf,
  zOf,
} from './space'
import { DEPTH_BACK, STRAIGHT_DOWN } from './voxelShape'

// NOTE: a geometry's arrays, its colors four floats a corner, 0 to 1 as
// drawn (sRGB): the renderer turns them to linear light.
export type CarvedMeshData = Readonly<{
  positions: Float32Array
  normals: Float32Array
  colors: Float32Array
  indices: Uint32Array
}>

// NOTE: where the piece stands, in game pixels: its grid's first column's
// x, the floor point its front stands on, and its first row's top over the
// floor there, along the lens's up.
export type CarvedPlacement = Readonly<{
  left: number
  footY: number
  rise: number
}>

type Point = readonly [number, number, number]

const TOP: Point = UP_NORMAL
const BOTTOM: Point = STRAIGHT_DOWN
const FRONT: Point = [TOWARD_CAMERA.x, TOWARD_CAMERA.y, TOWARD_CAMERA.z]
const BACK: Point = [-TOWARD_CAMERA.x, -TOWARD_CAMERA.y, -TOWARD_CAMERA.z]

// NOTE: each face: its normal in the world, the neighbor that hides it, and
// its four corners as offsets in the grid.
type FaceSpec = Readonly<{
  face: Face
  normal: Point
  neighbor: Point
  corners: readonly [Point, Point, Point, Point]
}>

const FACES: ReadonlyArray<FaceSpec> = [
  {
    face: 'Front',
    normal: FRONT,
    neighbor: [0, 0, -1],
    corners: [
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
      [1, 0, 0],
    ],
  },
  {
    face: 'Top',
    normal: TOP,
    neighbor: [0, -1, 0],
    corners: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1],
    ],
  },
  {
    face: 'Left',
    normal: [-1, 0, 0],
    neighbor: [-1, 0, 0],
    corners: [
      [0, 0, 0],
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0],
    ],
  },
  {
    face: 'Right',
    normal: [1, 0, 0],
    neighbor: [1, 0, 0],
    corners: [
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1],
      [1, 0, 1],
    ],
  },
  {
    face: 'Bottom',
    normal: BOTTOM,
    neighbor: [0, 1, 0],
    corners: [
      [0, 1, 0],
      [0, 1, 1],
      [1, 1, 1],
      [1, 1, 0],
    ],
  },
  {
    face: 'Back',
    normal: BACK,
    neighbor: [0, 0, 1],
    corners: [
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
    ],
  },
]

// NOTE: a corner of the grid in the world: east by its column, up the
// lens's up by its row and depth, and back along the lens by its depth, so
// a step of depth is a game pixel north along the floor.
const worldPointOf = (placement: CarvedPlacement, [x, y, z]: Point): Point => {
  const at = standingPointOf({
    x: placement.left + x,
    footY: placement.footY,
    atY: placement.footY - (placement.rise - y + z),
    out: -z * DEPTH_BACK * UNIT,
  })
  return [at.x, at.y, at.z]
}

// NOTE: mutable on purpose: the arrays are filled once, as the geometry is
// built.
class ColoredBuilder {
  readonly positions: Array<number> = []
  readonly normals: Array<number> = []
  readonly colors: Array<number> = []
  readonly indices: Array<number> = []

  // NOTE: one face, wound counterclockwise seen from its outside, as the
  // renderer culls the rest.
  face(
    corners: readonly [Point, Point, Point, Point],
    normal: Point,
    color: readonly [number, number, number],
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
      this.colors.push(color[0], color[1], color[2], 1)
    }
    if (facing >= 0) {
      this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
    } else {
      this.indices.push(base, base + 2, base + 1, base, base + 3, base + 2)
    }
  }

  data(): CarvedMeshData {
    return {
      positions: Float32Array.from(this.positions),
      normals: Float32Array.from(this.normals),
      colors: Float32Array.from(this.colors),
      indices: Uint32Array.from(this.indices),
    }
  }
}

const channelsOf = (color: string): readonly [number, number, number] =>
  Option.match(parseColor(color), {
    onNone: () => [1, 0, 1],
    onSome: ({ r, g, b }) => [r / 255, g / 255, b / 255],
  })

// NOTE: a model's faces in the world, those of a glowing color apart: a
// corner of the grid at `pointOf`, each face facing `normalOf`.
const facesOf = ({
  model,
  pointOf,
  normalOf,
  isGlowing,
}: Readonly<{
  model: CarvedModel
  pointOf: (corner: Point) => Point
  normalOf: (spec: FaceSpec) => Point
  isGlowing: (color: string) => boolean
}>): Readonly<{ lit: CarvedMeshData; glowing: CarvedMeshData }> => {
  const lit = new ColoredBuilder()
  const glowing = new ColoredBuilder()
  // NOTE: every front first, then the tops and sides, as a sprite's blocks
  // are built (voxelShape.ts).
  for (const spec of FACES) {
    const normal = normalOf(spec)
    for (const voxel of voxelsOf(model)) {
      const [dx, dy, dz] = spec.neighbor
      if (
        isSolidAt({
          model,
          voxel: { x: voxel.x + dx, y: voxel.y + dy, z: voxel.z + dz },
        })
      ) {
        continue
      }
      Option.map(faceColorOf({ model, voxel, face: spec.face }), color => {
        const [c0, c1, c2, c3] = spec.corners
        const at = ([x, y, z]: Point): Point =>
          pointOf([voxel.x + x, voxel.y + y, voxel.z + z])
        ;(isGlowing(color) ? glowing : lit).face(
          [at(c0), at(c1), at(c2), at(c3)],
          normal,
          channelsOf(color),
        )
      })
    }
  }
  return { lit: lit.data(), glowing: glowing.data() }
}

// NOTE: the piece's faces in the world, leaned along the lens.
export const carvedMeshOf = ({
  model,
  placement,
  isGlowing,
}: Readonly<{
  model: CarvedModel
  placement: CarvedPlacement
  isGlowing: (color: string) => boolean
}>): Readonly<{ lit: CarvedMeshData; glowing: CarvedMeshData }> =>
  facesOf({
    model,
    pointOf: corner => worldPointOf(placement, corner),
    normalOf: ({ normal }) => normal,
    isGlowing,
  })

// NOTE: a piece set upright in a side wall, facing the room east or west of
// it, in game pixels: the wall's face's x, the floor row its grid's first
// column stands at (its south end facing east, its north end facing west,
// so it reads left to right from the room), and how many pixels its first
// row's top stands over the floor, in rows of a wall's face. Its rows go
// down the plumb line a screen pixel each, as a wall's face does
// (space.ts `WALL_ROW`), and its depth into the wall.
export type UprightPlacement = Readonly<{
  face: number
  end: number
  height: number
  facing: 'East' | 'West'
}>

export const uprightMeshOf = ({
  model,
  placement,
  isGlowing,
}: Readonly<{
  model: CarvedModel
  placement: UprightPlacement
  isGlowing: (color: string) => boolean
}>): Readonly<{ lit: CarvedMeshData; glowing: CarvedMeshData }> => {
  const { face, end, height, facing } = placement
  const out = facing === 'East' ? 1 : -1
  // NOTE: a step along the grid's columns is a floor row south facing
  // west, north facing east.
  const along = -out
  const normals: Readonly<Record<Face, Point>> = {
    Front: [out, 0, 0],
    Back: [-out, 0, 0],
    Top: [0, 1, 0],
    Bottom: [0, -1, 0],
    Left: [0, 0, -along],
    Right: [0, 0, along],
  }
  return facesOf({
    model,
    pointOf: ([x, y, z]) => [
      (face + out * (model.depth - z)) * UNIT,
      (height - y) * WALL_ROW,
      zOf(end + along * x),
    ],
    normalOf: spec => normals[spec.face],
    isGlowing,
  })
}
