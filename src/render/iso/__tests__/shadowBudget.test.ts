import { Array } from 'effect'
import { describe, expect, test } from 'vitest'

import { SHADOW_MAPS_A_FRAME, ShadowBudget } from '#render/iso/shadowBudget.ts'

const FOUR_CASTING = [true, true, true, true]

type Frame = Readonly<{
  casting?: ReadonlyArray<boolean>
  changed: ReadonlyArray<number>
  first?: number
  isEvery?: boolean
}>

const drawnIndices = (
  picked: ReadonlyArray<boolean>,
): ReadonlyArray<number> => {
  const drawn: Array<number> = []
  Array.forEach(picked, (isDrawn, index) => {
    if (isDrawn) {
      drawn.push(index)
    }
  })
  return drawn
}

const settled = (): ShadowBudget => {
  const budget = new ShadowBudget()
  budget.pick({
    casting: FOUR_CASTING,
    isChanged: () => true,
    first: 0,
    isEvery: true,
  })
  return budget
}

const pickOf = (budget: ShadowBudget, input: Frame): ReadonlyArray<number> =>
  drawnIndices(
    budget.pick({
      casting: input.casting ?? FOUR_CASTING,
      isChanged: index => Array.contains(input.changed, index),
      first: input.first ?? 0,
      isEvery: input.isEvery ?? false,
    }),
  )

describe('the shadow budget', () => {
  test('draws a new level every casting fill at once', () => {
    const budget = new ShadowBudget()
    expect(pickOf(budget, { changed: [], isEvery: true })).toEqual([0, 1, 2, 3])
  })

  test('draws nothing while no caster moves', () => {
    const budget = settled()
    expect(pickOf(budget, { changed: [] })).toEqual([])
  })

  test(`draws at most ${SHADOW_MAPS_A_FRAME} maps a frame in a wave`, () => {
    const budget = settled()
    Array.forEach(Array.range(1, 30), () => {
      expect(
        pickOf(budget, { changed: [0, 1, 2, 3] }).length,
      ).toBeLessThanOrEqual(SHADOW_MAPS_A_FRAME)
    })
  })

  test('draws the fill nearest the player every frame it changes', () => {
    const budget = settled()
    Array.forEach(Array.range(1, 12), () => {
      expect(pickOf(budget, { changed: [0, 1, 2, 3], first: 2 })).toContain(2)
    })
  })

  test('the others take turns, the longest waiting first', () => {
    const budget = settled()
    const others = Array.map(
      Array.range(1, 6),
      () => pickOf(budget, { changed: [0, 1, 2, 3], first: 0 })[1],
    )
    expect(others).toEqual([1, 2, 3, 1, 2, 3])
  })

  test('a change is late, never lost', () => {
    const budget = settled()
    expect(pickOf(budget, { changed: [1, 2, 3], first: 0 })).toEqual([1, 2])
    expect(pickOf(budget, { changed: [], first: 0 })).toEqual([3])
    expect(pickOf(budget, { changed: [], first: 0 })).toEqual([])
  })

  test('a fill that stops casting is no longer due', () => {
    const budget = settled()
    pickOf(budget, { changed: [1, 2, 3], first: 0 })
    expect(
      pickOf(budget, {
        casting: [true, true, true, false],
        changed: [],
        first: 0,
      }),
    ).toEqual([])
  })

  test('a casting set that changes draws every casting fill again', () => {
    const budget = settled()
    expect(
      pickOf(budget, {
        casting: [true, false, true, true],
        changed: [],
        isEvery: true,
      }),
    ).toEqual([0, 2, 3])
  })
})
