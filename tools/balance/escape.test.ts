import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import type { Model } from '../../src/app/model'
import { initialModel } from '../../src/app/pureApp'
import { PREPARATION_MS } from '../../src/shared/constants'
import {
  atCase,
  atOpenedCase,
  hidingSpotIn,
  roomOpenIn,
  withDareThings,
  withKeys,
  withPlayerAt,
} from '../../src/test/model.fixture'
import { asVeteran } from '../../src/test/veteran'
import { DareThingState } from '../../src/world/dare/dareSchema'
import { levelOf, openExitIn } from '../../src/world/level/arena'
import { EXIT_RULES, KITCHEN_EXIT } from '../../src/world/level/exits'
import {
  CELLAR_ROOM_ID,
  DEFAULT_ARRANGEMENT,
  DINING_ROOM_ID,
  KITCHEN_ROOM_ID,
} from '../../src/world/level/plan'
import {
  CaseState,
  Phase,
  Purchasable,
} from '../../src/world/schema/worldSchema'
import {
  caseToTake,
  escapeTarget,
  isWorkingForEscape,
  wantedBoards,
} from './bot/escape'

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

const PRICE = EXIT_RULES.kitchenKeys

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

// NOTE: the kitchen hauls its thing up the dumbwaiter, worked by keeping
// still in reach (src/world/dare/finds.ts); the dining room walks onto it;
// the cellar's waits for the bulb's light, which only a wave can yank.
describe("the bot works a room's find", () => {
  const kitchenOpen = (model: Model): Model =>
    modifyFields(model, { level: level => openExitIn(level, KITCHEN_EXIT) })

  test('keeps still in reach of a worked find', () => {
    expect(
      isWorkingForEscape(
        withPlayerAt(kitchenOpen(breakWith(0)), IN_KITCHEN.x, IN_KITCHEN.y),
      ),
    ).toBe(true)
  })

  test('walks on while out of its reach', () => {
    expect(
      isWorkingForEscape(
        withPlayerAt(
          kitchenOpen(breakWith(0)),
          IN_KITCHEN.x,
          IN_KITCHEN.y + 20,
        ),
      ),
    ).toBe(false)
  })

  test('never stops on a thing walked onto', () => {
    expect(
      isWorkingForEscape(
        withPlayerAt(
          breakWith(0, IN_DINING_ROOM),
          IN_DINING_ROOM.x,
          IN_DINING_ROOM.y,
        ),
      ),
    ).toBe(false)
  })

  test("leaves the dark cellar's thing for the wave", () => {
    const cellarBreak = modifyFields(
      breakWith(0, hidingSpotIn(levelOf(initialModel), CELLAR_ROOM_ID)),
      { level: () => roomOpenIn(DEFAULT_ARRANGEMENT, 'Cellar') },
    )
    expect(escapeTarget(cellarBreak)).toBeUndefined()
  })
})
