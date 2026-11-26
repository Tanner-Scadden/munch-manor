import { Array } from 'effect'
import { describe, expect, test } from 'vitest'

import { blastLightOf, blastPiecesOf } from '#render/iso/explosions.ts'
import { BLAST_FLASH_MS } from '#shared/constants.ts'

const blastAt = (ageMs: number) => ({ x: 200, y: 140, radius: 28, ageMs })

const sparksOf = (ageMs: number) =>
  Array.filter(
    blastPiecesOf(blastAt(ageMs)),
    piece => piece.color === 0xfff0b8 && piece.rise === 0,
  )

describe('the 3D blast', () => {
  test('the same blast draws the same blocks', () => {
    expect(blastPiecesOf(blastAt(110))).toEqual(blastPiecesOf(blastAt(110)))
  })

  test('the first beat is white hot', () => {
    const fire = Array.filter(
      blastPiecesOf(blastAt(20)),
      piece => piece.height > 1,
    )
    expect(Array.every(fire, piece => piece.color === 0xfff6d0)).toBe(true)
  })

  test('the ball stays inside the ring it hurts', () => {
    Array.forEach([20, 110, 230, BLAST_FLASH_MS], ageMs => {
      Array.forEach(blastPiecesOf(blastAt(ageMs)), piece => {
        expect(Math.abs(piece.x - 200)).toBeLessThanOrEqual(28 + 3)
      })
    })
  })

  test('the ring of sparks is gone by halfway', () => {
    expect(sparksOf(40).length).toBeGreaterThan(0)
    expect(sparksOf(BLAST_FLASH_MS * 0.6)).toEqual([])
  })

  test('the smoke rolls in once the fire cools', () => {
    const smokeAt = (ageMs: number) =>
      Array.filter(blastPiecesOf(blastAt(ageMs)), piece => piece.glow === 0)
    expect(smokeAt(20)).toEqual([])
    expect(smokeAt(230).length).toBeGreaterThan(0)
  })

  test('the light flashes at once and fades out', () => {
    expect(blastLightOf(blastAt(0))).toBe(1)
    expect(blastLightOf(blastAt(160))).toBeLessThan(0.5)
    expect(blastLightOf(blastAt(BLAST_FLASH_MS))).toBe(0)
  })
})
