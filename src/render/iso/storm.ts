import { Array, Order, Result } from 'effect'

import type * as Draw from '#render/draw.ts'
import { rect } from '#render/drawing.ts'
import type { Box } from '#render/room/roomPalette.ts'
import { type Pane, windowPanesOf } from '#render/room/windows.ts'
import { unitOf } from '#shared/prng.ts'
import type { Level } from '#world/level/arena.ts'
import type { Vector } from '#world/schema/entitySchema.ts'
import type { World } from '#world/schema/worldSchema.ts'

import { strikeOf } from './mood.ts'
import { type ArtQuad, artQuadsOver } from './wallQuads.ts'

const GLASS_PER_STREAK = 24
const STREAK_LENGTH = 3
const RAIN_COLOR = 'rgba(176, 196, 228, 0.6)'
const RAIN_STEP_MS = 66

const rainClockOf = (world: World): number =>
  Math.floor(world.elapsedMs / RAIN_STEP_MS) * RAIN_STEP_MS

const NEAR_X = 360
const NEAR_Y = 260

const isNear = (viewer: Vector, { glass }: Pane): boolean =>
  Math.abs(glass.x + glass.width / 2 - viewer.x) < NEAR_X &&
  Math.abs(glass.y + glass.height / 2 - viewer.y) < NEAR_Y

export const FAR_KEY = 'far'

export const stormKeyOf = ({
  world,
  level,
  viewer,
}: Readonly<{ world: World; level: Level; viewer: Vector }>): string =>
  Array.some(windowPanesOf(level), pane => isNear(viewer, pane))
    ? `${rainClockOf(world)}|${strikeOf(world)}`
    : FAR_KEY

const rollOf = (pane: number, streak: number, use: number): number =>
  unitOf(pane * 7919 + streak * 37 + use)

type Span = Readonly<{ top: number; bottom: number }>

const builtSpans = new WeakMap<Pane, ReadonlyMap<number, ReadonlyArray<Span>>>()

const columnSpansOf = (
  pane: Pane,
): ReadonlyMap<number, ReadonlyArray<Span>> => {
  const cached = builtSpans.get(pane)
  if (cached !== undefined) {
    return cached
  }
  const rows = new Map<number, Array<number>>()
  Array.forEach(pane.lights, ({ x, y, width, height }) => {
    for (let column = x; column < x + width; column += 1) {
      const lit = rows.get(column) ?? []
      for (let row = y; row < y + height; row += 1) {
        lit.push(row)
      }
      rows.set(column, lit)
    }
  })
  const spans = new Map<number, ReadonlyArray<Span>>()
  rows.forEach((lit, column) => {
    const merged: Array<{ top: number; bottom: number }> = []
    Array.forEach(Array.sort(lit, Order.Number), row => {
      const last = merged[merged.length - 1]
      if (last?.bottom === row) {
        last.bottom = row + 1
      } else {
        merged.push({ top: row, bottom: row + 1 })
      }
    })
    spans.set(column, merged)
  })
  builtSpans.set(pane, spans)
  return spans
}

const rainOn = (
  pane: Pane,
  index: number,
  ms: number,
): ReadonlyArray<Draw.Shape> => {
  const { glass } = pane
  const spans = columnSpansOf(pane)
  const count = Math.max(
    1,
    Math.round((glass.width * glass.height) / GLASS_PER_STREAK),
  )
  return Array.flatMap(
    Array.makeBy(count, streak => streak),
    streak => {
      const fallMs = 420 + rollOf(index, streak, 0) * 260
      const age = (ms + rollOf(index, streak, 1) * fallMs) % fallMs
      const fall = Math.floor((ms + rollOf(index, streak, 1) * fallMs) / fallMs)
      const column =
        glass.x +
        Math.floor(rollOf(index, streak * 131 + fall, 2) * glass.width)
      const head =
        glass.y + Math.floor((age / fallMs) * (glass.height + STREAK_LENGTH))
      const start = head - STREAK_LENGTH
      return Array.filterMap(spans.get(column) ?? [], ({ top, bottom }) => {
        const from = Math.max(top, start)
        const end = Math.min(bottom, head)
        return end > from
          ? Result.succeed(rect(column, from, 1, end - from, RAIN_COLOR))
          : Result.failVoid
      })
    },
  )
}

const FLASH_ALPHA = 0.9
const THROWN_ALPHA = 0.32

const flashColor = (alpha: number): string =>
  `rgba(232, 240, 255, ${alpha.toFixed(3)})`

export const paneBoxesOf = ({
  x,
  y,
  width,
  height,
}: Box): ReadonlyArray<Box> => {
  if (width < 6 || height < 6) {
    return [{ x, y, width, height }]
  }
  const left = Math.floor((width - 1) / 2)
  const top = Math.floor((height - 1) / 2)
  const right = width - left - 1
  const bottom = height - top - 1
  return [
    { x, y, width: left, height: top },
    { x: x + left + 1, y, width: right, height: top },
    { x, y: y + top + 1, width: left, height: bottom },
    { x: x + left + 1, y: y + top + 1, width: right, height: bottom },
  ]
}

const thrownShapes = (patch: Box, fill: string): ReadonlyArray<Draw.Shape> =>
  Array.map(paneBoxesOf(patch), box =>
    rect(box.x, box.y, box.width, box.height, fill),
  )

const ROSE_FLASH_SHARE = 0.55

const paneShapes = (
  pane: Pane,
  index: number,
  ms: number,
  strike: number,
): ReadonlyArray<Draw.Shape> => [
  ...rainOn(pane, index, ms),
  ...(strike > 0
    ? Array.map(pane.lights, ({ x, y, width, height }) =>
        rect(
          x,
          y,
          width,
          height,
          flashColor(
            strike *
              FLASH_ALPHA *
              (pane.kind === 'Rose' ? ROSE_FLASH_SHARE : 1),
          ),
        ),
      )
    : []),
]

export const stormOf = ({
  world,
  level,
}: Readonly<{ world: World; level: Level }>): ReadonlyArray<Draw.Shape> => {
  const panes = windowPanesOf(level)
  const strike = strikeOf(world)
  const glass = Array.flatMap(panes, (pane, index) =>
    paneShapes(pane, index, rainClockOf(world), strike),
  )
  const thrown =
    strike > 0
      ? Array.flatMap(
          Array.filter(panes, (pane: Pane) => pane.kind !== 'Rose'),
          (pane: Pane) =>
            thrownShapes(pane.thrown, flashColor(strike * THROWN_ALPHA)),
        )
      : []
  return [...glass, ...thrown]
}

const OVER_WALL = 0.006
const OVER_FLOOR = 0.014

const builtQuads = new WeakMap<Level, ReadonlyArray<ArtQuad>>()

export const stormQuadsOf = (level: Level): ReadonlyArray<ArtQuad> => {
  const cached = builtQuads.get(level)
  if (cached !== undefined) {
    return cached
  }
  const quads = artQuadsOver({
    level,
    boxes: Array.flatMap(windowPanesOf(level), ({ glass, thrown }) => [
      glass,
      thrown,
    ]),
    overWall: OVER_WALL,
    overFloor: OVER_FLOOR,
  })
  builtQuads.set(level, quads)
  return quads
}
