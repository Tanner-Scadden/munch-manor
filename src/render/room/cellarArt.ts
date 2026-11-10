import { Array, Result } from 'effect'
import type { Canvas } from 'foldkit'

import { bakeShapes } from '../../art/sprite'
import { TILE_SIZE } from '../../shared/constants'
import type { Level } from '../../world/level/arena'
import { rect } from '../drawing'
import {
  BASEBOARD_Y,
  type Box,
  FACE_TOP,
  GOLD_COLOR,
  GOLD_DARK_COLOR,
  pick,
  roll,
} from './roomPalette'
import { type Span, northFaceSpans } from './roomWalls'

// NOTE: the cellar: flagstones, rough stone walls, long wine racks, a
// block of barrels with a tap, the coal heap under the chute, and one bare
// bulb on a wire. It is dark in play, from a light mask laid over it, so it
// is drawn here at the same brightness as the other rooms. The bulb is its
// own sprite, so the mask can light around it.

// PALETTE

const MORTAR_COLOR = '#211d1c'
const STONE_SHADES: Array.NonEmptyReadonlyArray<string> = [
  '#4a4642',
  '#45413d',
  '#504b46',
  '#3f3b38',
  '#4c4540',
]
const STONE_EDGE_COLOR = '#5c5752'
const CRACK_COLOR = '#2a2624'
const MOSS_COLOR = 'rgba(80, 110, 50, 0.32)'
const PUDDLE_COLOR = 'rgba(60, 80, 110, 0.35)'
const PUDDLE_SHINE_COLOR = 'rgba(160, 190, 220, 0.3)'
const DIRT_COLOR = 'rgba(40, 28, 18, 0.35)'
const WALL_STONE_SHADES: Array.NonEmptyReadonlyArray<string> = [
  '#3e3a38',
  '#45403c',
  '#383432',
  '#4a4440',
]
const WALL_MORTAR_COLOR = '#262220'
const RACK_COLOR = '#3a2616'
const RACK_LIGHT_COLOR = '#5a3a22'
const CUBBY_COLOR = '#140c08'
const BOTTLE_COLORS: Array.NonEmptyReadonlyArray<string> = [
  '#2a5a3a',
  '#5a1a24',
  '#2a4a30',
  '#4a1420',
]
const BOTTLE_GLINT_COLOR = '#8fbf9a'
const CORK_COLOR = '#c9a06a'
const ODD_BOTTLE_COLOR = '#6a4ac8'
const ODD_BOTTLE_GLINT_COLOR = '#c8b0ff'
const BARREL_COLOR = '#6b4423'
const BARREL_LIGHT_COLOR = '#8a5a2b'
const BARREL_DARK_COLOR = '#4a2e17'
const HOOP_COLOR = '#2a2a30'
const HOOP_LIGHT_COLOR = '#4a4a56'
const WINE_PUDDLE_COLOR = 'rgba(110, 20, 40, 0.45)'
const COAL_COLOR = '#1a1a1e'
const COAL_MID_COLOR = '#2e2e36'
const COAL_LIGHT_COLOR = '#5a5a66'
const WIRE_COLOR = '#16141a'
const SOCKET_COLOR = '#5a5a66'
const BULB_COLOR = '#fff2b0'
const FILAMENT_COLOR = '#ffb84a'

// FLOOR

const STONE_HEIGHT = 8

const stoneRow = (room: Box, row: number): ReadonlyArray<Canvas.Shape> => {
  const y = room.y + row * STONE_HEIGHT
  const widths = Array.makeBy(
    Math.ceil(room.width / 8) + 1,
    index => 8 + Math.floor(roll(row + 1000, index) * 7),
  )
  const starts = Array.scan(
    widths,
    room.x - Math.floor(roll(row, 1001) * 6),
    (at, width) => at + width,
  )
  return Array.flatMap(Array.zip(widths, starts), ([width, start], index) => {
    if (start >= room.x + room.width) {
      return []
    }
    const shade = pick(STONE_SHADES, roll(row + 1002, index))
    const left = Math.max(room.x, start + 1)
    const right = Math.min(room.x + room.width, start + width)
    const height = Math.min(STONE_HEIGHT - 1, room.y + room.height - y - 1)
    return [
      rect(left, y + 1, right - left, height, shade),
      rect(left, y + 1, right - left, 1, STONE_EDGE_COLOR),
      ...(roll(row + 1003, index) < 0.18 && right - left > 7 && height > 4
        ? [
            rect(left + 2, y + 3, 3, 1, CRACK_COLOR),
            rect(left + 4, y + 4, 2, 1, CRACK_COLOR),
          ]
        : []),
    ]
  })
}

export const cellarFloorShapes = (room: Box): ReadonlyArray<Canvas.Shape> => {
  const rows = Math.floor(room.height / STONE_HEIGHT)
  const spot = (index: number, salt: number) => ({
    x: room.x + Math.floor(roll(index, salt) * (room.width - 20)),
    y: room.y + Math.floor(roll(index, salt + 1) * (room.height - 12)),
  })
  return [
    rect(room.x, room.y, room.width, room.height, MORTAR_COLOR),
    ...Array.flatMap(
      Array.makeBy(rows, row => row),
      row => stoneRow(room, row),
    ),
    ...Array.flatMap(
      Array.makeBy(14, index => index),
      index => {
        const { x, y } = spot(index, 1010)
        return [
          rect(x, y, 4 + Math.floor(roll(index, 1012) * 8), 2, MOSS_COLOR),
          rect(x + 2, y + 2, 3, 1, MOSS_COLOR),
        ]
      },
    ),
    ...Array.flatMap(
      Array.makeBy(18, index => index),
      index => {
        const { x, y } = spot(index, 1020)
        return [
          rect(x, y, 6 + Math.floor(roll(index, 1022) * 10), 3, DIRT_COLOR),
        ]
      },
    ),
    ...Array.flatMap(
      Array.makeBy(4, index => index),
      index => {
        const { x, y } = spot(index, 1030)
        return [
          rect(x, y, 12, 4, PUDDLE_COLOR),
          rect(x + 2, y - 1, 8, 6, PUDDLE_COLOR),
          rect(x + 3, y + 1, 3, 1, PUDDLE_SHINE_COLOR),
        ]
      },
    ),
  ]
}

// NOTE: the loose flagstone, a hiding spot, sitting proud of the others with
// a dark gap round it, placed by hand on the drafted map.
export const looseStoneShapes = (room: Box): ReadonlyArray<Canvas.Shape> => {
  const x = room.x + 271
  const y = room.y + 151
  return [
    rect(x - 1, y - 1, 10, 8, '#0e0c0b'),
    rect(x, y - 2, 8, 7, '#55504a'),
    rect(x, y - 2, 8, 1, '#6a645e'),
    rect(x + 7, y - 1, 1, 6, '#3a3632'),
    rect(x + 2, y + 1, 2, 1, CRACK_COLOR),
  ]
}

// NOTE: the coal heap under the chute, a hiding spot, spilling onto the
// flagstones.
export const coalHeapShapes = (room: Box): ReadonlyArray<Canvas.Shape> => {
  const x = room.x + 44
  const y = room.y + 12
  return [
    rect(x - 4, y + 14, 34, 4, 'rgba(10, 10, 12, 0.4)'),
    rect(x + 2, y + 8, 22, 9, COAL_COLOR),
    rect(x + 6, y + 4, 14, 6, COAL_COLOR),
    rect(x + 9, y + 1, 8, 4, COAL_MID_COLOR),
    rect(x - 2, y + 12, 6, 4, COAL_MID_COLOR),
    rect(x + 22, y + 12, 7, 4, COAL_MID_COLOR),
    ...Array.makeBy(16, index =>
      rect(
        x + Math.floor(roll(index, 1040) * 26),
        y + 2 + Math.floor(roll(index, 1041) * 14),
        2,
        1,
        index % 3 === 0 ? COAL_LIGHT_COLOR : COAL_MID_COLOR,
      ),
    ),
    ...Array.makeBy(8, index =>
      rect(
        x - 6 + Math.floor(roll(index, 1042) * 38),
        y + 17 + Math.floor(roll(index, 1043) * 6),
        1,
        1,
        COAL_COLOR,
      ),
    ),
  ]
}

// WALLS

const stoneFaceShapes = ({
  x,
  y,
  width,
}: Span): ReadonlyArray<Canvas.Shape> => {
  const top = y - TILE_SIZE * 2 + FACE_TOP + 2
  const baseY = y - TILE_SIZE * 2 + BASEBOARD_Y
  const courses = Math.ceil((baseY - top) / 4)
  return [
    rect(x, top, width, baseY - top, WALL_MORTAR_COLOR),
    ...Array.flatMap(
      Array.makeBy(courses, course => course),
      course => {
        const courseY = top + course * 4
        const height = Math.min(3, baseY - courseY - 1)
        const offset = course % 2 === 0 ? 0 : 4
        const blocks = Math.ceil((width + offset) / 8)
        return Array.filterMap(
          Array.makeBy(blocks, index => x - offset + index * 8),
          blockX => {
            const left = Math.max(x, blockX)
            const right = Math.min(x + width, blockX + 7)
            return right > left && height > 0
              ? Result.succeed(
                  rect(
                    left,
                    courseY,
                    right - left,
                    height,
                    pick(WALL_STONE_SHADES, roll(blockX, courseY + 1050)),
                  ),
                )
              : Result.failVoid
          },
        )
      },
    ),
    ...Array.makeBy(Math.floor(width / 23), index =>
      rect(
        x + 6 + index * 23,
        top + 4 + Math.floor(roll(index, x + 1060) * 6),
        2,
        3,
        'rgba(80, 110, 50, 0.28)',
      ),
    ),
  ]
}

// NOTE: rough stone over the whole face, from the trim down to the
// baseboard, in place of the paper and wainscot upstairs.
export const cellarWallShapes = (level: Level): ReadonlyArray<Canvas.Shape> =>
  Array.flatMap(northFaceSpans(level), stoneFaceShapes)

// WINE RACKS

const CUBBY = 5

// NOTE: a wine rack along a row of tiles, standing a tile taller than its
// footing: a lattice of cubbies, most with a bottle's end in them.
export const wineRackShapes = ({
  x,
  y,
  width,
}: Box): ReadonlyArray<Canvas.Shape> => {
  const top = y - 10
  const columns = Math.floor(width / CUBBY)
  const rows = 3
  return [
    rect(x, top, width, 20, RACK_COLOR),
    rect(x - 1, top - 1, width + 2, 2, RACK_LIGHT_COLOR),
    ...Array.flatMap(
      Array.makeBy(rows, row => row),
      row =>
        Array.flatMap(
          Array.makeBy(columns, column => column),
          column => {
            const cubbyX = x + column * CUBBY
            const cubbyY = top + 2 + row * CUBBY
            const seed = cubbyX * 3 + cubbyY
            const isEmpty = roll(seed, 1070) < 0.18
            return [
              rect(cubbyX + 1, cubbyY, CUBBY - 1, CUBBY - 1, CUBBY_COLOR),
              ...(isEmpty
                ? []
                : [
                    rect(
                      cubbyX + 1,
                      cubbyY + 1,
                      3,
                      2,
                      pick(BOTTLE_COLORS, roll(seed, 1071)),
                    ),
                    rect(
                      cubbyX + 2,
                      cubbyY,
                      1,
                      3,
                      pick(BOTTLE_COLORS, roll(seed, 1071)),
                    ),
                    rect(
                      cubbyX + 2,
                      cubbyY + 1,
                      1,
                      1,
                      roll(seed, 1072) < 0.5 ? CORK_COLOR : BOTTLE_GLINT_COLOR,
                    ),
                  ]),
            ]
          },
        ),
    ),
    rect(x, top + 2 + rows * CUBBY, width, 2, RACK_LIGHT_COLOR),
    rect(x, top + 4 + rows * CUBBY, width, 1, '#1a110a'),
    rect(x, y + 9, 2, 1, '#1a110a'),
    rect(x + width - 2, y + 9, 2, 1, '#1a110a'),
  ]
}

// NOTE: the bottle that is not wine, a hiding spot in the north-east rack,
// placed by hand on the drafted map: purple, and it glints.
export const oddBottleShapes = (room: Box): ReadonlyArray<Canvas.Shape> => {
  const x = room.x + 276
  const y = room.y + 37
  return [
    rect(x, y, 3, 2, ODD_BOTTLE_COLOR),
    rect(x + 1, y - 1, 1, 3, ODD_BOTTLE_COLOR),
    rect(x + 1, y, 1, 1, ODD_BOTTLE_GLINT_COLOR),
    rect(x - 1, y - 2, 5, 6, 'rgba(160, 120, 255, 0.18)'),
  ]
}

// BARRELS

// NOTE: a barrel's half width down its side, bulging at the middle.
const BARREL_PROFILE: ReadonlyArray<number> = [
  7, 8, 8, 9, 9, 9, 9, 9, 9, 9, 9, 8, 8, 7,
]
const BARREL_LID: ReadonlyArray<number> = [4, 6, 7, 7, 6, 4]

const standingBarrel = (
  barrelX: number,
  barrelY: number,
): ReadonlyArray<Canvas.Shape> => {
  const middle = barrelX + 10
  const sideTop = barrelY + 4
  return [
    ...Array.flatMap(BARREL_PROFILE, (half, row) => [
      rect(middle - half, sideTop + row, half * 2, 1, BARREL_COLOR),
      rect(middle - half, sideTop + row, 2, 1, BARREL_LIGHT_COLOR),
      rect(middle + half - 2, sideTop + row, 2, 1, BARREL_DARK_COLOR),
      rect(middle - 4, sideTop + row, 1, 1, BARREL_DARK_COLOR),
      rect(middle + 3, sideTop + row, 1, 1, BARREL_DARK_COLOR),
    ]),
    ...Array.flatMap([2, 10], row => {
      const half = BARREL_PROFILE[row] ?? 8
      return [
        rect(middle - half, sideTop + row, half * 2, 2, HOOP_COLOR),
        rect(middle - half, sideTop + row, half * 2, 1, HOOP_LIGHT_COLOR),
      ]
    }),
    ...Array.map(BARREL_LID, (half, row) =>
      rect(
        middle - half,
        barrelY - 1 + row,
        half * 2,
        1,
        row === 0 || row === BARREL_LID.length - 1
          ? HOOP_COLOR
          : BARREL_LIGHT_COLOR,
      ),
    ),
    rect(middle - 5, barrelY + 2, 10, 1, BARREL_COLOR),
    rect(middle - 1, barrelY, 1, 4, BARREL_COLOR),
    rect(middle + 3, barrelY + 1, 2, 1, HOOP_COLOR),
  ]
}

// NOTE: four barrels standing in a block, the back two first, with a tap
// in the east one dripping wine on the floor (a hiding spot), and a candle
// stub on one lid.
export const barrelsShapes = ({
  x,
  y,
  width,
  height,
}: Box): ReadonlyArray<Canvas.Shape> => {
  const half = Math.floor(width / 2)
  const backY = y
  const frontY = y + Math.floor(height / 2)
  return [
    ...standingBarrel(x, backY),
    ...standingBarrel(x + half, backY),
    ...standingBarrel(x, frontY),
    ...standingBarrel(x + half, frontY),
    rect(x + width - 2, frontY + 9, 4, 2, GOLD_DARK_COLOR),
    rect(x + width + 1, frontY + 7, 1, 4, GOLD_COLOR),
    rect(x + width + 1, frontY + 11, 1, 1, '#7a2338'),
    rect(x + width, frontY + 16, 7, 3, WINE_PUDDLE_COLOR),
    rect(x + width + 1, frontY + 15, 4, 1, WINE_PUDDLE_COLOR),
    rect(x + 5, backY - 4, 2, 3, '#efe6d2'),
    rect(x + 5, backY - 5, 2, 1, '#ffd23f'),
    rect(x + 3, backY - 8, 6, 6, 'rgba(255, 210, 63, 0.1)'),
  ]
}

// THE BULB

// NOTE: the one bare bulb: its wire up into the dark, the socket, the glass
// with its glowing filament, and a soft halo. Its pool on the floor is the
// light mask's to draw. Drawn about the bulb's own middle.
export const CELLAR_BULB_SHAPES: ReadonlyArray<Canvas.Shape> = [
  rect(-9, -9, 19, 19, 'rgba(255, 230, 150, 0.06)'),
  rect(-6, -6, 13, 13, 'rgba(255, 230, 150, 0.08)'),
  rect(0, -40, 1, 35, WIRE_COLOR),
  rect(-1, -6, 3, 3, SOCKET_COLOR),
  rect(-1, -6, 1, 3, '#7a7a86'),
  rect(-2, -3, 5, 4, BULB_COLOR),
  rect(-1, 1, 3, 1, BULB_COLOR),
  rect(-1, -2, 3, 1, FILAMENT_COLOR),
  rect(-2, -3, 1, 1, '#ffffff'),
]

// NOTE: the bulb's sprite, built once; its rectangles above are for a room
// image that bakes it in with everything else (the studio's preview).
export const CELLAR_BULB_SPRITE: ReadonlyArray<Canvas.Shape> =
  bakeShapes(CELLAR_BULB_SHAPES)
