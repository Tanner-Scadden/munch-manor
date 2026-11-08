import { Array } from 'effect'
import { given, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import {
  CounterSale,
  Phase,
  Purchasable,
  Purchase,
  ShopState,
} from '../../../app/model'
import { update } from '../../../app/pureApp'
import { FIXED_STEP_MS } from '../../../shared/constants'
import { DISTANT_SPAWN, midWaveAtStall } from '../../../test/model.fixture'
import { STAND_TICKS, press, release, ticks } from '../../../test/testing'
import { freshGun, heldGun, maxRounds } from '../../gear/weapons'
import { focusOf, focusSlotOf, modifyFocus } from '../../party/party'
import type { World } from '../../schema/world'
import { Arsenal } from '../../schema/worldSchema'
import { ammoCounterOffers, isAtAmmoWindow } from '../ammoCounter'
import { PURCHASE_RULES, offersOf } from '../purchase'
import {
  SHOP_ITEMS,
  STALL_BOX,
  isShopOpenFor,
  refreshShopPresence,
} from '../shop'

// The ammo window (src/world/shop/ammoCounter.ts): mid-wave the stall sells the held
// gun's ammo, and nothing else, by the same stand or hold as any purchase.

const FRAME_MS = FIXED_STEP_MS
const HOLD_TICKS = Math.ceil(PURCHASE_RULES.holdMs / FRAME_MS) + 1
const ammoOffers = (current: World) =>
  Array.filter(offersOf(current, focusSlotOf(current)), offer =>
    Purchasable.isAnyOf(['Ammo'])(offer.target),
  )

describe('the ammo window mid-wave', () => {
  test.each([
    ['Smg', true],
    ['Shotgun', true],
    ['Cooker', true],
    ['Pan', false],
    ['Freeze', false],
  ] as const)('holding the %s, an offer: %s', (kind, isOffered) => {
    expect(Array.isArrayNonEmpty(ammoOffers(midWaveAtStall(kind, 0)))).toBe(
      isOffered,
    )
  })

  test('the Pop Pistol, which never runs dry, gets no offer', () => {
    const pistolInHand = modifyFocus(midWaveAtStall('Smg', 0), {
      player: player =>
        modifyFields(player, {
          arsenal: () => Arsenal.OneGun({ first: freshGun('Pistol') }),
        }),
    })
    expect(ammoOffers(pistolInHand)).toEqual([])
  })

  test("the price is the shop's for the held gun's ammo", () => {
    const [offer] = ammoOffers(midWaveAtStall('Smg', 10))
    expect(offer?.price).toBe(SHOP_ITEMS.SmgRounds.price)
    const [lids] = ammoOffers(midWaveAtStall('Cooker', 0))
    expect(lids?.price).toBe(SHOP_ITEMS.LidStack.price)
  })

  test('holding Enter at the window refills the gun in the hands and takes the price', () => {
    story(
      update,
      given(midWaveAtStall('Smg', 10)),
      press('Enter'),
      ...ticks(HOLD_TICKS, FRAME_MS),
      release('Enter'),
      model(current => {
        const gun = heldGun(focusOf(current).player.arsenal)
        expect(gun.kind).toBe('Smg')
        expect(gun.rounds).toBeGreaterThan(10)
        expect(focusOf(current).wallet.balance).toBe(
          100 - SHOP_ITEMS.SmgRounds.price,
        )
        expect(focusOf(current).shop).toEqual(ShopState.Away())
        expect(current.shopDialog.dialog.isOpen).toBe(false)
      }),
    )
  })

  test('standing still at the window buys too, and Rattles slides the rounds across', () => {
    story(
      update,
      given(midWaveAtStall('Shotgun', 0)),
      ...ticks(STAND_TICKS, FRAME_MS),
      model(current => {
        expect(heldGun(focusOf(current).player.arsenal).rounds).toBeGreaterThan(
          0,
        )
        expect(focusOf(current).wallet.balance).toBe(
          100 - SHOP_ITEMS.ShotgunShells.price,
        )
        expect(CounterSale.isAnyOf(['Selling'])(current.counterSale)).toBe(true)
        expect(isAtAmmoWindow(current, focusSlotOf(current))).toBe(true)
      }),
    )
  })

  test('a full gun shows FULL: a press is refused and standing never buys', () => {
    const full = midWaveAtStall('Smg', maxRounds('Smg', 0))
    const [offer] = ammoOffers(full)
    expect(offer?.isFull).toBe(true)
    story(
      update,
      given(full),
      ...ticks(STAND_TICKS * 2, FRAME_MS),
      model(current => {
        expect(focusOf(current).wallet.balance).toBe(100)
        expect(focusOf(current).purchase).toEqual(Purchase.Idle())
      }),
      press('Enter'),
      ...ticks(2, FRAME_MS),
      model(current => {
        expect(Purchase.isAnyOf(['Refused'])(focusOf(current).purchase)).toBe(
          true,
        )
        expect(focusOf(current).wallet.balance).toBe(100)
      }),
    )
  })

  test('it sells nothing else mid-wave: the only offer at the stall is ammo', () => {
    const current = midWaveAtStall('Smg', 0)
    expect(
      Array.map(
        Array.filter(
          offersOf(current, focusSlotOf(current)),
          offer => offer.box === STALL_BOX,
        ),
        offer => offer.target._tag,
      ),
    ).toEqual(['Ammo'])
  })
})

describe('in a break', () => {
  test('there is no window, and walking up opens the full shop', () => {
    const inBreak = modifyFocus(
      modifyFields(midWaveAtStall('Smg', 0), {
        phase: () =>
          Phase.Preparation({
            wave: 5,
            remainingMs: 15_000,
            durationMs: 20_000,
            spawns: [DISTANT_SPAWN],
          }),
      }),
      {
        player: player =>
          modifyFields(player, { y: () => STALL_BOX.bottom + 20 }),
      },
    )
    expect(ammoCounterOffers(inBreak, focusSlotOf(inBreak))).toEqual([])
    expect(isShopOpenFor(inBreak.phase)).toBe(true)
    const walkedUp = refreshShopPresence(
      modifyFocus(inBreak, {
        player: player => modifyFields(player, { y: () => STALL_BOX.bottom }),
      }),
      focusSlotOf(
        modifyFocus(inBreak, {
          player: player => modifyFields(player, { y: () => STALL_BOX.bottom }),
        }),
      ),
    )
    expect(ShopState.isAnyOf(['Browsing'])(focusOf(walkedUp).shop)).toBe(true)
    expect(ammoOffers(walkedUp)).toEqual([])
  })
})
