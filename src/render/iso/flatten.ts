// Canvas shapes flattened into leaves: each drawn shape with the matrix and
// the opacity its groups give it, as the 2D painter would draw it.

import type { Canvas } from 'foldkit'

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

const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

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
const groupMatrix = (group: Canvas.Group): Affine => {
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
  shape: Exclude<Canvas.Shape, Canvas.Group>
  matrix: Affine
  alpha: number
}>

const flattenInto = (
  shapes: ReadonlyArray<Canvas.Shape>,
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
  shapes: ReadonlyArray<Canvas.Shape>,
): ReadonlyArray<Leaf> => {
  const out: Array<Leaf> = []
  flattenInto(shapes, IDENTITY, 1, out)
  return out
}

// NOTE: a rectangle named by where it is and how it is filled, to find one
// list's rectangles in another (the room's art less the standing furniture,
// the ground less what has landed).
export const rectKey = (shape: Canvas.Rect): string =>
  `${shape.x},${shape.y},${shape.width},${shape.height},${shape.fill ?? ''}`
