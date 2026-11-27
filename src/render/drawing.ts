import { Array, Function, Result, pipe } from 'effect'

import { GLYPH_HEIGHT, type TextTone, textShapes } from '#art/font.ts'
import {
  type Facing,
  type Palette,
  type Sprite,
  bakeShapes,
  placeAt,
  spriteRects,
} from '#art/sprite.ts'
import { SHADOW_HEIGHT } from '#shared/constants.ts'
import type { Vector } from '#world/schema/entitySchema.ts'
import { clamp } from '#world/step/geometry.ts'

import * as Draw from './draw.ts'

export const UNIT_SCALE: Vector = { x: 1, y: 1 }
export const QUARTER_TURN = Math.PI / 2
export const FULL_TURN = Math.PI * 2
export const AIMING_UP = -0.35

export const tellAlpha: {
  (strong: number, progress: number): (faint: number) => number
  (faint: number, strong: number, progress: number): number
} = Function.dual(
  3,
  (faint: number, strong: number, progress: number): number =>
    Math.round((faint + (strong - faint) * progress) * 100) / 100,
)

export const placeSprite: {
  (y: number, sprite: ReadonlyArray<Draw.Shape>): (x: number) => Draw.Shape
  (x: number, y: number, sprite: ReadonlyArray<Draw.Shape>): Draw.Shape
} = Function.dual(
  3,
  (x: number, y: number, sprite: ReadonlyArray<Draw.Shape>): Draw.Shape =>
    placeAt(Math.round(x), Math.round(y), sprite),
)

export const rect: {
  (
    y: number,
    width: number,
    height: number,
    fill: string,
  ): (x: number) => Draw.Shape
  (
    x: number,
    y: number,
    width: number,
    height: number,
    fill: string,
  ): Draw.Shape
} = Function.dual(
  5,
  (
    x: number,
    y: number,
    width: number,
    height: number,
    fill: string,
  ): Draw.Shape => Draw.Rect({ x, y, width, height, fill }),
)

export const GLINT: Sprite = bakeShapes([
  rect(0, -2, 1, 5, '#fff7d0'),
  rect(-2, 0, 5, 1, '#fff7d0'),
])

export const GOODIE_SHADOW: Sprite = bakeShapes([
  rect(-3, 0, 7, 1, 'rgba(0, 0, 0, 0.35)'),
  rect(-2, 1, 5, 1, 'rgba(0, 0, 0, 0.2)'),
])

export const centeredRect: {
  (
    y: number,
    width: number,
    height: number,
    fill: string,
  ): (x: number) => Draw.Shape
  (
    x: number,
    y: number,
    width: number,
    height: number,
    fill: string,
  ): Draw.Shape
} = Function.dual(
  5,
  (
    x: number,
    y: number,
    width: number,
    height: number,
    fill: string,
  ): Draw.Shape =>
    Draw.Rect({
      x: x - Math.floor(width / 2),
      y: y - Math.floor(height / 2),
      width,
      height,
      fill,
    }),
)

export const pixelArt: {
  (
    y: number,
    pixels: ReadonlyArray<string>,
    palette: Palette,
  ): (x: number) => ReadonlyArray<Draw.Shape>
  (
    x: number,
    y: number,
    pixels: ReadonlyArray<string>,
    palette: Palette,
  ): ReadonlyArray<Draw.Shape>
} = Function.dual(
  4,
  (
    x: number,
    y: number,
    pixels: ReadonlyArray<string>,
    palette: Palette,
  ): ReadonlyArray<Draw.Shape> =>
    spriteRects(pixels, palette, { x: -x, y: -y }),
)

const GLYPHS_TOP = -Math.floor(GLYPH_HEIGHT / 2)

export const centeredGlyphs: {
  (tone: TextTone): (text: string) => ReadonlyArray<Draw.Shape>
  (text: string, tone: TextTone): ReadonlyArray<Draw.Shape>
} = Function.dual(
  2,
  (text: string, tone: TextTone): ReadonlyArray<Draw.Shape> =>
    textShapes(text, tone, 0, GLYPHS_TOP, 'Center'),
)

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
  ): (position: Vector) => Draw.Shape
  (
    position: Vector,
    footOffset: number,
    width: number,
    fill: string,
  ): Draw.Shape
} = Function.dual(
  4,
  (
    position: Vector,
    footOffset: number,
    width: number,
    fill: string,
  ): Draw.Shape => {
    const foot = footPosition(position, footOffset)
    return centeredRect(foot.x, foot.y, width, SHADOW_HEIGHT, fill)
  },
)

export type RingPixel = Readonly<{ x: number; y: number; turn: number }>

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

export const HEALTH_BAR_BACK_COLOR = '#140c10'
export const HEALTH_BAR_GAP = 3
