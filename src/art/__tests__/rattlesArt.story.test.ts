import { Array, Record, String } from 'effect'
import { describe, expect, test } from 'vitest'

import {
  AWAKE_FACE,
  MOOD_FACES,
  RATTLES_BUST_ROWS,
  rattlesPixels,
} from '../rattlesArt'

describe('Rattles', () => {
  const stall = rattlesPixels(AWAKE_FACE)

  test('his portrait is his stall sprite down to his bow tie', () => {
    const portrait = rattlesPixels(MOOD_FACES.Grinning).slice(
      0,
      RATTLES_BUST_ROWS,
    )
    expect(portrait).toEqual(stall.slice(0, RATTLES_BUST_ROWS))
    expect(Array.some(portrait, row => String.includes('R')(row))).toBe(true)
  })

  test('a mood changes only his eyes and mouth', () => {
    const faceRows = new Set([4, 5, 6, 7])
    Array.forEach(Record.toEntries(MOOD_FACES), ([, face]) => {
      const moody = rattlesPixels(face)
      expect(moody.length).toBe(stall.length)
      Array.forEach(moody, (row, index) => {
        expect(row.length).toBe(stall[index]?.length)
      })
      const outsideFace = (rows: ReadonlyArray<string>) =>
        Array.filter(rows, (_, index) => !faceRows.has(index))
      expect(outsideFace(moody)).toEqual(outsideFace(stall))
    })
  })
})
