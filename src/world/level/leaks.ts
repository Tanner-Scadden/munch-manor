import { Array, Function, Option, Order } from 'effect'

import { PLAYER_FOOT_OFFSET, TILE_SIZE } from '../../shared/constants'
import { unitOf } from '../../shared/prng'
import type { Vector } from '../schema/entitySchema'
import { clamp } from '../step/geometry'
import {
  type Level,
  TILE_DOOR,
  TILE_PLAYER_SOLID,
  TILE_SOLID,
  hasTileFlag,
} from './arena'
import { CELLAR_ROOM_ID } from './plan'
import { type Rug, rugsOf } from './rugs'
import { isInsideRoom, symbolAt, tileIndex } from './tileGrid'
import { tileIndexAt } from './tileQueries'

// The roof leaks: the storm finds a few holes over every open room, each
// dripping into a puddle on the floor. The spots are rolled off each room's
// map, on plain floor clear of cover, rugs, doorways, and narrow ways, the
// same in every level the room is part of. Wading through one is slow: a
// player or a zombie whose feet are in the water walks at WADE_PACE, so a
// puddle is a place to kite. The drips, the water, and its glints are drawn
// from these same puddles (src/render/iso/leaks.ts).

// WHERE THEY ARE

const FLOOR_SYMBOL = '.'

// NOTE: a room's leaks: one for each this many floor tiles, two to three,
// and never two closer than this many tiles.
const TILES_PER_LEAK = 140
const MOST_LEAKS = 3
const LEAST_LEAKS = 2
const LEAK_GAP_TILES = 5
// NOTE: no leak this many tiles or nearer a doorway, so a puddle never sits
// where the zombies come in.
const DOOR_CLEARANCE = 2
// NOTE: nothing solid this many tiles round a leak's tile, so the way past
// a puddle is always wide enough to walk round it dry: never in a narrow
// aisle, lane, or gap.
const PATH_CLEARANCE = 2

export type PuddleRow = Readonly<{ y: number; left: number; right: number }>

export type Leak = Readonly<{
  // NOTE: where the drop lands, in whole game pixels.
  spot: Vector
  // NOTE: the water's pixels, row by row, far row first.
  rows: Array.NonEmptyReadonlyArray<PuddleRow>
  isUnderground: boolean
}>

// NOTE: a number from 0 to 1 for a tile and a use, the same on every engine
// and in every level the tile is part of.
const tileRoll = (column: number, row: number, use: number): number =>
  unitOf(column * 92821 + row * 68917 + use * 7)

// NOTE: a leak's own roll for a use, for what the drawing rolls of it (the
// drips' beat).
export const leakRoll: {
  (use: number): (leak: Leak) => number
  (leak: Leak, use: number): number
} = Function.dual(2, ({ spot }: Leak, use: number): number =>
  tileRoll(Math.floor(spot.x / TILE_SIZE), Math.floor(spot.y / TILE_SIZE), use),
)

const isPlainFloor = (level: Level, column: number, row: number): boolean =>
  Option.getOrElse(symbolAt(level, column, row), () => '') === FLOOR_SYMBOL

const isFlaggedTile = (
  level: Level,
  column: number,
  row: number,
  flags: number,
): boolean =>
  isInsideRoom(level, column, row) &&
  hasTileFlag(level, tileIndex(level, column, row), flags)

// NOTE: is every tile within `reach` of this one true of `test`?
const isAllAround = (
  column: number,
  row: number,
  reach: number,
  test: (column: number, row: number) => boolean,
): boolean => {
  for (let dy = -reach; dy <= reach; dy += 1) {
    for (let dx = -reach; dx <= reach; dx += 1) {
      if (!test(column + dx, row + dy)) {
        return false
      }
    }
  }
  return true
}

// NOTE: plain floor all round, open floor further round, in reach of no
// door.
const isClearTile = (level: Level, column: number, row: number): boolean =>
  isAllAround(column, row, 1, (c, r) => isPlainFloor(level, c, r)) &&
  isAllAround(
    column,
    row,
    PATH_CLEARANCE,
    (c, r) =>
      isInsideRoom(level, c, r) &&
      !isFlaggedTile(level, c, r, TILE_SOLID | TILE_PLAYER_SOLID),
  ) &&
  isAllAround(
    column,
    row,
    DOOR_CLEARANCE + 1,
    (c, r) => !isFlaggedTile(level, c, r, TILE_DOOR),
  )

// NOTE: a puddle's pixels, row by row: a squat blob, wider than it is deep
// as the floor is drawn, its edge nibbled by rolls. Wide enough that wading
// across one is felt, and never past the plain floor round its tile.
const puddleRowsOf = (
  spot: Vector,
  column: number,
  row: number,
): Array.NonEmptyReadonlyArray<PuddleRow> => {
  const halfWidth = 6 + Math.floor(tileRoll(column, row, 3) * 4)
  const halfDepth = 3 + Math.floor(tileRoll(column, row, 4) * 2)
  const rowAt = (index: number): PuddleRow => {
    const dy = index - halfDepth
    const share = Math.sqrt(1 - (dy / (halfDepth + 0.5)) ** 2)
    const half = Math.max(1, Math.round(halfWidth * share))
    const nibble = (side: number): number =>
      tileRoll(column, row, 10 + index * 2 + side) < 0.35 ? 1 : 0
    return {
      y: spot.y + dy,
      left: spot.x - half + nibble(0),
      right: spot.x + half - nibble(1),
    }
  }
  return Array.prepend(
    Array.makeBy(halfDepth * 2, index => rowAt(index + 1)),
    rowAt(0),
  )
}

// NOTE: a puddle keeps this many game pixels off a rug's edge, past its
// fringe and tassels, so it never reads as lying half on one.
const RUG_CLEARANCE = 4

const isOffRugs = (
  rows: ReadonlyArray<PuddleRow>,
  rugs: ReadonlyArray<Rug>,
): boolean =>
  // NOTE: once per level, a puddle's nine rows at most against a room's
  // two rugs.
  Array.every(rows, ({ y, left, right }) =>
    Array.every(
      rugs,
      rug =>
        y < rug.y - RUG_CLEARANCE ||
        y >= rug.y + rug.height + RUG_CLEARANCE ||
        right < rug.x - RUG_CLEARANCE ||
        left >= rug.x + rug.width + RUG_CLEARANCE,
    ),
  )

const spotOf = (column: number, row: number): Vector => ({
  x: column * TILE_SIZE + 3 + Math.floor(tileRoll(column, row, 1) * 4),
  y: row * TILE_SIZE + 4 + Math.floor(tileRoll(column, row, 2) * 3),
})

const leaksIn = (
  level: Level,
  room: Level['rooms'][number],
  rugs: ReadonlyArray<Rug>,
): ReadonlyArray<Leak> => {
  const { box } = room
  const candidates: Array<Readonly<{ column: number; row: number }>> = []
  const left = Math.ceil(box.left / TILE_SIZE)
  const right = Math.floor(box.right / TILE_SIZE)
  const top = Math.ceil(box.top / TILE_SIZE)
  const bottom = Math.floor(box.bottom / TILE_SIZE)
  let floorTiles = 0
  for (let row = top; row < bottom; row += 1) {
    for (let column = left; column < right; column += 1) {
      if (isPlainFloor(level, column, row)) {
        floorTiles += 1
        if (
          isClearTile(level, column, row) &&
          isOffRugs(puddleRowsOf(spotOf(column, row), column, row), rugs)
        ) {
          candidates.push({ column, row })
        }
      }
    }
  }
  const wanted = clamp(
    Math.round(floorTiles / TILES_PER_LEAK),
    LEAST_LEAKS,
    MOST_LEAKS,
  )
  const ranked = Array.sortWith(
    candidates,
    ({ column, row }) => tileRoll(column, row, 0),
    Order.Number,
  )
  const picked: Array<Readonly<{ column: number; row: number }>> = []
  for (const tile of ranked) {
    if (picked.length >= wanted) {
      break
    }
    // NOTE: once per level, against the three leaks a room picks at most.
    const isApart = Array.every(
      picked,
      other =>
        Math.max(
          Math.abs(other.column - tile.column),
          Math.abs(other.row - tile.row),
        ) >= LEAK_GAP_TILES,
    )
    if (isApart) {
      picked.push(tile)
    }
  }
  return Array.map(picked, ({ column, row }) => {
    const spot = spotOf(column, row)
    return {
      spot,
      rows: puddleRowsOf(spot, column, row),
      isUnderground: room.id === CELLAR_ROOM_ID,
    }
  })
}

const leakCache = new WeakMap<Level, ReadonlyArray<Leak>>()

// NOTE: every open room's leaks, built once per level.
export const leaksOf = (level: Level): ReadonlyArray<Leak> => {
  const cached = leakCache.get(level)
  if (cached !== undefined) {
    return cached
  }
  const leaks: Array<Leak> = []
  const rugs = rugsOf(level)
  Array.forEach(level.rooms, room => {
    if (room.isOpen) {
      leaks.push(...leaksIn(level, room, rugs))
    }
  })
  leakCache.set(level, leaks)
  return leaks
}

// WADING

// NOTE: feet in a puddle walk at this share of their pace, a player's and a
// zombie's alike (owner, 2026-11-15: "The puddles should slow you down as
// you go through them").
export const WADE_PACE = 0.65

// NOTE: the feet stand this far below a body's middle, a player's and a
// zombie's alike, and reach this far either side of it, so a foot at the
// water's edge is in.
const FOOT_OFFSET = PLAYER_FOOT_OFFSET
const FOOT_REACH_PX = 2

const wadeCache = new WeakMap<Level, ReadonlyMap<number, Leak>>()

// NOTE: each tile a body stands on with a foot in a puddle's water, keyed to
// its puddle, built once per level, so a frame looks a walker up by the
// tile it stands on with nothing made. The leaks lie five tiles apart, so a
// tile has one puddle at most.
const wadeTilesOf = (level: Level): ReadonlyMap<number, Leak> => {
  const cached = wadeCache.get(level)
  if (cached !== undefined) {
    return cached
  }
  const tiles = new Map<number, Leak>()
  Array.forEach(leaksOf(level), leak => {
    Array.forEach(leak.rows, ({ y, left, right }) => {
      const bodyY = y - FOOT_OFFSET
      const last = right + FOOT_REACH_PX
      for (let x = left - FOOT_REACH_PX; x < last; x += TILE_SIZE) {
        tiles.set(tileIndexAt(level, { x, y: bodyY }), leak)
      }
      tiles.set(tileIndexAt(level, { x: last, y: bodyY }), leak)
    })
  })
  wadeCache.set(level, tiles)
  return tiles
}

// NOTE: whether a body's feet are in a puddle's water. Read per walker per
// frame: a lookup by tile, then its row.
export const isWadingAt: {
  (body: Vector): (level: Level) => boolean
  (level: Level, body: Vector): boolean
} = Function.dual(2, (level: Level, body: Vector): boolean => {
  const leak = wadeTilesOf(level).get(tileIndexAt(level, body))
  if (leak === undefined) {
    return false
  }
  const row = leak.rows[Math.floor(body.y) + FOOT_OFFSET - leak.rows[0].y]
  const footX = Math.floor(body.x)
  return (
    row !== undefined &&
    footX >= row.left - FOOT_REACH_PX &&
    footX <= row.right + FOOT_REACH_PX
  )
})

// NOTE: a walker's pace for the ground under its feet: WADE_PACE in a
// puddle, else 1.
export const wadePaceAt: {
  (body: Vector): (level: Level) => number
  (level: Level, body: Vector): number
} = Function.dual(2, (level: Level, body: Vector): number =>
  isWadingAt(level, body) ? WADE_PACE : 1,
)
