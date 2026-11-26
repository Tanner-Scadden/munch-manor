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

const FLOOR_SYMBOL = '.'

const TILES_PER_LEAK = 140
const MOST_LEAKS = 3
const LEAST_LEAKS = 2
const LEAK_GAP_TILES = 5
const DOOR_CLEARANCE = 2
const PATH_CLEARANCE = 2

export type PuddleRow = Readonly<{ y: number; left: number; right: number }>

export type Leak = Readonly<{
  spot: Vector
  rows: Array.NonEmptyReadonlyArray<PuddleRow>
  isUnderground: boolean
}>

const tileRoll = (column: number, row: number, use: number): number =>
  unitOf(column * 92821 + row * 68917 + use * 7)

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

const puddleRowsOf = (
  spot: Vector,
  column: number,
  row: number,
): Array.NonEmptyReadonlyArray<PuddleRow> => {
  const halfWidth = 6 + Math.floor(tileRoll(column, row, 3) * 4)
  const halfDepth = 3 + Math.floor(tileRoll(column, row, 4) * 2)
  const rowAt = (index: number): PuddleRow => {
    const dy = index - halfDepth
    const across = dy / (halfDepth + 0.5)
    const share = Math.sqrt(1 - across * across)
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

const RUG_CLEARANCE = 4

const isOffRugs = (
  rows: ReadonlyArray<PuddleRow>,
  rugs: ReadonlyArray<Rug>,
): boolean =>
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

export const WADE_PACE = 0.65

const FOOT_OFFSET = PLAYER_FOOT_OFFSET
const FOOT_REACH_PX = 2

const wadeCache = new WeakMap<Level, ReadonlyMap<number, Leak>>()

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

export const wadePaceAt: {
  (body: Vector): (level: Level) => number
  (level: Level, body: Vector): number
} = Function.dual(2, (level: Level, body: Vector): number =>
  isWadingAt(level, body) ? WADE_PACE : 1,
)
