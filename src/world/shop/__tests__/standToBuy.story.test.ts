import { Effect } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it, test } from '@effect/vitest'

import {
  FridgeDoor,
  type Model,
  Phase,
  Purchase,
  ShopState,
} from '../../../app/model'
import { FIXED_STEP_MS } from '../../../shared/constants'
import {
  DISTANT_SPAWN,
  atFridge,
  freshRunModel,
  fridgeSeededFor,
  pastTimedBreaks,
} from '../../../test/model.fixture'
import {
  APPLICATION,
  BELOW_KITCHEN_DOOR,
  HOLD_TICKS,
  STAND_TICKS,
  holdFire,
  isKitchenOpen,
  press,
  release,
  ticks,
} from '../../../test/testing'
import { FRIDGE_RULES } from '../../fridge/leftovers'
import { isCarrying } from '../../gear/weapons'
import { EXIT_RULES } from '../../level/exits'
import { focusOf, focusSlotOf, modifyFocus } from '../../party/party'
import { PURCHASE_RULES, holdProgress, isStandingToBuy } from '../purchase'

// Standing still to buy (src/world/shop/purchase.ts): at a purchasable, a player who
// stands still for a second buys it, as a teammate revives by standing
// still; the interact key still buys in half a second. Firing, stabbing,
// or moving resets the ring, and one buy never chains into the next.

const FRAME_MS = FIXED_STEP_MS
const atBoards = (balance: number): Model =>
  modifyFocus(
    modifyFields(pastTimedBreaks(freshRunModel()), {
      phase: () =>
        Phase.Preparation({
          wave: 3,
          remainingMs: 15_000,
          durationMs: 20_000,
          spawns: [DISTANT_SPAWN],
        }),
    }),
    {
      wallet: () => ({ balance, earned: balance, shown: balance }),
      player: player =>
        modifyFields(player, {
          x: () => BELOW_KITCHEN_DOOR.x,
          y: () => BELOW_KITCHEN_DOOR.y,
        }),
    },
  )

describe('standing still to buy', () => {
  it.effect(
    'standing still at the boards for a second buys them, with the ring filling meanwhile',
    () =>
      Story.story(
        APPLICATION,
        Story.given(atBoards(85)),
        ...ticks(Math.floor(STAND_TICKS / 2), FRAME_MS),
        Story.model(current => {
          expect(Purchase.isAnyOf(['Holding'])(focusOf(current).purchase)).toBe(
            true,
          )
          expect(holdProgress(focusOf(current).purchase)).toBeGreaterThan(0.4)
          expect(holdProgress(focusOf(current).purchase)).toBeLessThan(0.6)
          expect(isKitchenOpen(current)).toBe(false)
        }),
        ...ticks(STAND_TICKS - Math.floor(STAND_TICKS / 2), FRAME_MS),
        Story.model(current => {
          expect(isKitchenOpen(current)).toBe(true)
          expect(focusOf(current).wallet.balance).toBe(85 - EXIT_RULES.price)
        }),
      ),
  )

  it.effect(
    'the key is faster: half a second of holding buys, half a second of standing does not',
    () =>
      Effect.gen(function* () {
        yield* Story.story(
          APPLICATION,
          Story.given(atBoards(85)),
          ...ticks(HOLD_TICKS, FRAME_MS),
          Story.model(current => {
            expect(isKitchenOpen(current)).toBe(false)
          }),
        )
        yield* Story.story(
          APPLICATION,
          Story.given(atBoards(85)),
          press('Enter'),
          ...ticks(HOLD_TICKS, FRAME_MS),
          Story.model(current => {
            expect(isKitchenOpen(current)).toBe(true)
          }),
        )
      }),
  )

  it.effect('moving resets the ring, and the next stand starts over', () =>
    Story.story(
      APPLICATION,
      Story.given(atBoards(85)),
      ...ticks(STAND_TICKS - 10, FRAME_MS),
      press('KeyD'),
      ...ticks(1, FRAME_MS),
      release('KeyD'),
      press('KeyA'),
      ...ticks(1, FRAME_MS),
      release('KeyA'),
      Story.model(current => {
        expect(focusOf(current).purchase).toEqual(Purchase.Idle())
      }),
      ...ticks(STAND_TICKS - 10, FRAME_MS),
      Story.model(current => {
        expect(isKitchenOpen(current)).toBe(false)
        expect(focusOf(current).wallet.balance).toBe(85)
      }),
    ),
  )

  it.effect(
    'firing resets the ring, and standing and shooting never buys',
    () =>
      Story.story(
        APPLICATION,
        Story.given(atBoards(85)),
        ...ticks(STAND_TICKS - 10, FRAME_MS),
        holdFire,
        ...ticks(1, FRAME_MS),
        Story.model(current => {
          expect(focusOf(current).purchase).toEqual(Purchase.Idle())
        }),
        ...ticks(STAND_TICKS * 3, FRAME_MS),
        Story.model(current => {
          expect(isKitchenOpen(current)).toBe(false)
          expect(focusOf(current).wallet.balance).toBe(85)
        }),
      ),
  )

  it.effect('stabbing resets the ring too', () =>
    Story.story(
      APPLICATION,
      Story.given(atBoards(85)),
      ...ticks(STAND_TICKS - 10, FRAME_MS),
      press('KeyF'),
      holdFire,
      ...ticks(1, FRAME_MS),
      Story.model(current => {
        expect(focusOf(current).purchase).toEqual(Purchase.Idle())
      }),
      ...ticks(STAND_TICKS * 2, FRAME_MS),
      Story.model(current => {
        expect(isKitchenOpen(current)).toBe(false)
      }),
    ),
  )

  it.effect('standing short of the price does nothing: no shake, no buy', () =>
    Story.story(
      APPLICATION,
      Story.given(atBoards(EXIT_RULES.price - 5)),
      ...ticks(STAND_TICKS * 2, FRAME_MS),
      Story.model(current => {
        expect(focusOf(current).purchase).toEqual(Purchase.Idle())
        expect(isKitchenOpen(current)).toBe(false)
      }),
    ),
  )

  it.effect('not in the first moments of a wave', () => {
    const waveStart = modifyFields(atBoards(85), {
      phase: () =>
        Phase.Wave({ wave: 3, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
    })
    return Story.story(
      APPLICATION,
      Story.given(waveStart),
      ...ticks(STAND_TICKS, FRAME_MS),
      Story.model(current => {
        expect(isKitchenOpen(current)).toBe(false)
      }),
      ...ticks(
        Math.ceil(PURCHASE_RULES.waveGraceMs / FRAME_MS) + STAND_TICKS,
        FRAME_MS,
      ),
      Story.model(current => {
        expect(isKitchenOpen(current)).toBe(true)
      }),
    )
  })

  test('not while the shop is open', () => {
    const standing = atBoards(85)
    expect(isStandingToBuy(standing, focusSlotOf(standing))).toBe(true)
    expect(
      isStandingToBuy(
        modifyFocus(standing, {
          shop: () => ShopState.Browsing({ focusedItem: 'Shotgun' }),
        }),
        focusSlotOf(
          modifyFocus(standing, {
            shop: () => ShopState.Browsing({ focusedItem: 'Shotgun' }),
          }),
        ),
      ),
    ).toBe(false)
  })
})

describe('one buy never chains into the next', () => {
  it.effect(
    'a pull by standing does not take its prize until the player moves, then standing takes it',
    () =>
      Story.story(
        APPLICATION,
        Story.given(fridgeSeededFor(atFridge(400), 'Cooker')),
        ...ticks(STAND_TICKS, FRAME_MS),
        Story.model(current => {
          expect(FridgeDoor.isAnyOf(['Open'])(current.fridge.door)).toBe(true)
          expect(current.stats.purchases).toBe(1)
        }),
        ...ticks(
          Math.ceil(FRIDGE_RULES.openMs / FRAME_MS) + STAND_TICKS * 2,
          FRAME_MS,
        ),
        Story.model(current => {
          expect(FridgeDoor.isAnyOf(['Offering'])(current.fridge.door)).toBe(
            true,
          )
          expect(focusOf(current).purchase).toEqual(Purchase.Spent())
          expect(current.stats.purchases).toBe(1)
        }),
        press('KeyD'),
        ...ticks(1, FRAME_MS),
        release('KeyD'),
        ...ticks(STAND_TICKS, FRAME_MS),
        Story.model(current => {
          expect(FridgeDoor.isAnyOf(['Offering'])(current.fridge.door)).toBe(
            false,
          )
          expect(isCarrying(focusOf(current).player, 'Cooker')).toBe(true)
        }),
      ),
  )

  it.effect('the key still takes the prize at once after a standing pull', () =>
    Story.story(
      APPLICATION,
      Story.given(fridgeSeededFor(atFridge(400), 'Cooker')),
      ...ticks(STAND_TICKS, FRAME_MS),
      ...ticks(Math.ceil(FRIDGE_RULES.openMs / FRAME_MS) + 2, FRAME_MS),
      Story.model(current => {
        expect(focusOf(current).purchase).toEqual(Purchase.Spent())
      }),
      press('Enter'),
      ...ticks(HOLD_TICKS, FRAME_MS),
      Story.model(current => {
        expect(isCarrying(focusOf(current).player, 'Cooker')).toBe(true)
      }),
    ),
  )
})
