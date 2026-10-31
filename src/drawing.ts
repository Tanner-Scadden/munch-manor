import { Canvas } from 'foldkit'

import { SHADOW_HEIGHT } from './constants'
import { GLYPH_HEIGHT, type TextTone, textShapes } from './font'
import { clamp } from './geometry'
import type { Vector } from './model'
import { type Facing, type Palette, placeAt, spriteRects } from './sprite'

// SHARED SHAPE HELPERS

export const UNIT_SCALE: Vector = { x: 1, y: 1 }
export const QUARTER_TURN = Math.PI / 2
export const FULL_TURN = Math.PI * 2
export const AIMING_UP = -0.35

// NOTE: an alpha from faint to strong as a tell fills, to two places.
export const tellAlpha = (
  faint: number,
  strong: number,
  progress: number,
): number => Math.round((faint + (strong - faint) * progress) * 100) / 100

export const placeSprite = (
  x: number,
  y: number,
  sprite: ReadonlyArray<Canvas.Shape>,
): Canvas.Shape => placeAt(Math.round(x), Math.round(y), sprite)

export const rect = (
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
): Canvas.Shape => Canvas.Rect({ x, y, width, height, fill })

export const centeredRect = (
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
  })

// NOTE: a pixel map's rectangles with its top left corner at (x, y). Fixed
// art that is drawn as it is goes through `spriteShapes` instead.
export const pixelArt = (
  x: number,
  y: number,
  pixels: ReadonlyArray<string>,
  palette: Palette,
): ReadonlyArray<Canvas.Shape> => spriteRects(pixels, palette, { x: -x, y: -y })

const GLYPHS_TOP = -Math.floor(GLYPH_HEIGHT / 2)

export const centeredGlyphs = (
  text: string,
  tone: TextTone,
): ReadonlyArray<Canvas.Shape> =>
  textShapes(text, tone, 0, GLYPHS_TOP, 'Center')

// MOTION

export const footPosition = (position: Vector, footOffset: number): Vector => ({
  x: Math.round(position.x),
  y: Math.round(position.y) + footOffset,
})

export const multiplyScales = (first: Vector, second: Vector): Vector => ({
  x: first.x * second.x,
  y: first.y * second.y,
})

export const squashPulse = (
  remainingMs: number,
  durationMs: number,
  strength: number,
): Vector => {
  if (remainingMs <= 0) {
    return UNIT_SCALE
  }

  const remaining = remainingMs / durationMs
  const amount = strength * remaining * Math.cos(FULL_TURN * (1 - remaining))
  return { x: 1 + amount, y: 1 - amount }
}

export const progressBetween = (
  progress: number,
  start: number,
  end: number,
): number => clamp((progress - start) / (end - start), 0, 1)

export const facingToward = (fromX: number, toX: number): Facing =>
  toX < fromX ? 'Left' : 'Right'

export const footShadow = (
  position: Vector,
  footOffset: number,
  width: number,
  fill: string,
): Canvas.Shape => {
  const foot = footPosition(position, footOffset)
  return centeredRect(foot.x, foot.y, width, SHADOW_HEIGHT, fill)
}

// BARS

export const HEALTH_BAR_BACK_COLOR = '#140c10'
export const HEALTH_BAR_GAP = 3
