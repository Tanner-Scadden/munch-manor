import { Array, Option } from 'effect'

import type { Model } from '../../app/model'
import {
  type Sprite,
  TOP_LEFT,
  bakeShapes,
  deepSprite,
  glowingSprite,
  placeAt,
  spriteShapes,
} from '../../art/sprite'
import { type Drawable, IN_FRONT_PX } from '../../render/depth'
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
//
// Each stands carved in the 3D world, where it is: on the sideboard, high in
// the corner, in the air.

// NOTE: where the touches stand, in pixels from the dining room's top left
// (src/world/level/plan.ts, DINING_MAP). The sideboard runs along the north
// wall, columns 13 to 22 of row 2, its foot on row 3's top edge
// (src/render/room/diningArt.ts): the hatch sits on its face over its
// second door, nearer than its carve reaches (`IN_FRONT_PX`), and the
// borrowed books stand in a pile on the floor just past its east end, clear
// of the silver on its top and Uncle Chunk's portrait over it. The cobweb
// hangs high in the north-east corner, against the east wall: a standing
// sprite's upper pixels lean back along the lens's ray, so its top row is
// the highest the north wall's face shows (row 11), and its foot is far
// enough south (row 33) that even that top row stands just in front of the
// face. A slot room's sounds come in at its side's boards, in the air.
const SIDEBOARD_FOOT_Y = 3 * TILE_SIZE
const HATCH_SPOT = { x: 155, y: 19, footY: SIDEBOARD_FOOT_Y + IN_FRONT_PX }
const BOOKS_HEIGHT = 11
const BOOKS_SPOT = {
  x: 233,
  y: SIDEBOARD_FOOT_Y - BOOKS_HEIGHT,
  footY: SIDEBOARD_FOOT_Y,
}
const COBWEB_SPOT = { x: 35 * TILE_SIZE, y: 11, footY: 33 }
const WEST_BOARDS = { column: 1, row: 13 }
const EAST_BOARDS = { column: 35, row: 9 }

const NOTE_CYCLE_MS = 3600
const NOTE_RISE_PX = 10
const NOTE_DRIFT_PX = 10
// NOTE: the notes come in a couple of tiles past the boards, so they rise
// clear of the display case standing just in front of the west boards
// (DINING_MAP's `c` on row 15), never half hidden behind its top.
const NOTE_IN_PX = 22
// NOTE: the notes come in about head high and rise to the walls' tops.
const NOTE_LIFT_PX = 8
const MOTE_CYCLE_MS = 5200
const MOTE_DRIFT_PX = 46
// NOTE: the dust drifts in about knee high.
const MOTE_LIFT_PX = 8

const pointOf = (
  dining: Vector,
  tile: Readonly<{ column: number; row: number }>,
): Vector => ({
  x: dining.x + tile.column * TILE_SIZE,
  y: dining.y + tile.row * TILE_SIZE,
})

// NOTE: every touch stands carved, a block or so deep: the hatch flush on
// the sideboard's face, the books a little box of a stack, the web, the
// notes, and the dust a block thin.
const HATCH: Sprite = deepSprite(
  bakeShapes([
    // NOTE: the hatch's frame and its dark shaft, the tray up in it.
    rect(0, 1, 8, 8, '#3e2210'),
    rect(1, 2, 6, 6, '#120a05'),
    rect(1, 2, 6, 1, '#b8b8c0'),
    rect(1, 3, 6, 1, '#6a6a74'),
    rect(3, 0, 2, 1, '#d8b04a'),
    rect(8, 1, 1, 8, '#c9a66b'),
  ]),
  { most: 1 },
)

// NOTE: four library books piled crooked, their pages' edges showing.
const PAGES_COLOR = '#efe2c0'

const BOOKS: Sprite = deepSprite(
  bakeShapes([
    rect(0, 9, 8, 2, '#3f6b3a'),
    rect(0, 9, 1, 2, PAGES_COLOR),
    rect(1, 7, 7, 2, '#a8322c'),
    rect(7, 7, 1, 2, PAGES_COLOR),
    rect(0, 5, 7, 2, '#34507a'),
    rect(6, 5, 1, 2, PAGES_COLOR),
    rect(1, 3, 6, 2, '#7a5226'),
    rect(1, 3, 1, 2, PAGES_COLOR),
  ]),
  { most: 5, isBox: true },
)

// NOTE: solid strands, so every one carves (a pixel under half opacity
// carves to nothing): the two long ones pale, the inner ones dimmer.
const WEB_COLOR = '#c8c8d4'
const WEB_DIM_COLOR = '#8e8e9c'

const COBWEB: Sprite = deepSprite(
  bakeShapes([
    rect(-1, 0, 1, 7, WEB_COLOR),
    rect(-7, 0, 7, 1, WEB_COLOR),
    rect(-2, 1, 1, 1, WEB_COLOR),
    rect(-3, 2, 1, 1, WEB_DIM_COLOR),
    rect(-4, 3, 1, 1, WEB_DIM_COLOR),
    rect(-5, 1, 1, 1, WEB_DIM_COLOR),
    rect(-1, 4, 1, 1, WEB_DIM_COLOR),
    rect(-4, 1, 3, 1, WEB_DIM_COLOR),
    rect(-1, 1, 1, 3, WEB_DIM_COLOR),
  ]),
  { most: 1 },
)

// NOTE: an eighth note and a quarter note in gold, glowing of themselves,
// each a filled oval head tilted the way a written one is, with a pale
// glint, a stem a pixel wide off its right side, and the eighth's flag
// curling off the stem's top, so each reads as a note at a pixel a block.
const NOTE_PALETTE = { G: '#ffe680', L: '#fff8d6' }

const noteSprite = (pixels: ReadonlyArray<string>): Sprite =>
  glowingSprite(
    deepSprite(spriteShapes(pixels, NOTE_PALETTE, TOP_LEFT), { most: 1 }),
  )

const NOTES: Array.NonEmptyReadonlyArray<Sprite> = [
  noteSprite([
    '...G..',
    '...GGG',
    '...G.G',
    '...G.G',
    '...G..',
    '.LGG..',
    'GGGG..',
    'GGG...',
  ]),
  noteSprite(['...G', '...G', '...G', '...G', '...G', '.LGG', 'GGGG', 'GGG.']),
]

const MOTE_COLOR = '#c4ccd8'

const MOTES: Sprite = deepSprite(
  bakeShapes([
    rect(0, 0, 1, 1, MOTE_COLOR),
    rect(-6, 3, 1, 1, MOTE_COLOR),
    rect(-12, 7, 1, 1, MOTE_COLOR),
    rect(-17, 2, 1, 1, MOTE_COLOR),
  ]),
  { most: 1 },
)

// NOTE: the same puff trailing the other way, for dust drifting west.
const MOTES_WEST: Sprite = deepSprite(
  bakeShapes([
    rect(0, 0, 1, 1, MOTE_COLOR),
    rect(6, 3, 1, 1, MOTE_COLOR),
    rect(12, 7, 1, 1, MOTE_COLOR),
    rect(17, 2, 1, 1, MOTE_COLOR),
  ]),
  { most: 1 },
)

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

const fixedAt = (
  dining: Vector,
  spot: Readonly<{ x: number; y: number; footY: number }>,
  sprite: Sprite,
): Drawable => ({
  footY: dining.y + spot.footY,
  rank: 'Prop',
  shapes: [placeAt(dining.x + spot.x, dining.y + spot.y, sprite)],
})

// NOTE: one note at a time, an eighth and then a quarter, rising through
// the air from its side's boards and drifting in, gone for the last part of
// its cycle: one piece at most, so the frame stays cheap.
const noteDrawables = (
  side: Vector,
  inward: number,
  elapsedMs: number,
): ReadonlyArray<Drawable> => {
  const cycle = Math.floor(elapsedMs / NOTE_CYCLE_MS)
  const phase = (elapsedMs % NOTE_CYCLE_MS) / NOTE_CYCLE_MS
  return phase > 0.85
    ? []
    : Array.fromOption(
        Option.map(
          Array.get(NOTES, cycle % NOTES.length),
          (note): Drawable => ({
            footY: side.y,
            rank: 'Prop',
            shapes: [
              placeAt(
                Math.round(
                  side.x + inward * (NOTE_IN_PX + phase * NOTE_DRIFT_PX),
                ),
                Math.round(
                  side.y -
                    NOTE_LIFT_PX -
                    phase * NOTE_RISE_PX +
                    Math.sin(phase * 9) * 2,
                ),
                note,
              ),
            ],
          }),
        ),
      )
}

// NOTE: the dust as one baked puff of motes drifting in together, in the
// air over the floor.
const moteDrawables = (
  side: Vector,
  inward: number,
  elapsedMs: number,
): ReadonlyArray<Drawable> => {
  const phase = (elapsedMs % MOTE_CYCLE_MS) / MOTE_CYCLE_MS
  return [
    {
      footY: side.y + 6,
      rank: 'Prop',
      shapes: [
        placeAt(
          Math.round(side.x + inward * phase * MOTE_DRIFT_PX),
          Math.round(side.y + 6 - MOTE_LIFT_PX + Math.sin(phase * 7) * 2),
          inward > 0 ? MOTES : MOTES_WEST,
        ),
      ],
    },
  ]
}

// NOTE: standing in the depth sort: every touch of every room opened so far.
export const hubTouchDrawables = (model: Model): ReadonlyArray<Drawable> => {
  const level = levelOf(model)
  return Option.match(maybeRoom(level, DINING_ROOM_ID), {
    onNone: () => [],
    onSome: ({ box }) => {
      const dining = { x: box.left, y: box.top }
      const parlourSide = sideOf(level, PARLOUR_ROOM_ID, dining)
      const cellarSide = sideOf(level, CELLAR_ROOM_ID, dining)
      return [
        ...(isOpen(level, KITCHEN_ROOM_ID)
          ? [fixedAt(dining, HATCH_SPOT, HATCH)]
          : []),
        ...(isOpen(level, LIBRARY_ROOM_ID)
          ? [fixedAt(dining, BOOKS_SPOT, BOOKS)]
          : []),
        ...(isOpen(level, PARLOUR_ROOM_ID)
          ? noteDrawables(
              parlourSide,
              inwardOf(parlourSide, dining),
              model.elapsedMs,
            )
          : []),
        ...(isOpen(level, CELLAR_ROOM_ID)
          ? [
              fixedAt(dining, COBWEB_SPOT, COBWEB),
              ...moteDrawables(
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
