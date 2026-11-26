import { Array } from 'effect'
import { Machine } from 'effect-machine'
import { describe, expect, test } from 'vitest'

import { UpdateGift } from '../clientSchema'
import { GiftEvent, giftMachine, stepGift } from '../giftFlow'

const registered = (): ReadonlyArray<string> =>
  Array.flatMap(Machine.definition(giftMachine).states, state =>
    Array.map(
      state.transitions,
      transition => `${state.tag}/${transition.event}`,
    ),
  )

describe('the update gift', () => {
  test('a wrapped gift unwraps, and only an unwrapping one wraps again', () => {
    expect(registered()).toEqual(['Wrapped/Unwrapped', 'Unwrapping/Rewrapped'])
    expect(Machine.definition(giftMachine).anyState).toEqual([])
  })

  test('a second tap while it unwraps changes nothing', () => {
    expect(stepGift(UpdateGift.Unwrapping, GiftEvent.Unwrapped)).toBe(
      UpdateGift.Unwrapping,
    )
    expect(stepGift(UpdateGift.Wrapped, GiftEvent.Rewrapped)).toBe(
      UpdateGift.Wrapped,
    )
  })
})
