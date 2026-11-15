import { Array, Record } from 'effect'
import { describe, expect, test } from 'vitest'

import { TILE_SIZE } from '../../../shared/constants'
import { EVERY_LEVEL } from '../../../test/model.fixture'
import { MANOR } from '../../../world/level/arena'
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
// fit the room map, a shut room and the outside are the void, and the void's
// ramp is black.

const slotAt = (
  texels: Uint8Array,
  point: Readonly<{ x: number; y: number }>,
): number => {
  const column = Math.floor(point.x / TILE_SIZE) - ROOM_MAP.column
  const row = Math.floor(point.y / TILE_SIZE) - ROOM_MAP.row
  return texels[(row * ROOM_MAP.columns + column) * 4] ?? -1
}

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
    const texels = roomTexelsOf({ specs: LOOK, level: MANOR })
    expect(slotAt(texels, { x: 180, y: 110 })).toBe(
      slotOf({ specs: LOOK, roomId: 'Dining' }),
    )
    expect(slotAt(texels, { x: 840, y: 90 })).toBe(0)
    expect(slotAt(texels, { x: 180, y: 300 })).toBe(0)
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
