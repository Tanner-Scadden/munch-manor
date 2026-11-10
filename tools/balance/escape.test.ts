import { Array, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { initialModel } from '../../src/app/pureApp'
import { PREPARATION_MS } from '../../src/shared/constants'
import { withDareThings, withKeys } from '../../src/test/model.fixture'
import { asVeteran } from '../../src/test/veteran'
import { spotsOf } from '../../src/world/dare/dare'
import { DareThingState } from '../../src/world/dare/dareSchema'
import { levelOf } from '../../src/world/level/arena'
import { KITCHEN_EXIT, exitKeysOf } from '../../src/world/level/exits'
import { Phase, Purchasable } from '../../src/world/schema/worldSchema'
import { wantedBoards } from './bot/escape'

// The balance bot's hunt (tools/balance/bot/escape.ts): a thing on the list
// hidden behind boards gets its room bought open in a break, once the
// crew's ring holds the padlock's keys.

const behindBoards = Option.getOrThrow(
  Array.findFirst(
    spotsOf(levelOf(initialModel)),
    ({ isBehindBoards }) => isBehindBoards,
  ),
).point

// NOTE: past the kitchen tour's break, so the boards keep their price.
const WAVE_4_BREAK = Phase.Preparation({
  wave: 4,
  remainingMs: 15_000,
  durationMs: PREPARATION_MS,
  spawns: [],
})

// NOTE: the first spot behind boards is the kitchen's.
const PRICE = exitKeysOf(KITCHEN_EXIT)

const breakWith = (keys: number, isAsked: boolean) =>
  withKeys(
    withDareThings(
      modifyFields(asVeteran(initialModel), { phase: () => WAVE_4_BREAK }),
      [
        {
          id: 0,
          kind: 'ButlersBell',
          isAsked,
          state: DareThingState.Hidden(behindBoards),
        },
      ],
    ),
    keys,
  )

describe('the bot opens boards for the hunt', () => {
  test('for a thing on the list behind them, with the keys on the ring', () => {
    const offer = wantedBoards(breakWith(PRICE, true))
    expect(
      offer !== undefined && Purchasable.isAnyOf(['Exit'])(offer.target),
    ).toBe(true)
  })

  test('not short of the keys', () => {
    expect(wantedBoards(breakWith(PRICE - 1, true))).toBeUndefined()
  })

  test('not for a thing off the list', () => {
    expect(wantedBoards(breakWith(PRICE, false))).toBeUndefined()
  })
})
