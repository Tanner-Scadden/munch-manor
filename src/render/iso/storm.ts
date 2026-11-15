// The storm at the windows: rain running down every pane the house has,
// each pane flashing white as the lightning strikes, and the strike's light
// thrown through it onto the floor, window-shaped. Read off the World's
// clock and the level alone, like the mood's strikes (mood.ts), so every
// player in a co-op room sees the same rain.

import { Array, Result } from 'effect'
import type { Canvas } from 'foldkit'

import { TILE_SIZE } from '../../shared/constants'
import type { Level } from '../../world/level/arena'
import type { Vector } from '../../world/schema/entitySchema'
import type { World } from '../../world/schema/worldSchema'
import { rect } from '../drawing'
import type { Box } from '../room/roomPalette'
import { type Pane, windowPanesOf } from '../room/windows'
import type { TileQuad } from './house'
import { strikeOf, unitOf } from './mood'
import { wallHeightAt } from './space'

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

const rainOn = (
  glass: Box,
  pane: number,
  ms: number,
): ReadonlyArray<Canvas.Shape> => {
  const count = Math.max(
    1,
    Math.round((glass.width * glass.height) / GLASS_PER_STREAK),
  )
  const bottom = glass.y + glass.height
  return Array.filterMap(
    Array.makeBy(count, streak => streak),
    streak => {
      const fallMs = 420 + rollOf(pane, streak, 0) * 260
      const age = (ms + rollOf(pane, streak, 1) * fallMs) % fallMs
      // NOTE: each fall of a streak runs down its own column.
      const fall = Math.floor((ms + rollOf(pane, streak, 1) * fallMs) / fallMs)
      const column =
        glass.x + Math.floor(rollOf(pane, streak * 131 + fall, 2) * glass.width)
      const head =
        glass.y + Math.floor((age / fallMs) * (glass.height + STREAK_LENGTH))
      const top = Math.max(glass.y, head - STREAK_LENGTH)
      const end = Math.min(bottom, head)
      return end > top
        ? Result.succeed(rect(column, top, 1, end - top, RAIN_COLOR))
        : Result.failVoid
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

const thrownShapes = (patch: Box, fill: string): ReadonlyArray<Canvas.Shape> =>
  Array.map(paneBoxesOf(patch), box =>
    rect(box.x, box.y, box.width, box.height, fill),
  )

const paneShapes = (
  { glass }: Pane,
  pane: number,
  ms: number,
  strike: number,
): ReadonlyArray<Canvas.Shape> => [
  ...rainOn(glass, pane, ms),
  ...(strike > 0
    ? [
        rect(
          glass.x,
          glass.y,
          glass.width,
          glass.height,
          flashColor(strike * FLASH_ALPHA),
        ),
      ]
    : []),
]

// NOTE: the storm this frame, in game pixels on the level's picture. The
// glass up on a back wall's face shows on the 3D wall's top, and the glass
// in a side wall's gap and the thrown light show on the floor.
export const stormOf = ({
  world,
  level,
}: Readonly<{ world: World; level: Level }>): ReadonlyArray<Canvas.Shape> => {
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

// NOTE: the storm's quads sit just over what they lie on: a wall's top
// (over its art, at 0.002) or the floor (over the ground's glows, at 0.012).
const OVER_WALL = 0.006
const OVER_FLOOR = 0.014

// NOTE: a quad over every tile any of `boxes` touches, once each, lying
// just over what it lies on: a wall's top or the floor.
export const tileQuadsOver = (
  input: Readonly<{
    level: Level
    boxes: ReadonlyArray<Box>
    overWall: number
    overFloor: number
  }>,
): ReadonlyArray<TileQuad> => {
  const { level, boxes, overWall, overFloor } = input
  const keys = new Set<string>()
  const tiles: Array<TileQuad> = []
  Array.forEach(boxes, ({ x, y, width, height }) => {
    const left = Math.floor((x - level.left) / TILE_SIZE)
    const right = Math.floor((x + width - 1 - level.left) / TILE_SIZE)
    const top = Math.floor((y - level.top) / TILE_SIZE)
    const bottom = Math.floor((y + height - 1 - level.top) / TILE_SIZE)
    for (let row = top; row <= bottom; row += 1) {
      for (let column = left; column <= right; column += 1) {
        const key = `${row},${column}`
        if (!keys.has(key)) {
          keys.add(key)
          const wall = wallHeightAt({ tiles: level.tiles, row, column })
          tiles.push({
            row,
            column,
            y: wall > 0 ? wall + overWall : overFloor,
          })
        }
      }
    }
  })
  return tiles
}

const builtTiles = new WeakMap<Level, ReadonlyArray<TileQuad>>()

// NOTE: every tile the storm can show on, a quad each: the glass and the
// floor its light falls on, and nowhere else, so the layer costs the screen
// next to nothing.
export const stormTilesOf = (level: Level): ReadonlyArray<TileQuad> => {
  const cached = builtTiles.get(level)
  if (cached !== undefined) {
    return cached
  }
  const tiles = tileQuadsOver({
    level,
    boxes: Array.flatMap(windowPanesOf(level), ({ glass, thrown }) => [
      glass,
      thrown,
    ]),
    overWall: OVER_WALL,
    overFloor: OVER_FLOOR,
  })
  builtTiles.set(level, tiles)
  return tiles
}
