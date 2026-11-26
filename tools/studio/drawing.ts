import { Array, Function, Option, pipe } from 'effect'

import { type Sprite, boundsOf, group } from '../../src/art/sprite'
import * as Draw from '../../src/render/draw'
import type { Backdrop, Model } from './block'
import type { Bounds, Entry, Look } from './catalog'

export const BACKDROP_COLORS: Readonly<Record<Backdrop, string>> = {
  Floor: '#4a3426',
  Dark: '#14121a',
  Light: '#ece6f2',
  Grass: '#2f5a34',
}

const PAD = 2

export const lookOf = (model: Model): Look => ({
  facing: model.facing,
  tone: model.tone,
  clockMs: model.clockMs,
})

export const paddedBy =
  (pad: number) =>
  (bounds: Bounds): Bounds => ({
    left: Math.floor(bounds.left) - pad,
    top: Math.floor(bounds.top) - pad,
    right: Math.ceil(bounds.right) + pad,
    bottom: Math.ceil(bounds.bottom) + pad,
  })

export const padded = paddedBy(PAD)

export const spritesBounds = (sprites: ReadonlyArray<Sprite>): Bounds =>
  boundsOf(Array.map(sprites, shapes => group({ shapes })))

export const frameIndexOf: {
  (clockMs: number, count: number): (entry: Entry) => number
  (entry: Entry, clockMs: number, count: number): number
} = Function.dual(
  3,
  (entry: Entry, clockMs: number, count: number): number =>
    Math.floor(clockMs / entry.frameMs) % count,
)

export const frameOf: {
  (index: number): (frames: Array.NonEmptyReadonlyArray<Sprite>) => Sprite
  (frames: Array.NonEmptyReadonlyArray<Sprite>, index: number): Sprite
} = Function.dual(
  2,
  (frames: Array.NonEmptyReadonlyArray<Sprite>, index: number): Sprite =>
    pipe(
      frames,
      Array.get(index),
      Option.getOrElse(() => Array.headNonEmpty(frames)),
    ),
)

export const zoomed: {
  (
    bounds: Bounds,
    zoom: number,
  ): (shapes: ReadonlyArray<Draw.Shape>) => Draw.Shape
  (shapes: ReadonlyArray<Draw.Shape>, bounds: Bounds, zoom: number): Draw.Shape
} = Function.dual(
  3,
  (
    shapes: ReadonlyArray<Draw.Shape>,
    bounds: Bounds,
    zoom: number,
  ): Draw.Shape =>
    group({
      scale: { x: zoom, y: zoom },
      shapes: [
        group({ translate: { x: -bounds.left, y: -bounds.top }, shapes }),
      ],
    }),
)

type Size = Readonly<{ width: number; height: number }>

export const backdropRect: {
  (backdrop: Backdrop): (size: Size) => Draw.Shape
  (size: Size, backdrop: Backdrop): Draw.Shape
} = Function.dual(
  2,
  ({ width, height }: Size, backdrop: Backdrop): Draw.Shape =>
    Draw.Rect({ x: 0, y: 0, width, height, fill: BACKDROP_COLORS[backdrop] }),
)

export const sizeOf: {
  (zoom: number): (bounds: Bounds) => Size
  (bounds: Bounds, zoom: number): Size
} = Function.dual(2, (bounds: Bounds, zoom: number): Size => ({
  width: Math.max(1, (bounds.right - bounds.left) * zoom),
  height: Math.max(1, (bounds.bottom - bounds.top) * zoom),
}))
