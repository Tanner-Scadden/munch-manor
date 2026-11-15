import { Array, Option, Record, String } from 'effect'
import { describe, expect, test } from 'vitest'

import { LOOK } from '../../src/render/iso/lookSpecs'
import {
  CONTROLS,
  SHIPPED_TABLES,
  changesOf,
  controlById,
  formatValue,
  inputTextOf,
  inputValueOf,
  proposalOf,
  tablesOf,
  valueOf,
  withEdit,
} from './lab'

const controlOf = (id: string) =>
  Option.getOrThrowWith(controlById(id), () => new Error(`no control ${id}`))

describe('the lab', () => {
  test('has a control for every value of the look, the flames, and the moods', () => {
    const ids = Array.map(CONTROLS, ({ id }) => id)
    expect(ids).toContain('LOOK.steps')
    expect(ids).toContain('LOOK.ambient')
    expect(ids).toContain('LOOK.rooms.Dining.shadow')
    expect(ids).toContain('LOOK.rooms.Library.fill')
    expect(ids).toContain('FLAME_LOOKS.Candle.intensity')
    expect(ids).toContain('FLAME_LOOKS.Bulb.range')
    expect(ids).toContain('MOOD_AMBIENT.calm')
    expect(Array.dedupe(ids)).toHaveLength(ids.length)
    expect(Array.filter(ids, String.startsWith('LOOK.rooms.'))).toHaveLength(
      Record.keys(LOOK.rooms).length * 6,
    )
  })

  test('with no edits, makes the tables as shipped', () => {
    expect(tablesOf({})).toEqual(SHIPPED_TABLES)
    Array.forEach(CONTROLS, control => {
      expect(valueOf({}, control)).toBe(control.read(SHIPPED_TABLES))
    })
  })

  test('maps each edit onto the value it names', () => {
    const edits = withEdit(
      withEdit(
        withEdit(
          withEdit({}, 'LOOK.steps', 7),
          'LOOK.rooms.Dining.mid',
          0x123456,
        ),
        'FLAME_LOOKS.Candle.range',
        9.5,
      ),
      'MOOD_AMBIENT.dread',
      0.4,
    )
    const tables = tablesOf(edits)
    expect(tables.look.steps).toBe(7)
    expect(tables.look.rooms['Dining']?.mid).toBe(0x123456)
    expect(tables.look.rooms['Dining']?.shadow).toBe(
      LOOK.rooms['Dining']?.shadow,
    )
    expect(tables.flames.Candle.range).toBe(9.5)
    expect(tables.flames.Candle.color).toBe(SHIPPED_TABLES.flames.Candle.color)
    expect(tables.moods.dread).toBe(0.4)
    expect(tables.moods.calm).toBe(SHIPPED_TABLES.moods.calm)
  })

  test('holds a value to its range and step, and drops one slid back', () => {
    expect(withEdit({}, 'LOOK.steps', 40)).toEqual({ 'LOOK.steps': 15 })
    expect(withEdit({}, 'LOOK.dither', 0.5300001)).toEqual({
      'LOOK.dither': 0.55,
    })
    expect(withEdit({ 'LOOK.steps': 7 }, 'LOOK.steps', LOOK.steps)).toEqual({})
    expect(withEdit({}, 'LOOK.nothing', 3)).toEqual({})
  })

  test('gives a room with no fill of its own the edited room fill', () => {
    const tables = tablesOf(withEdit({}, 'LOOK.roomFill', 0.9))
    expect(tables.look.roomFill).toBe(0.9)
    expect(tables.look.rooms['Dining']?.fill).toBeUndefined()
    const own = tablesOf(withEdit({}, 'LOOK.rooms.Dining.fill', 1.2))
    expect(own.look.rooms['Dining']?.fill).toBe(1.2)
  })

  test('writes values as code does', () => {
    expect(formatValue(0xb0603a, controlOf('LOOK.rooms.Dining.shadow'))).toBe(
      '0xb0603a',
    )
    expect(formatValue(0x00ff00, controlOf('FLAME_LOOKS.Candle.color'))).toBe(
      '0x00ff00',
    )
    expect(formatValue(0.1 + 0.2, controlOf('LOOK.dither'))).toBe('0.3')
    expect(formatValue(6, controlOf('LOOK.steps'))).toBe('6')
  })

  test('proposes the changed values with their shipped ones, by file', () => {
    const edits = withEdit(
      withEdit(
        withEdit(withEdit({}, 'MOOD_AMBIENT.calm', 1.2), 'LOOK.steps', 6),
        'LOOK.rooms.Dining.fill',
        0.8,
      ),
      'FLAME_LOOKS.Candle.intensity',
      14,
    )
    expect(Array.map(changesOf(edits), ({ control }) => control.id)).toEqual([
      'LOOK.steps',
      'LOOK.rooms.Dining.fill',
      'FLAME_LOOKS.Candle.intensity',
      'MOOD_AMBIENT.calm',
    ])
    expect(
      proposalOf({
        edits,
        words: ' warmer please ',
        where: 'the Dining room, Break',
      }),
    ).toBe(
      Array.join(
        [
          'warmer please',
          'Light and color lab: please land these values (tried on the Dining room, Break).',
          'src/render/iso/lookSpecs.ts',
          `  LOOK.steps: ${LOOK.steps} -> 6`,
          `  LOOK.rooms.Dining.fill: ${LOOK.roomFill} (unset, LOOK.roomFill) -> 0.8`,
          'src/render/iso/lightSpecs.ts',
          `  FLAME_LOOKS.Candle.intensity: ${SHIPPED_TABLES.flames.Candle.intensity} -> 14`,
          'src/render/iso/mood.ts',
          `  MOOD_AMBIENT.calm: ${SHIPPED_TABLES.moods.calm} -> 1.2`,
        ],
        '\n',
      ),
    )
  })

  test('reads what an input says, and writes a value as the input shows it', () => {
    const color = controlOf('LOOK.rooms.Dining.shadow')
    const number = controlOf('LOOK.dither')
    expect(inputValueOf(color, '#ff4040')).toEqual(Option.some(0xff4040))
    expect(inputValueOf(color, '#ff40')).toEqual(Option.none())
    expect(inputValueOf(color, 'ff4040')).toEqual(Option.none())
    expect(inputValueOf(number, ' 0.35 ')).toEqual(Option.some(0.35))
    expect(inputValueOf(number, 'lots')).toEqual(Option.none())
    expect(inputTextOf(0x00ff00, color)).toBe('#00ff00')
    expect(inputTextOf(0.1 + 0.2, number)).toBe('0.3')
  })
})
