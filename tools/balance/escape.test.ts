import { Array, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { initialModel } from '../../src/app/pureApp'
import { PREPARATION_MS } from '../../src/shared/constants'
import {
  atCase,
  atOpenedCase,
  freshRunModel,
  withDareThings,
  withKeys,
} from '../../src/test/model.fixture'
import { asVeteran } from '../../src/test/veteran'
import { DELIVER_REACH_PX, spotsOf } from '../../src/world/dare/dare'
import { DareThingState } from '../../src/world/dare/dareSchema'
import { CASE_SPOTS, caseFootOf } from '../../src/world/feats/caseSpots'
import { levelOf, openExitIn } from '../../src/world/level/arena'
import { KITCHEN_EXIT, exitKeysOf } from '../../src/world/level/exits'
import { modifyFocus } from '../../src/world/party/party'
import {
  CaseState,
  Feat,
  Phase,
  Purchasable,
} from '../../src/world/schema/worldSchema'
import { distance } from './bot/basics'
import {
  caseToTake,
  deliveryTarget,
  wantedBoards,
  wantsStoveFeat,
} from './bot/escape'

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

describe('the bot takes and fills the display cases', () => {
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

  const holding = (isCaseLocked: boolean) =>
    withDareThings(
      atCase(
        modifyFields(asVeteran(initialModel), { phase: () => WAVE_4_BREAK }),
        'Smg',
        isCaseLocked ? CaseState.Locked() : CaseState.Emptied({ by: 0 }),
        Feat.Kills({ count: 500 }),
      ),
      [
        {
          id: 0,
          kind: 'MusicBox',
          isAsked: false,
          state: DareThingState.Held({ slot: 0 }),
        },
      ],
    )

  test('carries a thing off the list to a locked case', () => {
    const model = holding(true)
    const target = deliveryTarget(model)
    const foot = caseFootOf(
      levelOf(model),
      Option.getOrThrow(Array.head(model.cases)),
    )
    expect(
      target !== undefined && distance(target, foot) <= DELIVER_REACH_PX,
    ).toBe(true)
  })

  test('has nowhere to carry it with no case locked', () => {
    expect(deliveryTarget(holding(false))).toBeUndefined()
  })

  test('buys the boards of a room whose case holds a thing on the list', () => {
    const farSpot = Option.getOrThrow(
      Array.findFirstIndex(CASE_SPOTS, ({ isNear }) => !isNear),
    )
    const model = withKeys(
      withDareThings(
        modifyFields(asVeteran(initialModel), {
          phase: () => WAVE_4_BREAK,
          cases: () => [
            {
              id: 0,
              spot: farSpot,
              prize: 'Rifle',
              feat: Feat.Kills({ count: 500 }),
              state: CaseState.Locked(),
            },
          ],
        }),
        [
          {
            id: 0,
            kind: 'GuestBookPage',
            isAsked: true,
            state: DareThingState.InCase({ caseId: 0 }),
          },
        ],
      ),
      10,
    )
    const offer = wantedBoards(model)
    expect(
      offer !== undefined && Purchasable.isAnyOf(['Exit'])(offer.target),
    ).toBe(true)
  })
})

describe('the bot chases the stove for the recipe', () => {
  const withRecipe = (hp: number) =>
    modifyFocus(
      withDareThings(
        modifyFields(freshRunModel(), {
          level: level => openExitIn(level, KITCHEN_EXIT),
        }),
        [
          {
            id: 0,
            kind: 'GrandmasRecipe',
            isAsked: true,
            state: DareThingState.InStove(),
          },
        ],
      ),
      { player: player => modifyFields(player, { hp: () => hp }) },
    )

  test('with the recipe in the stove and hearts to spare', () => {
    expect(wantsStoveFeat(withRecipe(5))).toBe(true)
  })

  test('not on its last hearts', () => {
    expect(wantsStoveFeat(withRecipe(2))).toBe(false)
  })
})
