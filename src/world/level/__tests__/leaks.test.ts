import { Array, Option } from 'effect'
import { expect, test } from 'vitest'

import { PLAYER_FOOT_OFFSET, TILE_SIZE } from '#shared/constants.ts'
import {
  TILE_DOOR,
  TILE_SOLID,
  hasTileFlag,
  levelFor,
} from '#world/level/arena.ts'
import {
  WADE_PACE,
  isWadingAt,
  leaksOf,
  wadePaceAt,
} from '#world/level/leaks.ts'
import { EVERY_LEVEL_SPEC } from '#world/level/plan.ts'
import { rugsOf } from '#world/level/rugs.ts'
import { isInsideRoom, symbolAt, tileIndex } from '#world/level/tileGrid.ts'

const EVERY_EXIT = [
  'West',
  'East',
  'Far',
  'Kitchen',
  'NorthStack',
  'SouthStack',
] as const

const levels = Array.map(EVERY_LEVEL_SPEC, spec => levelFor(spec, EVERY_EXIT))
const manor = Option.getOrThrow(Array.get(levels, 1))

const isFlagged = (
  level: (typeof levels)[number],
  column: number,
  row: number,
  flag: number,
): boolean =>
  isInsideRoom(level, column, row) &&
  hasTileFlag(level, tileIndex(level, column, row), flag)

test('every open room leaks two or three times, on plain floor far from any door', () => {
  Array.forEach(levels, level => {
    const leaks = leaksOf(level)
    const openRooms = Array.filter(level.rooms, ({ isOpen }) => isOpen)
    expect(leaks.length).toBeGreaterThanOrEqual(openRooms.length * 2)
    Array.forEach(leaks, ({ spot, rows }) => {
      const column = Math.floor(spot.x / TILE_SIZE)
      const row = Math.floor(spot.y / TILE_SIZE)
      Array.forEach(
        Array.makeBy(9, around => around),
        around => {
          const at = symbolAt(
            level,
            column + (around % 3) - 1,
            row + Math.floor(around / 3) - 1,
          )
          expect(Option.getOrThrow(at)).toBe('.')
        },
      )
      Array.forEach(level.doorIds, id => {
        const { center } = level.doors[id]
        expect(
          Math.max(
            Math.abs(Math.floor(center.x / TILE_SIZE) - column),
            Math.abs(Math.floor(center.y / TILE_SIZE) - row),
          ),
        ).toBeGreaterThan(2)
      })
      Array.forEach(rows, puddle => {
        Array.forEach([puddle.left, puddle.right], x => {
          const at = symbolAt(
            level,
            Math.floor(x / TILE_SIZE),
            Math.floor(puddle.y / TILE_SIZE),
          )
          expect(Option.getOrThrow(at)).toBe('.')
          expect(
            isFlagged(
              level,
              Math.floor(x / TILE_SIZE),
              Math.floor(puddle.y / TILE_SIZE),
              TILE_DOOR,
            ),
          ).toBe(false)
        })
      })
    })
  })
})

test('a puddle never narrows a way: nothing solid within two tiles of it', () => {
  Array.forEach(levels, level => {
    Array.forEach(leaksOf(level), ({ spot }) => {
      const column = Math.floor(spot.x / TILE_SIZE)
      const row = Math.floor(spot.y / TILE_SIZE)
      Array.forEach(
        Array.makeBy(25, around => around),
        around => {
          const c = column + (around % 5) - 2
          const r = row + Math.floor(around / 5) - 2
          expect(isInsideRoom(level, c, r)).toBe(true)
          expect(isFlagged(level, c, r, TILE_SOLID)).toBe(false)
        },
      )
    })
  })
})

test('no puddle lies on a rug or a runner', () => {
  Array.forEach(levels, level => {
    const rugs = rugsOf(level)
    Array.forEach(leaksOf(level), ({ rows }) => {
      Array.forEach(rows, ({ y, left, right }) => {
        Array.forEach(rugs, rug => {
          const isOn =
            y >= rug.y &&
            y < rug.y + rug.height &&
            right >= rug.x &&
            left < rug.x + rug.width
          expect(isOn).toBe(false)
        })
      })
    })
  })
})

test('the leaks stay put as more of the house opens', () => {
  const shut = levelFor(Option.getOrThrow(Array.get(EVERY_LEVEL_SPEC, 1)), [])
  const parlourSpots = Array.map(leaksOf(shut), ({ spot }) => spot)
  const openSpots = Array.map(leaksOf(manor), ({ spot }) => spot)
  Array.forEach(parlourSpots, spot => {
    expect(openSpots).toContainEqual(spot)
  })
})

test('feet in the water wade, feet beside it walk', () => {
  Array.forEach(leaksOf(manor), ({ rows }) => {
    Array.forEach(rows, ({ y, left, right }) => {
      const bodyY = y - PLAYER_FOOT_OFFSET + 0.5
      Array.forEach([left, Math.round((left + right) / 2), right], x => {
        expect(isWadingAt(manor, { x: x + 0.5, y: bodyY })).toBe(true)
        expect(wadePaceAt(manor, { x: x + 0.5, y: bodyY })).toBe(WADE_PACE)
      })
      expect(isWadingAt(manor, { x: left - 3, y: bodyY })).toBe(false)
      expect(isWadingAt(manor, { x: right + 3.5, y: bodyY })).toBe(false)
    })
    const first = Array.headNonEmpty(rows)
    const last = Array.lastNonEmpty(rows)
    const middle = Math.round((first.left + first.right) / 2)
    expect(
      isWadingAt(manor, { x: middle, y: first.y - PLAYER_FOOT_OFFSET - 1 }),
    ).toBe(false)
    expect(
      wadePaceAt(manor, { x: middle, y: last.y - PLAYER_FOOT_OFFSET + 1 }),
    ).toBe(1)
  })
})
