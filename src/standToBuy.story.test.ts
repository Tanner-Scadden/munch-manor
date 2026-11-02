import { given, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { FIXED_STEP_MS } from './constants'
import { EXIT_RULES } from './exits'
import { FRIDGE_RULES } from './leftovers'
import { update } from './main'
import { FridgeDoor, type Model, Phase, Purchase, ShopState } from './model'
import {
  DISTANT_SPAWN,
  atFridge,
  freshRunModel,
  fridgeSeededFor,
  pastTimedBreaks,
} from './model.fixture'
import { focusOf, focusSlotOf, modifyFocus } from './party'
import { PURCHASE_RULES, holdProgress, isStandingToBuy } from './purchase'
import {
  BELOW_KITCHEN_DOOR,
  HOLD_TICKS,
  STAND_TICKS,
  holdFire,
  isKitchenOpen,
  press,
  release,
  ticks,
} from './testing'
import { isCarrying } from './weapons'

// Standing still to buy (src/purchase.ts): at a purchasable, a player who
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
  test('standing still at the boards for a second buys them, with the ring filling meanwhile', () => {
    story(
      update,
      given(atBoards(85)),
      ...ticks(Math.floor(STAND_TICKS / 2), FRAME_MS),
      model(current => {
        expect(Purchase.isAnyOf(['Holding'])(focusOf(current).purchase)).toBe(
          true,
        )
        expect(holdProgress(focusOf(current).purchase)).toBeGreaterThan(0.4)
        expect(holdProgress(focusOf(current).purchase)).toBeLessThan(0.6)
        expect(isKitchenOpen(current)).toBe(false)
      }),
      ...ticks(STAND_TICKS - Math.floor(STAND_TICKS / 2), FRAME_MS),
      model(current => {
        expect(isKitchenOpen(current)).toBe(true)
        expect(focusOf(current).wallet.balance).toBe(85 - EXIT_RULES.price)
      }),
    )
  })

  test('the key is faster: half a second of holding buys, half a second of standing does not', () => {
    story(
      update,
      given(atBoards(85)),
      ...ticks(HOLD_TICKS, FRAME_MS),
      model(current => {
        expect(isKitchenOpen(current)).toBe(false)
      }),
    )
    story(
      update,
      given(atBoards(85)),
      press('Enter'),
      ...ticks(HOLD_TICKS, FRAME_MS),
      model(current => {
        expect(isKitchenOpen(current)).toBe(true)
      }),
    )
  })

  test('moving resets the ring, and the next stand starts over', () => {
    story(
      update,
      given(atBoards(85)),
      ...ticks(STAND_TICKS - 10, FRAME_MS),
      press('KeyD'),
      ...ticks(1, FRAME_MS),
      release('KeyD'),
      press('KeyA'),
      ...ticks(1, FRAME_MS),
      release('KeyA'),
      model(current => {
        expect(focusOf(current).purchase).toEqual(Purchase.Idle())
      }),
      ...ticks(STAND_TICKS - 10, FRAME_MS),
      model(current => {
        expect(isKitchenOpen(current)).toBe(false)
        expect(focusOf(current).wallet.balance).toBe(85)
      }),
    )
  })

  test('firing resets the ring, and standing and shooting never buys', () => {
    story(
      update,
      given(atBoards(85)),
      ...ticks(STAND_TICKS - 10, FRAME_MS),
      holdFire,
      ...ticks(1, FRAME_MS),
      model(current => {
        expect(focusOf(current).purchase).toEqual(Purchase.Idle())
      }),
      ...ticks(STAND_TICKS * 3, FRAME_MS),
      model(current => {
        expect(isKitchenOpen(current)).toBe(false)
        expect(focusOf(current).wallet.balance).toBe(85)
      }),
    )
  })

  test('stabbing resets the ring too', () => {
    story(
      update,
      given(atBoards(85)),
      ...ticks(STAND_TICKS - 10, FRAME_MS),
      press('KeyF'),
      holdFire,
      ...ticks(1, FRAME_MS),
      model(current => {
        expect(focusOf(current).purchase).toEqual(Purchase.Idle())
      }),
      ...ticks(STAND_TICKS * 2, FRAME_MS),
      model(current => {
        expect(isKitchenOpen(current)).toBe(false)
      }),
    )
  })

  test('standing short of the price does nothing: no shake, no buy', () => {
    story(
      update,
      given(atBoards(EXIT_RULES.price - 5)),
      ...ticks(STAND_TICKS * 2, FRAME_MS),
      model(current => {
        expect(focusOf(current).purchase).toEqual(Purchase.Idle())
        expect(isKitchenOpen(current)).toBe(false)
      }),
    )
  })

  test('not in the first moments of a wave', () => {
    const waveStart = modifyFields(atBoards(85), {
      phase: () =>
        Phase.Wave({ wave: 3, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
    })
    story(
      update,
      given(waveStart),
      ...ticks(STAND_TICKS, FRAME_MS),
      model(current => {
        expect(isKitchenOpen(current)).toBe(false)
      }),
      ...ticks(
        Math.ceil(PURCHASE_RULES.waveGraceMs / FRAME_MS) + STAND_TICKS,
        FRAME_MS,
      ),
      model(current => {
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
  test('a pull by standing does not take its prize until the player moves, then standing takes it', () => {
    story(
      update,
      given(fridgeSeededFor(atFridge(400), 'Cooker')),
      ...ticks(STAND_TICKS, FRAME_MS),
      model(current => {
        expect(FridgeDoor.isAnyOf(['Open'])(current.fridge.door)).toBe(true)
        expect(current.stats.purchases).toBe(1)
      }),
      ...ticks(
        Math.ceil(FRIDGE_RULES.openMs / FRAME_MS) + STAND_TICKS * 2,
        FRAME_MS,
      ),
      model(current => {
        expect(FridgeDoor.isAnyOf(['Offering'])(current.fridge.door)).toBe(true)
        expect(focusOf(current).purchase).toEqual(Purchase.Spent())
        expect(current.stats.purchases).toBe(1)
      }),
      press('KeyD'),
      ...ticks(1, FRAME_MS),
      release('KeyD'),
      ...ticks(STAND_TICKS, FRAME_MS),
      model(current => {
        expect(FridgeDoor.isAnyOf(['Offering'])(current.fridge.door)).toBe(
          false,
        )
        expect(isCarrying(focusOf(current).player, 'Cooker')).toBe(true)
      }),
    )
  })

  test('the key still takes the prize at once after a standing pull', () => {
    story(
      update,
      given(fridgeSeededFor(atFridge(400), 'Cooker')),
      ...ticks(STAND_TICKS, FRAME_MS),
      ...ticks(Math.ceil(FRIDGE_RULES.openMs / FRAME_MS) + 2, FRAME_MS),
      model(current => {
        expect(focusOf(current).purchase).toEqual(Purchase.Spent())
      }),
      press('Enter'),
      ...ticks(HOLD_TICKS, FRAME_MS),
      model(current => {
        expect(isCarrying(focusOf(current).player, 'Cooker')).toBe(true)
      }),
    )
  })
})
