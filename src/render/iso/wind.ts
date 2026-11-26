import { String } from 'effect'

import type { Vector } from '../../world/schema/entitySchema'

const GUST_LOOP_S = 20
const POSE_HZ = 10
const BREEZE = 0.6

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

const leanAt = (t: number): number =>
  2.2 * gustAt(t - 0.3) +
  0.8 * gustAt(t - 0.9) * Math.sin((2 * Math.PI * t) / 2.2)

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

export const chandelierSwayAt = (t: number): number =>
  Math.round((1 + 1.5 * gustAt(t - 0.2)) * Math.sin((2 * Math.PI * t) / 3.4))

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
