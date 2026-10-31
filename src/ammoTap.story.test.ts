import { Option } from 'effect'
import { given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'

import { FIXED_STEP_MS } from './constants'
import { update } from './main'
import { Message } from './message'
import { CounterSale, type Model, Phase, Purchasable, Purchase } from './model'
import { midWaveAtStall, withPlayerAt } from './model.fixture'
import { actionCodeOf, heldAction, seatActionOf } from './roomWorld'
import { SHOP_ITEMS, STALL_BOX } from './shop'
import { SeatAction, applySeatAction, soloInputs, stepWorld } from './stepWorld'
import { HOLD_TICKS, STAND_TICKS, press, release, tick, ticks } from './testing'
import { heldGun } from './weapons'
import { GameEvent, SOLO_SLOT, idleIntent } from './worldSchema'

// Tap to buy at the ammo window (src/purchase.ts, tapToBuy; decided with
// the owner on 2026-10-31): Enter, the touch hold button, or a click on the
// tag buys one refill at once, with no ring to fill.

const FRAME_MS = FIXED_STEP_MS
const PRICE = SHOP_ITEMS.SmgRounds.price

const tapHoldButton = message(Message.PressedHoldButton({ pointerId: 7 }))
const liftHoldButton = message(Message.ReleasedPointer({ pointerId: 7 }))
const clickTag = message(Message.ClickedAmmoTag())

const expectBoughtOnce = (current: Model): void => {
  expect(heldGun(current.player.arsenal).rounds).toBeGreaterThan(10)
  expect(current.wallet.balance).toBe(100 - PRICE)
  expect(CounterSale.isAnyOf(['Selling'])(current.counterSale)).toBe(true)
}

describe('a tap at the ammo window buys at once', () => {
  test('a press of Enter buys on the next frame', () => {
    story(
      update,
      given(midWaveAtStall('Smg', 10)),
      press('Enter'),
      tick(FRAME_MS),
      model(expectBoughtOnce),
      release('Enter'),
    )
  })

  test('a tap of the touch hold button buys on the next frame', () => {
    story(
      update,
      given(midWaveAtStall('Smg', 10)),
      tapHoldButton,
      tick(FRAME_MS),
      model(expectBoughtOnce),
      liftHoldButton,
    )
  })

  test('a click on the tag buys on the next frame', () => {
    story(
      update,
      given(midWaveAtStall('Smg', 10)),
      clickTag,
      tick(FRAME_MS),
      model(expectBoughtOnce),
    )
  })

  test('Enter held on after the tap buys once, and a second press buys again', () => {
    story(
      update,
      given(midWaveAtStall('Smg', 10)),
      press('Enter'),
      ...ticks(HOLD_TICKS * 3, FRAME_MS),
      model(current => {
        expect(current.wallet.balance).toBe(100 - PRICE)
      }),
      release('Enter'),
      tick(FRAME_MS),
      press('Enter'),
      tick(FRAME_MS),
      model(current => {
        expect(current.wallet.balance).toBe(100 - PRICE * 2)
      }),
      release('Enter'),
    )
  })

  test('short of the price a tap is refused, with the shake and the shortfall', () => {
    story(
      update,
      given(midWaveAtStall('Smg', 10, PRICE - 5)),
      clickTag,
      tick(FRAME_MS),
      model(current => {
        expect(current.wallet.balance).toBe(PRICE - 5)
        expect(heldGun(current.player.arsenal).rounds).toBe(10)
        expect(current.purchase).toEqual(
          Purchase.Refused({
            target: Purchasable.Ammo(),
            shortBy: 5,
            sinceMs: 0,
          }),
        )
      }),
    )
  })

  test('away from the window Enter buys nothing and the wave goes on', () => {
    story(
      update,
      given(withPlayerAt(midWaveAtStall('Smg', 10), STALL_BOX.left - 80, 120)),
      press('Enter'),
      clickTag,
      tick(FRAME_MS),
      model(current => {
        expect(current.wallet.balance).toBe(100)
        expect(Phase.isAnyOf(['Wave'])(current.phase)).toBe(true)
      }),
      release('Enter'),
    )
  })

  test('standing still still takes the full second, so walking past never buys', () => {
    story(
      update,
      given(midWaveAtStall('Smg', 10)),
      ...ticks(STAND_TICKS - 4, FRAME_MS),
      model(current => {
        expect(current.wallet.balance).toBe(100)
        expect(Purchase.isAnyOf(['Holding'])(current.purchase)).toBe(true)
      }),
      ...ticks(4, FRAME_MS),
      model(current => {
        expect(current.wallet.balance).toBe(100 - PRICE)
      }),
    )
  })

  test("in a co-op room the press off the wire buys on the room's next tick, with no key held", () => {
    const from = midWaveAtStall('Smg', 10)
    const read = seatActionOf(
      from,
      heldAction(actionCodeOf(SeatAction.BuyAmmo()), 1),
    )
    expect(read).toEqual(Option.some(SeatAction.BuyAmmo()))
    const pressed = applySeatAction(from, SOLO_SLOT, SeatAction.BuyAmmo())
    const { world, events } = stepWorld(pressed, soloInputs(idleIntent))
    expect(world.wallet.balance).toBe(100 - PRICE)
    expect(heldGun(world.player.arsenal).rounds).toBeGreaterThan(10)
    expect(events.some(GameEvent.isAnyOf(['Purchased']))).toBe(true)
  })
})
