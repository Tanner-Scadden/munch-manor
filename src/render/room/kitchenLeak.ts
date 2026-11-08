import { Array, Option } from 'effect'
import type { Canvas } from 'foldkit'

import { TILE_SIZE } from '../../shared/constants'
import { type Level, levelOf, maybeExit } from '../../world/level/arena'
import { KITCHEN_EXIT } from '../../world/level/exits'
import type { World } from '../../world/schema/world'
import { rect } from '../drawing'
import { type Box, FACE_TOP, boundingBox } from './roomPalette'

// NOTE: from the owner (2026-11-01), players were not finding the kitchen,
// so the boarded door leaks what is behind it: a warm crack of light down
// the middle, a glimpse of the kitchen floor under the boards, light on
// the floor outside, and wisps of steam. The still pieces are part of the
// room's baked image (leakStillShapes, drawn with the boards in
// src/render/room/roomWalls.ts); only the light's flicker and the steam move
// (kitchenLeakShapes), a few rectangles a frame. All of it goes with the
// boards: an open exit draws the kitchen's own look.
export const isFacedExit = (box: Box): boolean =>
  box.y === 0 && box.height === TILE_SIZE * 2

const LIGHT_COLOR = '#ffcf7a'
const HALO_COLOR = 'rgba(255, 190, 110, 0.32)'
const SPILL_NEAR_COLOR = 'rgba(255, 200, 120, 0.3)'
const SPILL_MID_COLOR = 'rgba(255, 200, 120, 0.22)'
const SPILL_FAR_COLOR = 'rgba(255, 200, 120, 0.15)'
const SPILL_EDGE_COLOR = 'rgba(255, 200, 120, 0.09)'
const SPILL_FADE_COLOR = 'rgba(255, 200, 120, 0.05)'
const GLIMPSE_LIT_COLOR = '#c9a468'
const GLIMPSE_DARK_COLOR = '#7a6340'
const GLIMPSE_EDGE_COLOR = '#ffe0a0'
const PEEK_COLOR = '#d9a24f'
const CHECK_PX = 2

const topOf = FACE_TOP + 2

const checkRow = (
  box: Box,
  y: number,
  startsLit: boolean,
): ReadonlyArray<Canvas.Shape> => {
  const left = box.x + 1
  const columns = Math.floor((box.width - 2) / CHECK_PX)
  return Array.makeBy(columns, column =>
    rect(
      left + column * CHECK_PX,
      y,
      CHECK_PX,
      1,
      (column % 2 === 0) === startsLit ? GLIMPSE_LIT_COLOR : GLIMPSE_DARK_COLOR,
    ),
  )
}

// NOTE: laid on the door's dark fill and under its planks and sign, so
// the light and the floor show only in the gaps they leave.
export const leakStillShapes = (box: Box): ReadonlyArray<Canvas.Shape> => {
  const middle = box.x + box.width / 2
  const bottom = box.y + box.height
  return [
    rect(middle - 1, topOf + 2, 3, bottom - topOf - 2, HALO_COLOR),
    rect(middle, topOf + 2, 1, bottom - topOf - 2, LIGHT_COLOR),
    rect(box.x + 2, topOf + 5, 1, 4, PEEK_COLOR),
    rect(box.x + box.width - 3, topOf + 5, 1, 4, PEEK_COLOR),
    ...checkRow(box, bottom - 3, true),
    ...checkRow(box, bottom - 2, false),
    ...checkRow(box, bottom - 1, true),
    rect(box.x + 1, bottom - 3, box.width - 2, 1, GLIMPSE_EDGE_COLOR),
  ]
}

// NOTE: the light on the floor just outside, three steps fading out.
export const leakSpillShapes = (box: Box): ReadonlyArray<Canvas.Shape> => {
  const bottom = box.y + box.height
  return [
    rect(box.x - 2, bottom, box.width + 4, 1, SPILL_NEAR_COLOR),
    rect(box.x - 2, bottom + 1, box.width + 4, 1, SPILL_MID_COLOR),
    rect(box.x - 1, bottom + 2, box.width + 2, 1, SPILL_FAR_COLOR),
    rect(box.x, bottom + 3, box.width, 1, SPILL_EDGE_COLOR),
    rect(box.x + 2, bottom + 4, box.width - 4, 1, SPILL_FADE_COLOR),
    rect(box.x + 4, bottom + 5, box.width - 8, 1, SPILL_FADE_COLOR),
  ]
}

// MOTION

const STRIP_GAP_PX = 3
const FLICKER_MS = 170
const STEAM_MS = 3200
const STEAM_WISPS = 4
const STEAM_RISE_PX = 17
const STEAM_COLUMNS = [3, 7, 12, 16]

const flickerOf = (elapsedMs: number): number => {
  const beat = Math.floor(elapsedMs / FLICKER_MS)
  return 0.5 + 0.5 * Math.sin(beat * 2.3) * Math.cos(beat * 0.7)
}

const wispShape = (box: Box, index: number, elapsedMs: number) => {
  const phase = (elapsedMs / STEAM_MS + index / STEAM_WISPS) % 1
  const bottom = box.y + box.height
  const column = Option.getOrElse(Array.get(STEAM_COLUMNS, index), () => 8)
  const sway = Math.round(Math.sin(phase * 6 + index * 1.7) * 2)
  const alpha = (0.5 * Math.sin(phase * Math.PI)).toFixed(2)
  return rect(
    box.x + column + sway,
    Math.round(bottom + 9 - phase * STEAM_RISE_PX),
    phase > 0.5 ? 3 : 2,
    2,
    `rgba(236, 232, 220, ${alpha})`,
  )
}

const closedKitchenBox = (level: Level): Option.Option<Box> =>
  Option.filter(
    Option.flatMap(
      Option.filter(maybeExit(level, KITCHEN_EXIT), ({ isOpen }) => !isOpen),
      ({ tiles }) =>
        tiles.length > 0 ? Option.some(boundingBox(tiles)) : Option.none(),
    ),
    isFacedExit,
  )

// NOTE: the HUD strip along the top (src/screens/game/hud.ts) would dim the boards, which
// sit right under it, so it leaves a gap over them: the boards' span in
// world x, while they are up.
export const maybeLeakSpan = (
  model: World,
): Option.Option<Readonly<{ left: number; right: number }>> =>
  Option.map(closedKitchenBox(levelOf(model)), box => ({
    left: box.x - STRIP_GAP_PX,
    right: box.x + box.width + STRIP_GAP_PX,
  }))

// NOTE: the light breathing and the steam rising, only while the boards are
// up. A frame's cost is a handful of rectangles.
export const kitchenLeakShapes = (model: World): ReadonlyArray<Canvas.Shape> =>
  Option.match(closedKitchenBox(levelOf(model)), {
    onNone: () => [],
    onSome: box => {
      const bottom = box.y + box.height
      const flicker = flickerOf(model.elapsedMs)
      return [
        rect(
          box.x - 4,
          bottom,
          box.width + 8,
          7,
          `rgba(255, 196, 110, ${(0.03 + flicker * 0.06).toFixed(2)})`,
        ),
        ...Array.makeBy(STEAM_WISPS, index =>
          wispShape(box, index, model.elapsedMs),
        ),
      ]
    },
  })
