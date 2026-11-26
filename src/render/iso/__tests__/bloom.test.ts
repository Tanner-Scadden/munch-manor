import { describe, expect, test } from 'vitest'

import { bloomSharesOf } from '#render/iso/bloom.ts'

const sharesOf = (radius: number) => {
  const { fine, coarse } = bloomSharesOf(radius)
  return {
    largest: 1 - fine,
    middle: fine * (1 - coarse),
    smallest: fine * coarse,
  }
}

describe('bloomSharesOf', () => {
  test('the three levels share the whole glow', () => {
    const { largest, middle, smallest } = sharesOf(0.6)
    expect(largest + middle + smallest).toBeCloseTo(1, 10)
  })

  test("the world's radius gives each level the halvings' share", () => {
    const { largest, middle, smallest } = sharesOf(0.6)
    expect(largest).toBeCloseTo(0.4 + 0.12, 10)
    expect(middle).toBeCloseTo(0.12 + 0.144 + 0.0432, 10)
    expect(smallest).toBeCloseTo(0.0432 + 0.1296, 10)
  })

  test('no spread keeps the glow on the largest level', () => {
    expect(sharesOf(0).largest).toBeCloseTo(1, 10)
  })
})
