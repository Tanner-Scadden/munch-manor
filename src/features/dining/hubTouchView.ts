import { Array, Option } from 'effect'
import type { Canvas } from 'foldkit'

import type { Model } from '../../app/model'
import { type Sprite, bakeShapes, placeAt } from '../../art/sprite'
import { rect } from '../../render/drawing'
import { TILE_SIZE } from '../../shared/constants'
import { type Level, levelOf } from '../../world/level/arena'
import {
  CELLAR_ROOM_ID,
  DINING_ROOM_ID,
  KITCHEN_ROOM_ID,
  LIBRARY_ROOM_ID,
  PARLOUR_ROOM_ID,
} from '../../world/level/plan'
import type { Vector } from '../../world/schema/worldSchema'

// The hub's touches (docs/ROOM_RESEARCH.md, "Decided", owner 2026-11-10:
// "opening a room adds small touches to the hub"): each room opened leaves
// a small sign of itself in the dining room, so the hub reads how far the
// house has woken. Cosmetic only, read off which rooms stand open, so the
// World and the wire carry nothing new.
//
// - The kitchen: the dumbwaiter's other end, a hatch in the sideboard with
//   its tray up.
// - The library: a stack of borrowed books on the sideboard.
// - The parlour: its music, notes drifting in faintly from its side of the
//   dining room.
// - The cellar: a cold draft, a cobweb in the corner and dust drifting in
//   from its side.

// NOTE: where the touches sit, in the dining room's own tiles
// (src/world/level/plan.ts, DINING_MAP): the sideboard runs along the north
// wall, columns 13 to 22 of row 2; the cobweb hangs in the north-east
// corner; a slot room's sounds come in at its side's boards.
const SIDEBOARD_HATCH = { column: 15, row: 2 }
const SIDEBOARD_BOOKS = { column: 20, row: 2 }
const COBWEB_CORNER = { column: 35, row: 2 }
const WEST_BOARDS = { column: 1, row: 13 }
const EAST_BOARDS = { column: 35, row: 9 }

const NOTE_CYCLE_MS = 3600
const NOTE_RISE_PX = 22
const NOTE_DRIFT_PX = 10
const MOTE_CYCLE_MS = 5200
const MOTE_DRIFT_PX = 46

const pointOf = (
  dining: Vector,
  tile: Readonly<{ column: number; row: number }>,
): Vector => ({
  x: dining.x + tile.column * TILE_SIZE,
  y: dining.y + tile.row * TILE_SIZE,
})

const HATCH: Sprite = bakeShapes([
  // NOTE: the hatch's frame and its dark shaft, on the sideboard's face.
  rect(0, 1, 8, 8, '#3e2210'),
  rect(1, 2, 6, 6, '#120a05'),
  rect(1, 2, 6, 1, '#b8b8c0'),
  rect(1, 3, 6, 1, '#6a6a74'),
  rect(3, 0, 2, 1, '#d8b04a'),
  rect(8, 1, 1, 8, '#c9a66b'),
])

const BOOKS: Sprite = bakeShapes([
  rect(0, 5, 8, 2, '#3f6b3a'),
  rect(1, 3, 7, 2, '#a8322c'),
  rect(0, 1, 6, 2, '#34507a'),
  rect(7, 3, 1, 2, '#efe2c0'),
  rect(6, 1, 1, 2, '#efe2c0'),
])

const COBWEB: Sprite = bakeShapes([
  rect(-1, 0, 1, 7, 'rgba(230, 230, 240, 0.55)'),
  rect(-7, 0, 7, 1, 'rgba(230, 230, 240, 0.55)'),
  rect(-2, 1, 1, 1, 'rgba(230, 230, 240, 0.5)'),
  rect(-3, 2, 1, 1, 'rgba(230, 230, 240, 0.45)'),
  rect(-4, 3, 1, 1, 'rgba(230, 230, 240, 0.4)'),
  rect(-5, 1, 1, 1, 'rgba(230, 230, 240, 0.35)'),
  rect(-1, 4, 1, 1, 'rgba(230, 230, 240, 0.35)'),
  rect(-4, 1, 3, 1, 'rgba(230, 230, 240, 0.3)'),
  rect(-1, 1, 1, 3, 'rgba(230, 230, 240, 0.3)'),
])

// NOTE: an eighth note and a pair of beamed ones, faint gold.
const NOTES: Array.NonEmptyReadonlyArray<Sprite> = [
  bakeShapes([
    rect(2, 0, 1, 4, 'rgba(255, 230, 128, 0.7)'),
    rect(0, 3, 2, 2, 'rgba(255, 230, 128, 0.7)'),
    rect(3, 1, 1, 1, 'rgba(255, 230, 128, 0.7)'),
  ]),
  bakeShapes([
    rect(2, 0, 4, 1, 'rgba(255, 230, 128, 0.7)'),
    rect(2, 0, 1, 4, 'rgba(255, 230, 128, 0.7)'),
    rect(5, 0, 1, 4, 'rgba(255, 230, 128, 0.7)'),
    rect(0, 3, 2, 2, 'rgba(255, 230, 128, 0.7)'),
    rect(3, 3, 2, 2, 'rgba(255, 230, 128, 0.7)'),
  ]),
]

const MOTE_COLOR = 'rgba(210, 220, 235, 0.6)'

const MOTES: Sprite = bakeShapes([
  rect(0, 0, 1, 1, MOTE_COLOR),
  rect(-6, 3, 1, 1, MOTE_COLOR),
  rect(-12, 7, 1, 1, MOTE_COLOR),
  rect(-17, 2, 1, 1, MOTE_COLOR),
])

// NOTE: the same puff trailing the other way, for dust drifting west.
const MOTES_WEST: Sprite = bakeShapes([
  rect(0, 0, 1, 1, MOTE_COLOR),
  rect(6, 3, 1, 1, MOTE_COLOR),
  rect(12, 7, 1, 1, MOTE_COLOR),
  rect(17, 2, 1, 1, MOTE_COLOR),
])

const maybeRoom = (level: Level, id: string) =>
  Array.findFirst(level.rooms, room => room.id === id)

const isOpen = (level: Level, id: string): boolean =>
  Option.exists(maybeRoom(level, id), room => room.isOpen)

// NOTE: a slot room's side of the dining room: its boards on the west wall
// for the west slot, on the east wall for the east and far slots.
const sideOf = (level: Level, id: string, dining: Vector): Vector =>
  pointOf(
    dining,
    Option.exists(maybeRoom(level, id), room => room.box.left < dining.x)
      ? WEST_BOARDS
      : EAST_BOARDS,
  )

// NOTE: inward from a side, toward the middle of the dining room.
const inwardOf = (side: Vector, dining: Vector): number =>
  side.x < dining.x + 18 * TILE_SIZE ? 1 : -1

// NOTE: one note at a time, a single and then a beamed pair, rising and
// drifting in, gone for the last part of its cycle: one shape at most, so
// the frame stays cheap.
const noteShapes = (
  side: Vector,
  inward: number,
  elapsedMs: number,
): ReadonlyArray<Canvas.Shape> => {
  const cycle = Math.floor(elapsedMs / NOTE_CYCLE_MS)
  const phase = (elapsedMs % NOTE_CYCLE_MS) / NOTE_CYCLE_MS
  return phase > 0.85
    ? []
    : Array.fromOption(
        Option.map(Array.get(NOTES, cycle % NOTES.length), note =>
          placeAt(
            Math.round(side.x + inward * (4 + phase * NOTE_DRIFT_PX)),
            Math.round(side.y - phase * NOTE_RISE_PX + Math.sin(phase * 9) * 2),
            note,
          ),
        ),
      )
}

// NOTE: the dust as one baked puff of motes drifting in together.
const moteShapes = (
  side: Vector,
  inward: number,
  elapsedMs: number,
): ReadonlyArray<Canvas.Shape> => {
  const phase = (elapsedMs % MOTE_CYCLE_MS) / MOTE_CYCLE_MS
  return [
    placeAt(
      Math.round(side.x + inward * phase * MOTE_DRIFT_PX),
      Math.round(side.y + 6 + Math.sin(phase * 7) * 2),
      inward > 0 ? MOTES : MOTES_WEST,
    ),
  ]
}

// NOTE: on the ground layer: every touch of every room opened so far.
export const hubTouchShapes = (model: Model): ReadonlyArray<Canvas.Shape> => {
  const level = levelOf(model)
  return Option.match(maybeRoom(level, DINING_ROOM_ID), {
    onNone: () => [],
    onSome: ({ box }) => {
      const dining = { x: box.left, y: box.top }
      const parlourSide = sideOf(level, PARLOUR_ROOM_ID, dining)
      const cellarSide = sideOf(level, CELLAR_ROOM_ID, dining)
      return [
        ...(isOpen(level, KITCHEN_ROOM_ID)
          ? [
              placeAt(
                pointOf(dining, SIDEBOARD_HATCH).x,
                pointOf(dining, SIDEBOARD_HATCH).y,
                HATCH,
              ),
            ]
          : []),
        ...(isOpen(level, LIBRARY_ROOM_ID)
          ? [
              placeAt(
                pointOf(dining, SIDEBOARD_BOOKS).x,
                pointOf(dining, SIDEBOARD_BOOKS).y,
                BOOKS,
              ),
            ]
          : []),
        ...(isOpen(level, PARLOUR_ROOM_ID)
          ? noteShapes(
              parlourSide,
              inwardOf(parlourSide, dining),
              model.elapsedMs,
            )
          : []),
        ...(isOpen(level, CELLAR_ROOM_ID)
          ? [
              placeAt(
                pointOf(dining, COBWEB_CORNER).x,
                pointOf(dining, COBWEB_CORNER).y,
                COBWEB,
              ),
              ...moteShapes(
                cellarSide,
                inwardOf(cellarSide, dining),
                model.elapsedMs,
              ),
            ]
          : []),
      ]
    },
  })
}
