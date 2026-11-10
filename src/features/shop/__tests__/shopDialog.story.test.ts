import { Array, Effect, Option } from 'effect'
import { Story } from 'foldkit'

import { describe, expect, it, test } from '@effect/vitest'

import { ShopDialogBinding } from '../../../app/bindings'
import {
  type Model,
  ShopChatter,
  type ShopItemId,
  ShopState,
  type WeaponKind,
} from '../../../app/model'
import { SHAMBLER_BOUNTY } from '../../../shared/constants'
import { withArsenal } from '../../../test/model.fixture'
import {
  APPLICATION,
  holdingFirst,
  holdingSecond,
  press,
  ticks,
} from '../../../test/testing'
import { UPGRADE_TIERS } from '../../../world/gear/weapons'
import { focusSlotOf } from '../../../world/party/party'
import {
  affordableCount,
  gunShelves,
  itemsIn,
  totalAffordable,
} from '../../../world/shop/shop'
import { waveBonus } from '../../../world/waves/waves'
import { Message as ShopMessage } from '../message'
import {
  FRAMES_TO_STALL,
  SHOP_FRAME_MS,
  besideStall,
  browsing,
  gun,
  holdingSpare,
  preparing,
  resolveShowShop,
  shopReady,
  withMoney,
} from './shop.fixture'

describe('shop categories', () => {
  const WAVE_ONE_PAY = 6 * SHAMBLER_BOUNTY + waveBonus(1)

  test('each tab counts what the player can buy right now', () => {
    const firstVisit = browsing(withMoney(shopReady, WAVE_ONE_PAY))
    expect(affordableCount(firstVisit, focusSlotOf(firstVisit), 'Guns')).toBe(0)
    expect(totalAffordable(firstVisit, focusSlotOf(firstVisit))).toBe(0)

    const armed = withArsenal(withMoney(firstVisit, 100), holdingSpare(20))
    expect(affordableCount(armed, focusSlotOf(armed), 'Guns')).toBe(0)

    expect(
      totalAffordable(
        withMoney(firstVisit, 0),
        focusSlotOf(withMoney(firstVisit, 0)),
      ),
    ).toBe(0)
  })

  test('every gun in the shop or a case levels at 40, 120, and 250 kills', () => {
    const lines: ReadonlyArray<WeaponKind> = ['Shotgun', 'Smg', 'Pistol']
    Array.forEach(lines, weapon => {
      expect(Array.map(UPGRADE_TIERS[weapon], ({ kills }) => kills)).toEqual([
        40, 120, 250,
      ])
    })
  })
})

describe('the gun shelves', () => {
  test('the pistol comes first, then a case gun once carried, and no gun is for sale', () => {
    const unarmed = browsing(withMoney(shopReady, 100))
    const weaponOrder = (current: Model): ReadonlyArray<WeaponKind> =>
      Array.map(
        gunShelves(current, focusSlotOf(current)),
        ({ weapon }) => weapon,
      )

    expect(weaponOrder(unarmed)).toEqual(['Pistol'])
    expect(itemsIn(unarmed, focusSlotOf(unarmed), 'Guns')).toEqual([
      'LaserSight',
    ])

    const shotgunInHand = withArsenal(unarmed, holdingSpare(20))
    expect(weaponOrder(shotgunInHand)).toEqual(['Pistol', 'Shotgun'])
    expect(itemsIn(shotgunInHand, focusSlotOf(shotgunInHand), 'Guns')).toEqual([
      'LaserSight',
    ])

    const smgHolstered = withArsenal(unarmed, holdingFirst(gun('Smg', 60)))
    expect(weaponOrder(smgHolstered)).toEqual(['Pistol', 'Smg'])
  })

  it.effect('a refused purchase leaves focus alone', () =>
    Story.story(
      APPLICATION,
      Story.given(browsing(withMoney(shopReady, 10))),
      Story.messageIn(
        ShopDialogBinding,
        ShopMessage.PressedBuyKey({ item: 'Shotgun' }),
      ),
      Story.Command.expectNone(),
      Story.model(({ seats: [{ shop }] }) => {
        expect(shop).toEqual(ShopState.Browsing({ focusedItem: 'LaserSight' }))
      }),
    ),
  )
})

describe('the row the shop opens on', () => {
  // NOTE: the row the shop is on once the player walks up to the stall.
  const focusAfterWalkingUp = (base: Model) =>
    Story.story(
      APPLICATION,
      Story.given(base),
      press('KeyD'),
      ...ticks(FRAMES_TO_STALL, SHOP_FRAME_MS),
      resolveShowShop,
    ).pipe(
      Effect.map(
        ({ seats: [{ shop }] }): ShopItemId =>
          Option.getOrThrow(
            Option.liftPredicate(shop, ShopState.guards.Browsing),
          ).focusedItem,
      ),
    )

  it.effect(
    'with only the pistol, it opens on the Laser Sight: no gun is for sale',
    () =>
      focusAfterWalkingUp(withMoney(besideStall(preparing(2)), 40)).pipe(
        Effect.map(focused => {
          expect(focused).toBe('LaserSight')
        }),
      ),
  )
})

describe('what Rattles says', () => {
  it.effect(
    'he greets, and refuses a gun that sits in a display case',
    () =>
      Story.story(
        APPLICATION,
        Story.given(
          withArsenal(
            browsing(withMoney(shopReady, 30)),
            holdingSecond(gun('Shotgun', 48)),
          ),
        ),
        Story.model(({ shopChatter }) => {
          expect(shopChatter).toEqual(ShopChatter.Greeting())
        }),
        Story.messageIn(
          ShopDialogBinding,
          ShopMessage.PressedBuyKey({ item: 'Shotgun' }),
        ),
        Story.model(({ shopChatter }) => {
          expect(shopChatter).toEqual(ShopChatter.Refused({ item: 'Shotgun' }))
        }),
      ),
  )
})
