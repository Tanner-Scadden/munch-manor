// Canvas shapes flattened into leaves: each drawn shape with the matrix and
// the opacity its groups give it, as the 2D painter would draw it.

import { Function } from 'effect'

import type * as Draw from '../draw'

// NOTE: a 2D affine matrix as the canvas keeps it: x' = a x + c y + e,
// y' = b x + d y + f.
export type Affine = Readonly<{
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}>

export const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

const multiply = (m: Affine, n: Affine): Affine => ({
  a: m.a * n.a + m.c * n.b,
  b: m.b * n.a + m.d * n.b,
  c: m.a * n.c + m.c * n.d,
  d: m.b * n.c + m.d * n.d,
  e: m.a * n.e + m.c * n.f + m.e,
  f: m.b * n.e + m.d * n.f + m.f,
})

const rotation = (turn: number): Affine => ({
  a: Math.cos(turn),
  b: Math.sin(turn),
  c: -Math.sin(turn),
  d: Math.cos(turn),
  e: 0,
  f: 0,
})

// NOTE: the painter's order: translate, then rotate, then scale.
const groupMatrix = (group: Draw.Group): Affine => {
  const moved =
    group.translate === undefined
      ? IDENTITY
      : { ...IDENTITY, e: group.translate.x, f: group.translate.y }
  const turned =
    group.rotate === undefined || group.rotate === 0
      ? moved
      : multiply(moved, rotation(group.rotate))
  return group.scale === undefined
    ? turned
    : multiply(turned, { ...IDENTITY, a: group.scale.x, d: group.scale.y })
}

export type Leaf = Readonly<{
  shape: Exclude<Draw.Shape, Draw.Group>
  matrix: Affine
  alpha: number
}>

const flattenInto = (
  shapes: ReadonlyArray<Draw.Shape>,
  matrix: Affine,
  alpha: number,
  out: Array<Leaf>,
): void => {
  for (const shape of shapes) {
    if (shape._tag === 'Group') {
      flattenInto(
        shape.shapes,
        multiply(matrix, groupMatrix(shape)),
        alpha * (shape.opacity ?? 1),
        out,
      )
    } else {
      out.push({ shape, matrix, alpha })
    }
  }
}

export const flatten = (
  shapes: ReadonlyArray<Draw.Shape>,
): ReadonlyArray<Leaf> => {
  const out: Array<Leaf> = []
  flattenInto(shapes, IDENTITY, 1, out)
  return out
}

// NOTE: a rectangle named by where it is and how it is filled, to find one
// list's rectangles in another (the room's art less the standing furniture,
// the ground less what has landed).
// NOTE: read once per level, as the house's floor art is sorted out
// (house.ts), never per frame.
// oxlint-disable-next-line munch/no-string-key-per-frame
export const rectKey = (shape: Draw.Rect): string =>
  `${shape.x},${shape.y},${shape.width},${shape.height},${shape.fill ?? ''}`

// SAMENESS

// NOTE: whether two values hold the same data, `depth` levels down: a
// shape's own fields are numbers and strings, but for a path's instructions
// (a list of flat records) and an image's crop (one flat record).
const isSameData = (a: unknown, b: unknown, depth: number): boolean => {
  if (a === b) {
    return true
  }
  if (
    depth === 0 ||
    typeof a !== 'object' ||
    typeof b !== 'object' ||
    a === null ||
    b === null
  ) {
    return false
  }
  let count = 0
  for (const key in a) {
    count += 1
    if (!isSameData(Reflect.get(a, key), Reflect.get(b, key), depth - 1)) {
      return false
    }
  }
  for (const _key in b) {
    count -= 1
  }
  return count === 0
}

const SHAPE_DEPTH = 3

const isSameMatrix = (m: Affine, n: Affine): boolean =>
  m === n ||
  (m.a === n.a &&
    m.b === n.b &&
    m.c === n.c &&
    m.d === n.d &&
    m.e === n.e &&
    m.f === n.f)

// NOTE: whether two lists of leaves draw exactly the same picture, so a
// picture drawn from the first need not be drawn again for the second. It
// reads each leaf's few fields once, a few dozen leaves a frame, and never
// hashes or walks a Model: a shape built again each frame to the same
// numbers is the same, and one moved by a pixel is not.
export const isSameLeaves: {
  (after: ReadonlyArray<Leaf>): (before: ReadonlyArray<Leaf>) => boolean
  (before: ReadonlyArray<Leaf>, after: ReadonlyArray<Leaf>): boolean
} = Function.dual(
  2,
  (before: ReadonlyArray<Leaf>, after: ReadonlyArray<Leaf>): boolean => {
    if (before === after) {
      return true
    }
    if (before.length !== after.length) {
      return false
    }
    for (let index = 0; index < after.length; index += 1) {
      const was = before[index]
      const is = after[index]
      if (
        was === undefined ||
        is === undefined ||
        was.alpha !== is.alpha ||
        !isSameMatrix(was.matrix, is.matrix) ||
        !isSameData(was.shape, is.shape, SHAPE_DEPTH)
      ) {
        return false
      }
    }
    return true
  },
)
