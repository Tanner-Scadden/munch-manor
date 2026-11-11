import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { initialModel } from '../../src/app/pureApp'
import { PREPARATION_MS } from '../../src/shared/constants'
import {
  atCase,
  atOpenedCase,
  hidingSpotIn,
  withDareThings,
  withKeys,
} from '../../src/test/model.fixture'
import { asVeteran } from '../../src/test/veteran'
import { DareThingState } from '../../src/world/dare/dareSchema'
import { levelOf } from '../../src/world/level/arena'
import { KITCHEN_EXIT, exitKeysOf } from '../../src/world/level/exits'
import { DINING_ROOM_ID, KITCHEN_ROOM_ID } from '../../src/world/level/plan'
import {
  CaseState,
  Phase,
  Purchasable,
} from '../../src/world/schema/worldSchema'
import { caseToTake, wantedBoards } from './bot/escape'

// The balance bot's hunt (tools/balance/bot/escape.ts): the room holding a
// thing on the list gets bought open in a break, once the crew's ring holds
// the padlock's keys.

const IN_KITCHEN = hidingSpotIn(levelOf(initialModel), KITCHEN_ROOM_ID)
const IN_DINING_ROOM = hidingSpotIn(levelOf(initialModel), DINING_ROOM_ID)

// NOTE: past the kitchen tour's break, so the boards keep their price.
const WAVE_4_BREAK = Phase.Preparation({
  wave: 4,
  remainingMs: 15_000,
  durationMs: PREPARATION_MS,
  spawns: [],
})

const PRICE = exitKeysOf(KITCHEN_EXIT)

const breakWith = (keys: number, at = IN_KITCHEN) =>
  withKeys(
    withDareThings(
      modifyFields(asVeteran(initialModel), { phase: () => WAVE_4_BREAK }),
      [
        {
          id: 0,
          kind: 'ButlersBell',
          state: DareThingState.Hidden({ ...at, workedMs: 0 }),
        },
      ],
    ),
    keys,
  )

describe('the bot opens boards for the hunt', () => {
  test('for the room holding a thing on the list, with the keys on the ring', () => {
    const offer = wantedBoards(breakWith(PRICE))
    expect(
      offer !== undefined && Purchasable.isAnyOf(['Exit'])(offer.target),
    ).toBe(true)
  })

  test('not short of the keys', () => {
    expect(wantedBoards(breakWith(PRICE - 1))).toBeUndefined()
  })

  test('not for a thing in a room already open', () => {
    expect(wantedBoards(breakWith(PRICE, IN_DINING_ROOM))).toBeUndefined()
  })
})

describe('the bot takes from the display cases', () => {
  test('takes a gun from a case opened for it', () => {
    expect(
      caseToTake(atOpenedCase(asVeteran(initialModel), 'Smg')),
    ).toBeDefined()
  })

  test('leaves a case opened for another seat', () => {
    expect(
      caseToTake(
        atCase(
          modifyFields(asVeteran(initialModel), { phase: () => WAVE_4_BREAK }),
          'Smg',
          CaseState.Opened({ by: 1 }),
        ),
      ),
    ).toBeUndefined()
  })
})
