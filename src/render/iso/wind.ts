// The draft through the manor: the spritecook.ai tree wind, indoors. Each
// plant is cut into clumps of leaves that move by whole pixels, posed at
// 10 Hz from a fixed 20 s gust loop, a breeze wave running across the room,
// and a lean that lags the gusts. It reads only the World's clock, so it is
// the same on every machine and never touches the game.

import { String } from 'effect'

import type { Vector } from '../../world/schema/entitySchema'

const GUST_LOOP_S = 20
const POSE_HZ = 10
const BREEZE = 0.6

// NOTE: the wind's clock: the World's, in seconds, held for each 10 Hz pose.
export const windClockOf = (elapsedMs: number): number =>
  Math.floor((elapsedMs / 1000) * POSE_HZ) / POSE_HZ

const bump = (u: number, center: number, width: number): number =>
  Math.exp(-(((u - center) / width) ** 2))

const gustAt = (t: number): number => {
  const u = (((t % GUST_LOOP_S) + GUST_LOOP_S) % GUST_LOOP_S) / GUST_LOOP_S
  return (
    bump(u, 0.22, 0.05) + 0.7 * bump(u, 0.6, 0.07) + 0.5 * bump(u, 0.85, 0.03)
  )
}

// NOTE: a spring's lean behind the gust: it pushes over, overshoots, and
// settles, about one sway each 2.2 s.
const leanAt = (t: number): number =>
  2.2 * gustAt(t - 0.3) +
  0.8 * gustAt(t - 0.9) * Math.sin((2 * Math.PI * t) / 2.2)

// NOTE: how far a clump at (x, y) of this weight sways at t, in whole pixels.
// A weight of 0 (a pot) never moves.
export const windOffsetAt = ({
  t,
  spot,
  weight,
}: Readonly<{ t: number; spot: Vector; weight: number }>): Vector => {
  if (weight === 0) {
    return { x: 0, y: 0 }
  }
  const gust = gustAt(t)
  const along = spot.x + 0.25 * spot.y
  const phase = 2 * Math.PI * (t / 1.54 - along / 69)
  const dx =
    leanAt(t) * weight +
    weight * (0.9 * BREEZE + 1.3 * gust) * (0.5 - 0.5 * Math.cos(phase))
  const dy =
    -weight * (0.75 * BREEZE + 0.5 * gust) * Math.max(Math.sin(phase), 0)
  return { x: Math.round(dx), y: Math.round(dy) }
}

// NOTE: the chandelier swings a pixel or two on its chain, harder in a gust.
export const chandelierSwayAt = (t: number): number =>
  Math.round((1 + 1.5 * gustAt(t - 0.2)) * Math.sin((2 * Math.PI * t) / 3.4))

// THE FERN'S BEND

// NOTE: a fern's leaves (its top 13 rows) cut in thirds across and in bands
// of two rows down, and its pot, which never moves. Every band reads the
// wind at the plant's own spot, and a band sways more the higher it sits
// (its weight grows with the square of its height), so the whole fern bends
// from its pot like a stalk, a whole pixel per band: the row bend of the
// spritecook.ai tree wind (owner, 2026-11-14), with no shader.
const LEAF_ROWS = 13
const BAND_ROWS = 2
const BEND_ROOT = 0.15
const MIDDLE_SWAY = 0.85
const POT = 'pot'

export type Bounds = Readonly<{
  left: number
  top: number
  right: number
  bottom: number
}>

// NOTE: the band a pixel of the fern belongs to: 'pot', or its third across
// and its band down, as 'column:band'.
export const fernBandOf = ({
  rect,
  plant,
}: Readonly<{
  rect: Readonly<{ x: number; y: number; width: number }>
  plant: Bounds
}>): string => {
  const row = rect.y - plant.top
  const third = (plant.right - plant.left) / 3
  const column = Math.min(
    2,
    Math.floor((rect.x + rect.width / 2 - plant.left) / third),
  )
  return row >= LEAF_ROWS ? POT : `${column}:${Math.floor(row / BAND_ROWS)}`
}

// NOTE: how far a band sways for its height over the pot, 0 at the pot and
// 1 at the top, and a little less in the middle third.
export const bendWeightOf = ({
  band,
  top,
  height,
}: Readonly<{ band: string; top: number; height: number }>): number => {
  if (band === POT) {
    return 0
  }
  const rise = 1 - (top + height / 2) / LEAF_ROWS
  const column = String.startsWith('1:')(band) ? MIDDLE_SWAY : 1
  return column * (BEND_ROOT + (1 - BEND_ROOT) * rise * rise)
}
