import { Array, Function, Result, pipe } from 'effect'
import { Canvas } from 'foldkit'

import type { Vector } from '../app/model'
import { GLYPH_HEIGHT, type TextTone, textShapes } from '../art/font'
import { type Facing, type Palette, placeAt, spriteRects } from '../art/sprite'
import { SHADOW_HEIGHT } from '../shared/constants'
import { clamp } from '../world/step/geometry'

// SHARED SHAPE HELPERS

export const UNIT_SCALE: Vector = { x: 1, y: 1 }
export const QUARTER_TURN = Math.PI / 2
export const FULL_TURN = Math.PI * 2
export const AIMING_UP = -0.35

// NOTE: an alpha from faint to strong as a tell fills, to two places.
export const tellAlpha: {
  (strong: number, progress: number): (faint: number) => number
  (faint: number, strong: number, progress: number): number
} = Function.dual(
  3,
  (faint: number, strong: number, progress: number): number =>
    Math.round((faint + (strong - faint) * progress) * 100) / 100,
)

export const placeSprite: {
  (y: number, sprite: ReadonlyArray<Canvas.Shape>): (x: number) => Canvas.Shape
  (x: number, y: number, sprite: ReadonlyArray<Canvas.Shape>): Canvas.Shape
} = Function.dual(
  3,
  (x: number, y: number, sprite: ReadonlyArray<Canvas.Shape>): Canvas.Shape =>
    placeAt(Math.round(x), Math.round(y), sprite),
)

export const rect: {
  (
    y: number,
    width: number,
    height: number,
    fill: string,
  ): (x: number) => Canvas.Shape
  (
    x: number,
    y: number,
    width: number,
    height: number,
    fill: string,
  ): Canvas.Shape
} = Function.dual(
  5,
  (
    x: number,
    y: number,
    width: number,
    height: number,
    fill: string,
  ): Canvas.Shape => Canvas.Rect({ x, y, width, height, fill }),
)

export const centeredRect: {
  (
    y: number,
    width: number,
    height: number,
    fill: string,
  ): (x: number) => Canvas.Shape
  (
    x: number,
    y: number,
    width: number,
    height: number,
    fill: string,
  ): Canvas.Shape
} = Function.dual(
  5,
  (
    x: number,
    y: number,
    width: number,
    height: number,
    fill: string,
  ): Canvas.Shape =>
    Canvas.Rect({
      x: x - Math.floor(width / 2),
      y: y - Math.floor(height / 2),
      width,
      height,
      fill,
    }),
)

// NOTE: a pixel map's rectangles with its top left corner at (x, y). Fixed
// art that is drawn as it is goes through `spriteShapes` instead.
export const pixelArt: {
  (
    y: number,
    pixels: ReadonlyArray<string>,
    palette: Palette,
  ): (x: number) => ReadonlyArray<Canvas.Shape>
  (
    x: number,
    y: number,
    pixels: ReadonlyArray<string>,
    palette: Palette,
  ): ReadonlyArray<Canvas.Shape>
} = Function.dual(
  4,
  (
    x: number,
    y: number,
    pixels: ReadonlyArray<string>,
    palette: Palette,
  ): ReadonlyArray<Canvas.Shape> =>
    spriteRects(pixels, palette, { x: -x, y: -y }),
)

const GLYPHS_TOP = -Math.floor(GLYPH_HEIGHT / 2)

export const centeredGlyphs: {
  (tone: TextTone): (text: string) => ReadonlyArray<Canvas.Shape>
  (text: string, tone: TextTone): ReadonlyArray<Canvas.Shape>
} = Function.dual(
  2,
  (text: string, tone: TextTone): ReadonlyArray<Canvas.Shape> =>
    textShapes(text, tone, 0, GLYPHS_TOP, 'Center'),
)

// MOTION

export const footPosition: {
  (footOffset: number): (position: Vector) => Vector
  (position: Vector, footOffset: number): Vector
} = Function.dual(2, (position: Vector, footOffset: number): Vector => ({
  x: Math.round(position.x),
  y: Math.round(position.y) + footOffset,
}))

export const multiplyScales: {
  (second: Vector): (first: Vector) => Vector
  (first: Vector, second: Vector): Vector
} = Function.dual(2, (first: Vector, second: Vector): Vector => ({
  x: first.x * second.x,
  y: first.y * second.y,
}))

export const squashPulse: {
  (durationMs: number, strength: number): (remainingMs: number) => Vector
  (remainingMs: number, durationMs: number, strength: number): Vector
} = Function.dual(
  3,
  (remainingMs: number, durationMs: number, strength: number): Vector => {
    if (remainingMs <= 0) {
      return UNIT_SCALE
    }

    const remaining = remainingMs / durationMs
    const amount = strength * remaining * Math.cos(FULL_TURN * (1 - remaining))
    return { x: 1 + amount, y: 1 - amount }
  },
)

export const progressBetween: {
  (start: number, end: number): (progress: number) => number
  (progress: number, start: number, end: number): number
} = Function.dual(3, (progress: number, start: number, end: number): number =>
  clamp((progress - start) / (end - start), 0, 1),
)

export const facingToward: {
  (toX: number): (fromX: number) => Facing
  (fromX: number, toX: number): Facing
} = Function.dual(2, (fromX: number, toX: number): Facing =>
  toX < fromX ? 'Left' : 'Right',
)

export const footShadow: {
  (
    footOffset: number,
    width: number,
    fill: string,
  ): (position: Vector) => Canvas.Shape
  (
    position: Vector,
    footOffset: number,
    width: number,
    fill: string,
  ): Canvas.Shape
} = Function.dual(
  4,
  (
    position: Vector,
    footOffset: number,
    width: number,
    fill: string,
  ): Canvas.Shape => {
    const foot = footPosition(position, footOffset)
    return centeredRect(foot.x, foot.y, width, SHADOW_HEIGHT, fill)
  },
)

// RINGS

export type RingPixel = Readonly<{ x: number; y: number; turn: number }>

// NOTE: the ring's pixels around a middle, each with how far round
// it sits from the top, clockwise, as a fraction of a turn.
export const ringPixels = (radius: number): ReadonlyArray<RingPixel> =>
  pipe(
    Array.makeBy((radius + 1) * 2 + 1, row => row - radius - 1),
    Array.flatMap(dy =>
      Array.filterMap(
        Array.makeBy((radius + 1) * 2 + 1, column => column - radius - 1),
        (dx): Result.Result<RingPixel, void> => {
          const distance = Math.hypot(dx + 0.5, dy + 0.5)
          const angle = Math.atan2(dx + 0.5, -(dy + 0.5))
          return distance >= radius - 1.5 && distance <= radius + 0.5
            ? Result.succeed({
                x: dx,
                y: dy,
                turn: (angle < 0 ? angle + Math.PI * 2 : angle) / (Math.PI * 2),
              })
            : Result.failVoid
        },
      ),
    ),
  )

// BARS

export const HEALTH_BAR_BACK_COLOR = '#140c10'
export const HEALTH_BAR_GAP = 3
