import { Array, Function } from 'effect'

import { type Sprite, bakeShapes, placeAt } from '../art/sprite'
import type * as Draw from './draw'
import { rect } from './drawing'

type Span = readonly [row: number, left: number, width: number]

const reachOf = (radius: number, row: number): number => {
  const squared = radius * radius + radius - row * row
  return squared < 0 ? -1 : Math.floor(Math.sqrt(squared))
}

const innerOf = <K, V>(
  outer: Map<K, Map<number, V>>,
  key: K,
): Map<number, V> => {
  const known = outer.get(key)
  if (known !== undefined) {
    return known
  }
  const inner = new Map<number, V>()
  outer.set(key, inner)
  return inner
}

const spansByRadius = new Map<number, Map<number, ReadonlyArray<Span>>>()

const spansOf = (radius: number, thickness: number): ReadonlyArray<Span> => {
  const byThickness = innerOf(spansByRadius, radius)
  const known = byThickness.get(thickness)
  if (known !== undefined) {
    return known
  }
  const inner = radius - thickness
  const spans = Array.flatMap(
    Array.range(-radius, radius),
    (row): ReadonlyArray<Span> => {
      const outer = reachOf(radius, row)
      const hole =
        inner >= 0 && Math.abs(row) <= inner ? reachOf(inner, row) : -1
      return hole < 0
        ? [[row, -outer, 2 * outer + 1]]
        : [
            [row, -outer, outer - hole],
            [row, hole + 1, outer - hole],
          ]
    },
  )
  byThickness.set(thickness, spans)
  return spans
}

const spanRects = (
  x: number,
  y: number,
  spans: ReadonlyArray<Span>,
  color: string,
): ReadonlyArray<Draw.Shape> =>
  Array.map(spans, ([row, left, width]) =>
    rect(x + left, y + row, width, 1, color),
  )

const spritesByColor = new Map<string, Map<number, Map<number, Sprite>>>()

const ringSprite = (
  radius: number,
  thickness: number,
  color: string,
): Sprite => {
  const whole = Math.max(1, Math.round(radius))
  const byThickness = innerOf(innerOf(spritesByColor, color), whole)
  const known = byThickness.get(thickness)
  if (known !== undefined) {
    return known
  }
  const sprite = bakeShapes(spanRects(0, 0, spansOf(whole, thickness), color))
  byThickness.set(thickness, sprite)
  return sprite
}

export const bakeRings: {
  (to: number, thickness: number, color: string): (from: number) => void
  (from: number, to: number, thickness: number, color: string): void
} = Function.dual(
  4,
  (from: number, to: number, thickness: number, color: string): void => {
    Array.forEach(Array.range(from, to), radius => {
      ringSprite(radius, thickness, color)
    })
  },
)

export const pixelRing: {
  (
    y: number,
    radius: number,
    thickness: number,
    color: string,
  ): (x: number) => Draw.Shape
  (
    x: number,
    y: number,
    radius: number,
    thickness: number,
    color: string,
  ): Draw.Shape
} = Function.dual(
  5,
  (
    x: number,
    y: number,
    radius: number,
    thickness: number,
    color: string,
  ): Draw.Shape =>
    placeAt(Math.round(x), Math.round(y), ringSprite(radius, thickness, color)),
)

const SOLID = Number.MAX_SAFE_INTEGER

export const pixelDisc: {
  (y: number, radius: number, color: string): (x: number) => Draw.Shape
  (x: number, y: number, radius: number, color: string): Draw.Shape
} = Function.dual(
  4,
  (x: number, y: number, radius: number, color: string): Draw.Shape =>
    pixelRing(x, y, radius, SOLID, color),
)

export const bakeDiscs: {
  (to: number, color: string): (from: number) => void
  (from: number, to: number, color: string): void
} = Function.dual(3, (from: number, to: number, color: string): void => {
  bakeRings(from, to, SOLID, color)
})

export const pixelRingSpans: {
  (
    y: number,
    radius: number,
    thickness: number,
    color: string,
  ): (x: number) => ReadonlyArray<Draw.Shape>
  (
    x: number,
    y: number,
    radius: number,
    thickness: number,
    color: string,
  ): ReadonlyArray<Draw.Shape>
} = Function.dual(
  5,
  (
    x: number,
    y: number,
    radius: number,
    thickness: number,
    color: string,
  ): ReadonlyArray<Draw.Shape> =>
    spanRects(
      Math.round(x),
      Math.round(y),
      spansOf(Math.max(1, Math.round(radius)), thickness),
      color,
    ),
)

export const pixelDiscSpans: {
  (
    y: number,
    radius: number,
    color: string,
  ): (x: number) => ReadonlyArray<Draw.Shape>
  (
    x: number,
    y: number,
    radius: number,
    color: string,
  ): ReadonlyArray<Draw.Shape>
} = Function.dual(
  4,
  (
    x: number,
    y: number,
    radius: number,
    color: string,
  ): ReadonlyArray<Draw.Shape> => pixelRingSpans(x, y, radius, SOLID, color),
)
