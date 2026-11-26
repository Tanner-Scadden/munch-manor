// Circles on the game's pixel grid: a disc or a ring of whole pixels, as
// rows of spans from its middle. A Draw.Circle is drawn as a vector, so
// the 3D renderer's floor drew it at the device's pixels, finer than the
// game's around every tell ring, and dropped it outright where it stands
// or floats. A ring here is baked once per size and color as a sprite
// (pixelRing, pixelDisc), so it stands, lies, and floats as any sprite
// does, sharp on the game's grid; a ring too wide to bake at every size
// (the burp's) is drawn as its spans (pixelRingSpans).

import { Array, Function } from 'effect'

import { type Sprite, bakeShapes, placeAt } from '../art/sprite'
import type * as Draw from './draw'
import { rect } from './drawing'

// NOTE: a row of a circle: its row and left edge from the middle, and its
// width, in whole pixels.
type Span = readonly [row: number, left: number, width: number]

// NOTE: how far a row reaches from the middle: the pixels whose middles lie
// within half a pixel past the radius, so a radius of 2 is a round 5 across
// rather than a diamond.
const reachOf = (radius: number, row: number): number => {
  const squared = radius * radius + radius - row * row
  return squared < 0 ? -1 : Math.floor(Math.sqrt(squared))
}

// NOTE: a table keyed by its parts, one Map each, asked for every ring of
// every frame, so a lookup builds no key.
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

// NOTE: by radius, then thickness.
const spansByRadius = new Map<number, Map<number, ReadonlyArray<Span>>>()

// NOTE: the spans of a ring this thick at this radius, its outer edge on the
// radius; as thick as the radius or more, a whole disc. Each row's pixels
// reach the row's outer edge, so the ring never breaks into loose dots.
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

// NOTE: by color, then radius, then thickness.
const spritesByColor = new Map<string, Map<number, Map<number, Sprite>>>()

// NOTE: the baked ring, built once per radius, thickness, and color. A
// module that draws one bakes its sizes as it loads (bakeRings), so the
// sprite atlas finds them.
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

// NOTE: every ring from one radius to another, at one thickness and color,
// baked as the module that draws them loads.
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

// NOTE: a ring of whole pixels round x and y, its outer edge on the radius.
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

// NOTE: thick enough that no radius leaves a hole.
const SOLID = Number.MAX_SAFE_INTEGER

// NOTE: a disc of whole pixels round x and y.
export const pixelDisc: {
  (y: number, radius: number, color: string): (x: number) => Draw.Shape
  (x: number, y: number, radius: number, color: string): Draw.Shape
} = Function.dual(
  4,
  (x: number, y: number, radius: number, color: string): Draw.Shape =>
    pixelRing(x, y, radius, SOLID, color),
)

// NOTE: every disc from one radius to another, baked as its module loads.
export const bakeDiscs: {
  (to: number, color: string): (from: number) => void
  (from: number, to: number, color: string): void
} = Function.dual(3, (from: number, to: number, color: string): void => {
  bakeRings(from, to, SOLID, color)
})

// NOTE: a ring as its spans, unbaked, for a ring too wide to bake at
// every size it grows through.
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

// NOTE: a disc as its spans, unbaked, for a shape baked from several.
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
