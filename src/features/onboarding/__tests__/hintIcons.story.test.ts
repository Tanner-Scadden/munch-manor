import { Array, Option, String } from 'effect'
import { describe, expect, test } from 'vitest'

import { ICON_PALETTE, keyPixels } from '../../../art/hintIcons'
import { parseColor } from '../../../art/png'

// NOTE: perceived lightness, 0 to 255.
const lightnessOf = (symbol: string): number =>
  Option.match(
    Option.flatMap(Option.fromNullishOr(ICON_PALETTE[symbol]), parseColor),
    {
      onNone: () => -1,
      onSome: ({ r, g, b }) => 0.299 * r + 0.587 * g + 0.114 * b,
    },
  )

const symbolsIn = (pixels: ReadonlyArray<string>): ReadonlySet<string> =>
  new Set(Array.flatMap(pixels, row => String.split('')(row)))

describe('a keycap in a hint', () => {
  test('its letters are lighter than its cap, pressed or not', () => {
    for (const isPressed of [false, true]) {
      const pixels = keyPixels('ENTER', isPressed)
      const glyph = isPressed ? 'y' : 'w'
      expect(symbolsIn(pixels).has(glyph)).toBe(true)
      expect(symbolsIn(pixels).has('K')).toBe(true)
      expect(lightnessOf(glyph) - lightnessOf('K')).toBeGreaterThan(100)
    }
  })
})
