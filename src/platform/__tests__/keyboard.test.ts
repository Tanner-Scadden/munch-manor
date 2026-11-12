import { describe, expect, test } from 'vitest'

import { KEYBOARD_GAP_PX, keyboardLift } from '../keyboard'

describe('lifting a field over the keyboard', () => {
  test('a field above the keyboard stays put', () => {
    expect(keyboardLift({ top: 100, bottom: 148 }, 400)).toBe(0)
  })

  test('a covered field lifts just clear of the keyboard', () => {
    expect(keyboardLift({ top: 504, bottom: 552 }, 464)).toBe(
      552 + KEYBOARD_GAP_PX - 464,
    )
  })

  test('never lifts the field off the top of the screen', () => {
    expect(keyboardLift({ top: 40, bottom: 300 }, 100)).toBe(
      40 - KEYBOARD_GAP_PX,
    )
  })
})
