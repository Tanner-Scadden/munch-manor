import { Array, Option, Record } from 'effect'

import { TILE_SIZE } from '#shared/constants.ts'
import type { Level } from '#world/level/arena.ts'
import { CELLAR_ROOM_ID } from '#world/level/plan.ts'

import type { LookSpecs, RoomLook } from './lookSpecs.ts'
import { NEUTRAL } from './lookSpecs.ts'
import { mixColor } from './mood.ts'

export const RAMP_COLUMNS = 16

export const CUT_RANGE = 2
export const BRIGHTEST_RANGE = 4

export const ROOM_MAP = {
  column: -64,
  row: -32,
  columns: 256,
  rows: 64,
} as const

const VOID_SLOT = 0
const NEUTRAL_SLOT = 1

const scriptedOf = (specs: LookSpecs): ReadonlyArray<string> =>
  Record.keys(specs.rooms)

export const rampRowsOf = (specs: LookSpecs): number =>
  1 + NEUTRAL_SLOT + 1 + scriptedOf(specs).length

export const slotOf = (
  input: Readonly<{ specs: LookSpecs; roomId: string }>,
): number =>
  Option.match(
    Array.findFirstIndex(scriptedOf(input.specs), id => id === input.roomId),
    {
      onNone: () => NEUTRAL_SLOT,
      onSome: index => NEUTRAL_SLOT + 1 + index,
    },
  )

const byte = (share: number): number =>
  Math.round(Math.min(1, Math.max(0, share)) * 255)

const fullHue = (color: number): ReadonlyArray<number> => {
  const channels = [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff]
  const most = Math.max(1, ...channels)
  return Array.map(channels, channel => Math.round((channel * 255) / most))
}

const hueAt = (look: RoomLook, t: number): number =>
  t < 0.5
    ? mixColor({ from: look.shadow, to: look.mid, share: t * 2 })
    : mixColor({ from: look.mid, to: look.light, share: t * 2 - 1 })

const bandHueOf = (
  input: Readonly<{ look: RoomLook; band: number; steps: number }>,
): number => {
  const { look, band, steps } = input
  const hue = hueAt(look, steps <= 1 ? 1 : (band - 1) / (steps - 1))
  return band === 1
    ? mixColor({ from: hue, to: look.accent, share: look.accentShare })
    : hue
}

export const rampTexelsOf = (specs: LookSpecs): Uint8Array => {
  const rows = rampRowsOf(specs)
  const texels = new Uint8Array(RAMP_COLUMNS * rows * 4)
  const steps = Math.round(Math.min(RAMP_COLUMNS - 1, Math.max(1, specs.steps)))
  const put = (
    column: number,
    row: number,
    rgb: ReadonlyArray<number>,
  ): void => {
    const at = (row * RAMP_COLUMNS + column) * 4
    texels[at] = rgb[0] ?? 0
    texels[at + 1] = rgb[1] ?? 0
    texels[at + 2] = rgb[2] ?? 0
    texels[at + 3] = 255
  }
  put(0, 0, [steps, byte(specs.dither), byte(specs.blackBelow / CUT_RANGE)])
  put(1, 0, [byte(specs.hueKeep), byte(specs.brightest / BRIGHTEST_RANGE), 0])
  const looks: ReadonlyArray<RoomLook> = [
    NEUTRAL,
    ...Array.map(scriptedOf(specs), id => specs.rooms[id] ?? NEUTRAL),
  ]
  for (let row = 1; row < rows; row += 1) {
    for (let column = 0; column < RAMP_COLUMNS; column += 1) {
      put(column, row, [0, 0, 0])
    }
  }
  Array.forEach(looks, (look, index) => {
    const row = 1 + NEUTRAL_SLOT + index
    for (let band = 1; band <= steps; band += 1) {
      put(band, row, fullHue(bandHueOf({ look, band, steps })))
    }
  })
  return texels
}

export const roomTexelsOf = (
  input: Readonly<{ specs: LookSpecs; level: Level; isDark: boolean }>,
): Uint8Array => {
  const { specs, level, isDark } = input
  const texels = new Uint8Array(ROOM_MAP.columns * ROOM_MAP.rows * 4)
  const open = Array.filter(level.rooms, ({ isOpen }) => isOpen)
  const slots = Array.map(open, room => slotOf({ specs, roomId: room.id }))
  const darks = Array.map(open, ({ id }) =>
    isDark && id === CELLAR_ROOM_ID ? 255 : 0,
  )
  for (let row = 0; row < ROOM_MAP.rows; row += 1) {
    const y = (ROOM_MAP.row + row + 0.5) * TILE_SIZE
    for (let column = 0; column < ROOM_MAP.columns; column += 1) {
      const x = (ROOM_MAP.column + column + 0.5) * TILE_SIZE
      const maybeIndex = Array.findFirstIndex(
        open,
        ({ box }) =>
          x > box.left && x < box.right && y > box.top && y < box.bottom,
      )
      const at = (row * ROOM_MAP.columns + column) * 4
      texels[at] = Option.match(maybeIndex, {
        onNone: () => VOID_SLOT,
        onSome: index => slots[index] ?? VOID_SLOT,
      })
      texels[at + 1] = Option.match(maybeIndex, {
        onNone: () => 0,
        onSome: index => darks[index] ?? 0,
      })
      texels[at + 3] = 255
    }
  }
  return texels
}
