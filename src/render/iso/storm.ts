// The storm at the windows: rain running down every pane the house has,
// each pane flashing white as the lightning strikes, and the strike's light
// thrown through it onto the floor, window-shaped. Read off the World's
// clock and the level alone, like the mood's strikes (mood.ts), so every
// player in a co-op room sees the same rain.

import { Array, Order, Result } from 'effect'

import { unitOf } from '../../shared/prng'
import type { Level } from '../../world/level/arena'
import type { Vector } from '../../world/schema/entitySchema'
import type { World } from '../../world/schema/worldSchema'
import type * as Draw from '../draw'
import { rect } from '../drawing'
import type { Box } from '../room/roomPalette'
import { type Pane, windowPanesOf } from '../room/windows'
import { strikeOf } from './mood'
import { type ArtQuad, artQuadsOver } from './wallQuads'

// RAIN

// NOTE: one streak for each this many pixels of glass, falling the pane's
// height in about half a second.
const GLASS_PER_STREAK = 24
const STREAK_LENGTH = 3
const RAIN_COLOR = 'rgba(176, 196, 228, 0.6)'
// NOTE: the rain moves in steps this long, so its layer is painted again
// only about fifteen times a second.
const RAIN_STEP_MS = 66

const rainClockOf = (world: World): number =>
  Math.floor(world.elapsedMs / RAIN_STEP_MS) * RAIN_STEP_MS

// NOTE: a window this far from the viewer, in game pixels each way, is off
// every screen the game has, so its rain need not move.
const NEAR_X = 360
const NEAR_Y = 260

const isNear = (viewer: Vector, { glass }: Pane): boolean =>
  Math.abs(glass.x + glass.width / 2 - viewer.x) < NEAR_X &&
  Math.abs(glass.y + glass.height / 2 - viewer.y) < NEAR_Y

// NOTE: what the storm's picture depends on: when it is the same as last
// frame's, the picture is too, and its layer need not be painted again.
// With no window near the viewer it is FAR_KEY, whatever the clock.
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

// NOTE: the lit glass down each column of a pane, top to bottom, built once
// per pane: where a streak of rain shows, so it never runs over the rose
// window's lead or past its round edge.
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
      // NOTE: each fall of a streak runs down its own column.
      const fall = Math.floor((ms + rollOf(index, streak, 1) * fallMs) / fallMs)
      const column =
        glass.x +
        Math.floor(rollOf(index, streak * 131 + fall, 2) * glass.width)
      const head =
        glass.y + Math.floor((age / fallMs) * (glass.height + STREAK_LENGTH))
      const start = head - STREAK_LENGTH
      // NOTE: a column holds a few runs of glass at most (the rose
      // window's, between its lead), so this walks no more than those.
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

// LIGHTNING

const FLASH_ALPHA = 0.9
const THROWN_ALPHA = 0.32

const flashColor = (alpha: number): string =>
  `rgba(232, 240, 255, ${alpha.toFixed(3)})`

// NOTE: a patch of window light cut by the window's cross into its four
// panes, where it is big enough to show one.
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

// NOTE: the rose window's colored glass flashes softer than clear glass,
// so its colors still read through the strike.
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

// NOTE: the storm this frame, in game pixels on the level's picture. The
// glass up on a back wall's face shows on the 3D wall's top, and the glass
// in a side wall's gap and the thrown light show on the floor.
export const stormOf = ({
  world,
  level,
}: Readonly<{ world: World; level: Level }>): ReadonlyArray<Draw.Shape> => {
  const panes = windowPanesOf(level)
  const strike = strikeOf(world)
  const glass = Array.flatMap(panes, (pane, index) =>
    paneShapes(pane, index, rainClockOf(world), strike),
  )
  // NOTE: the rose window throws its strike in its own colors (godRays.ts).
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

// WHERE IT SHOWS

// NOTE: the storm's quads sit just over what they lie on: a wall's art
// (over it, at 0.002 up a face or over a top) or the floor (over the
// ground's glows, at 0.012).
const OVER_WALL = 0.006
const OVER_FLOOR = 0.014

const builtQuads = new WeakMap<Level, ReadonlyArray<ArtQuad>>()

// NOTE: every quad the storm can show on: the walls' art the glass is in,
// up a face or over a top, and the floor its light falls on, and nowhere
// else, so the layer costs the screen next to nothing.
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
