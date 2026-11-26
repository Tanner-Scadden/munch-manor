import { Function } from 'effect'

import type * as Draw from '#render/draw.ts'

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

type Heights = Set<number>
type Widths = Map<number, Heights>
type Rows = Map<number, Widths>
type Columns = Map<number, Rows>

export interface RectSet {
  readonly add: (shape: Draw.Rect) => void
  readonly has: (shape: Draw.Rect) => boolean
}

const childOf = <K, V>(map: Map<K, V>, key: K, make: () => V): V => {
  const known = map.get(key)
  if (known !== undefined) {
    return known
  }
  const made = make()
  map.set(key, made)
  return made
}

export const makeRectSet = (): RectSet => {
  const byFill = new Map<string | undefined, Columns>()
  return {
    add: shape => {
      const columns = childOf(byFill, shape.fill, (): Columns => new Map())
      const rows = childOf(columns, shape.x, (): Rows => new Map())
      const widths = childOf(rows, shape.y, (): Widths => new Map())
      childOf(widths, shape.width, (): Heights => new Set()).add(shape.height)
    },
    has: shape =>
      byFill
        .get(shape.fill)
        ?.get(shape.x)
        ?.get(shape.y)
        ?.get(shape.width)
        ?.has(shape.height) === true,
  }
}

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
