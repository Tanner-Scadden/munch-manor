import { Array, Option, Record } from 'effect'
import { describe, expect, test } from 'vitest'

import { TILE_SIZE } from '../../../shared/constants'
import { EVERY_LEVEL } from '../../../test/model.fixture'
import { MANOR, levelFor } from '../../../world/level/arena'
import {
  CELLAR_ROOM_ID,
  EAST_EXIT,
  FAR_EXIT,
  MANOR_SPEC,
} from '../../../world/level/plan'
import { LOOK } from '../lookSpecs'
import {
  RAMP_COLUMNS,
  ROOM_MAP,
  rampRowsOf,
  rampTexelsOf,
  roomTexelsOf,
  slotOf,
} from '../lookTexels'

// The look pass's bytes (src/render/iso/lookTexels.ts): every level's rooms
// fit the room map, a shut room and the outside are the void, the dark
// cellar's dark lies on its own tiles alone, and the void's ramp is black.

const byteAt = (
  texels: Uint8Array,
  point: Readonly<{ x: number; y: number }>,
  channel: number,
): number => {
  const column = Math.floor(point.x / TILE_SIZE) - ROOM_MAP.column
  const row = Math.floor(point.y / TILE_SIZE) - ROOM_MAP.row
  return texels[(row * ROOM_MAP.columns + column) * 4 + channel] ?? -1
}

const slotAt = (
  texels: Uint8Array,
  point: Readonly<{ x: number; y: number }>,
): number => byteAt(texels, point, 0)

const darkAt = (
  texels: Uint8Array,
  point: Readonly<{ x: number; y: number }>,
): number => byteAt(texels, point, 1)

const OPEN_MANOR = levelFor(MANOR_SPEC, [EAST_EXIT, FAR_EXIT])

describe('the room map', () => {
  test('holds every level the plans build', () => {
    Array.forEach(EVERY_LEVEL, level => {
      expect(Math.floor(level.left / TILE_SIZE)).toBeGreaterThanOrEqual(
        ROOM_MAP.column,
      )
      expect(Math.floor(level.top / TILE_SIZE)).toBeGreaterThanOrEqual(
        ROOM_MAP.row,
      )
      expect((level.left + level.width) / TILE_SIZE).toBeLessThanOrEqual(
        ROOM_MAP.column + ROOM_MAP.columns,
      )
      expect((level.top + level.height) / TILE_SIZE).toBeLessThanOrEqual(
        ROOM_MAP.row + ROOM_MAP.rows,
      )
    })
  })

  test('marks an open room with its script and a shut one as the void', () => {
    const texels = roomTexelsOf({ specs: LOOK, level: MANOR, isDark: false })
    expect(slotAt(texels, { x: 180, y: 110 })).toBe(
      slotOf({ specs: LOOK, roomId: 'Dining' }),
    )
    expect(slotAt(texels, { x: 840, y: 90 })).toBe(0)
    expect(slotAt(texels, { x: 180, y: 300 })).toBe(0)
  })

  test("lays the cellar's dark on its tiles and walls, up to the tile", () => {
    const cellar = Option.getOrThrow(
      Array.findFirst(OPEN_MANOR.rooms, ({ id }) => id === CELLAR_ROOM_ID),
    )
    const dark = roomTexelsOf({ specs: LOOK, level: OPEN_MANOR, isDark: true })
    const { left, right, top, bottom } = cellar.box
    const middle = (top + bottom) / 2
    expect(darkAt(dark, { x: left + 5, y: middle })).toBe(255)
    expect(darkAt(dark, { x: right - 5, y: middle })).toBe(255)
    expect(darkAt(dark, { x: left - 5, y: middle })).toBe(0)
    expect(slotAt(dark, { x: left - 5, y: middle })).toBeGreaterThan(0)
    const tiles = ROOM_MAP.columns * ROOM_MAP.rows
    const darkTiles = Array.filter(
      Array.range(0, tiles - 1),
      index => (dark[index * 4 + 1] ?? 0) > 0,
    ).length
    expect(darkTiles).toBe(
      ((right - left) / TILE_SIZE) * ((bottom - top) / TILE_SIZE),
    )
    const lit = roomTexelsOf({ specs: LOOK, level: OPEN_MANOR, isDark: false })
    expect(darkAt(lit, { x: left + 5, y: middle })).toBe(0)
  })
})

describe('the ramps', () => {
  test('keep the void black and light each scripted room', () => {
    const texels = rampTexelsOf(LOOK)
    const at = (column: number, row: number): number =>
      texels[(row * RAMP_COLUMNS + column) * 4] ?? 0
    const lightest = (row: number): number =>
      Math.max(
        ...Array.map(Array.range(0, RAMP_COLUMNS - 1), column =>
          at(column, row),
        ),
      )
    expect(lightest(1)).toBe(0)
    expect(rampRowsOf(LOOK)).toBe(3 + Record.keys(LOOK.rooms).length)
    const dining = slotOf({ specs: LOOK, roomId: 'Dining' })
    expect(at(LOOK.steps, dining + 1)).toBeGreaterThan(0)
  })
})
