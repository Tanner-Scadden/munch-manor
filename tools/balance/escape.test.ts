import { Array, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { initialModel } from '../../src/app/pureApp'
import { PREPARATION_MS } from '../../src/shared/constants'
import { withDareThings } from '../../src/test/model.fixture'
import { asVeteran } from '../../src/test/veteran'
import { spotsOf } from '../../src/world/dare/dare'
import { DareThingState } from '../../src/world/dare/dareSchema'
import { levelOf } from '../../src/world/level/arena'
import { EXIT_RULES } from '../../src/world/level/exits'
import { modifyFocus } from '../../src/world/party/party'
import { Phase, Purchasable } from '../../src/world/schema/worldSchema'
import { wantedBoards } from './bot/escape'

// The balance bot's hunt (tools/balance/bot/escape.ts): a thing on the list
// hidden behind boards gets its room bought open in a break, once the bot
// has the price.

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

const breakWith = (balance: number, isAsked: boolean) =>
  modifyFocus(
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
    { wallet: wallet => modifyFields(wallet, { balance: () => balance }) },
  )

describe('the bot opens boards for the hunt', () => {
  test('for a thing on the list behind them, with the price in hand', () => {
    const offer = wantedBoards(breakWith(EXIT_RULES.price, true))
    expect(
      offer !== undefined && Purchasable.isAnyOf(['Exit'])(offer.target),
    ).toBe(true)
  })

  test('not without the price', () => {
    expect(wantedBoards(breakWith(EXIT_RULES.price - 1, true))).toBeUndefined()
  })

  test('not for a thing off the list', () => {
    expect(wantedBoards(breakWith(EXIT_RULES.price, false))).toBeUndefined()
  })
})
