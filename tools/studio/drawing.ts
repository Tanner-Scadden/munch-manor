// The drawing the studio's pictures share: a sprite's frames scaled up on a
// backdrop, with its box and the frame the clock is on.
import { Array, Function, Option, pipe } from 'effect'
import { Canvas } from 'foldkit'

import { type Sprite, group } from '../../src/art/sprite'
import type { Backdrop, Model } from './block'
import { type Bounds, type Entry, type Look, boundsOf } from './catalog'

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

// NOTE: a box grown to whole pixels and `pad` more on every side.
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

// NOTE: which of an entry's frames the clock is on.
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

// NOTE: world shapes scaled by the zoom, with `bounds`' top left at the
// canvas's top left. Two groups, so the order of a group's own translate and
// scale never matters.
export const zoomed: {
  (
    bounds: Bounds,
    zoom: number,
  ): (shapes: ReadonlyArray<Canvas.Shape>) => Canvas.Shape
  (
    shapes: ReadonlyArray<Canvas.Shape>,
    bounds: Bounds,
    zoom: number,
  ): Canvas.Shape
} = Function.dual(
  3,
  (
    shapes: ReadonlyArray<Canvas.Shape>,
    bounds: Bounds,
    zoom: number,
  ): Canvas.Shape =>
    group({
      scale: { x: zoom, y: zoom },
      shapes: [
        group({ translate: { x: -bounds.left, y: -bounds.top }, shapes }),
      ],
    }),
)

type Size = Readonly<{ width: number; height: number }>

export const backdropRect: {
  (backdrop: Backdrop): (size: Size) => Canvas.Shape
  (size: Size, backdrop: Backdrop): Canvas.Shape
} = Function.dual(
  2,
  ({ width, height }: Size, backdrop: Backdrop): Canvas.Shape =>
    Canvas.Rect({ x: 0, y: 0, width, height, fill: BACKDROP_COLORS[backdrop] }),
)

export const sizeOf: {
  (zoom: number): (bounds: Bounds) => Size
  (bounds: Bounds, zoom: number): Size
} = Function.dual(2, (bounds: Bounds, zoom: number): Size => ({
  width: Math.max(1, (bounds.right - bounds.left) * zoom),
  height: Math.max(1, (bounds.bottom - bounds.top) * zoom),
}))
