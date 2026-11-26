import { Array } from 'effect'
import { describe, expect, test } from 'vitest'

import {
  type Palette,
  flashPalette,
  isFlashShape,
  spriteShapes,
} from '#art/sprite.ts'

const PALETTE: Palette = { R: '#e8333a', K: '#2a1418' }

const PIXELS: ReadonlyArray<string> = ['.KK.', 'KRRK', '.KK.']

describe('the hit flash', () => {
  test('marks the sprites drawn in a flash palette, and no others', () => {
    const flashed = spriteShapes(PIXELS, flashPalette(PALETTE))
    const plain = spriteShapes(PIXELS, PALETTE)
    expect(flashed.length).toBeGreaterThan(0)
    expect(Array.every(flashed, isFlashShape)).toBe(true)
    expect(Array.some(plain, isFlashShape)).toBe(false)
  })
})
