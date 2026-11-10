import { Array, Effect, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it, test } from '@effect/vitest'
import { DialogBlock, Tabs } from '@foldkit/ui'

import { ShopDialogBinding } from '../../../app/bindings'
import {
  type Model,
  Phase,
  type ShopCategory,
  ShopChatter,
  type ShopItemId,
  ShopState,
  type WeaponKind,
} from '../../../app/model'
import { PLAYER_MAX_HP, SHAMBLER_BOUNTY } from '../../../shared/constants'
import { withArsenal, withShopDialogOpen } from '../../../test/model.fixture'
import {
  APPLICATION,
  RESTART_GRACE_TICKS,
  closeDialog,
  holdingFirst,
  holdingSecond,
  press,
  ticks,
} from '../../../test/testing'
import { UPGRADE_TIERS } from '../../../world/gear/weapons'
import { focusSlotOf, modifyFocus } from '../../../world/party/party'
import {
  SHOP_CATEGORY_ORDER,
  affordableCount,
  gunShelves,
  itemsIn,
  totalAffordable,
} from '../../../world/shop/shop'
import { waveBonus } from '../../../world/waves/waves'
import { DialogBinding, TabsBinding } from '../bindings'
import { Message as ShopMessage } from '../message'
import { ShopTabsBlock } from '../shopTabs'
import {
  FRAMES_TO_STALL,
  GRACE_TICK_MS,
  SHOP_FRAME_MS,
  besideStall,
  browsing,
  gun,
  holdingSpare,
  preparing,
  resolveShowShop,
  shopReady,
  withHp,
  withMoney,
} from './shop.fixture'

describe('shop categories', () => {
  const WAVE_ONE_PAY = 6 * SHAMBLER_BOUNTY + waveBonus(1)

  const selectTab = (value: ShopCategory) =>
    Story.messageIn(
      [ShopDialogBinding, TabsBinding],
      ShopTabsBlock.Message.SelectedTab({
        index: Option.getOrElse(
          Array.findFirstIndex(SHOP_CATEGORY_ORDER, tab => tab === value),
          () => 0,
        ),
        value,
      }),
    )

  const resolveFocusTab = Story.Command.resolve(
    Tabs.test.FocusTab,
    ShopTabsBlock.Message.CompletedFocusTab(),
  )

  it.effect(
    'choosing a tab shows its items, focuses its first item, and moves keyboard focus to the tab',
    () =>
      Story.story(
        APPLICATION,
        Story.given(withShopDialogOpen(browsing(withMoney(shopReady, 100)))),
        Story.model(({ seats: [{ shopCategory }] }) => {
          expect(shopCategory).toBe('Guns')
        }),
        selectTab('Traps'),
        Story.Command.expectExact(Tabs.test.FocusTab),
        resolveFocusTab,
        Story.model(({ seats: [{ shopCategory, shop }] }) => {
          expect(shopCategory).toBe('Traps')
          expect(shop).toEqual(ShopState.Browsing({ focusedItem: 'Barricade' }))
        }),
        selectTab('Health'),
        resolveFocusTab,
        Story.model(({ seats: [{ shopCategory, shop }] }) => {
          expect(shopCategory).toBe('Health')
          expect(shop).toEqual(ShopState.Browsing({ focusedItem: 'Heart' }))
        }),
      ),
  )

  it.effect(
    'the shop reopens on the last tab chosen in the run, and a new run starts on Guns',
    () =>
      Effect.gen(function* () {
        yield* Story.story(
          APPLICATION,
          Story.given(withShopDialogOpen(browsing(withMoney(shopReady, 100)))),
          selectTab('Health'),
          resolveFocusTab,
          Story.messageIn(
            [ShopDialogBinding, DialogBinding],
            DialogBlock.Message.CanceledDialog(),
          ),
          closeDialog(),
          Story.model(({ seats: [{ shop, shopCategory }] }) => {
            expect(shop).toEqual(ShopState.Dismissed())
            expect(shopCategory).toBe('Health')
          }),
        )

        yield* Story.story(
          APPLICATION,
          Story.given(
            modifyFocus(besideStall(preparing(3)), {
              shopCategory: () => 'Traps',
            }),
          ),
          press('KeyD'),
          ...ticks(FRAMES_TO_STALL, SHOP_FRAME_MS),
          resolveShowShop,
          Story.model(({ seats: [{ shop, shopCategory }] }) => {
            expect(shopCategory).toBe('Traps')
            expect(shop).toEqual(
              ShopState.Browsing({ focusedItem: 'Barricade' }),
            )
          }),
        )

        yield* Story.story(
          APPLICATION,
          Story.given(
            modifyFocus(
              modifyFields(shopReady, {
                phase: () => Phase.GameOver({ wave: 4 }),
              }),
              { shopCategory: () => 'Traps' },
            ),
          ),
          ...ticks(RESTART_GRACE_TICKS, GRACE_TICK_MS),
          press('Enter'),
          Story.model(({ phase, seats: [{ shopCategory }] }) => {
            expect(Phase.guards.Preparation(phase)).toBe(true)
            expect(shopCategory).toBe('Guns')
          }),
        )
      }),
  )

  it.effect('tab Messages change nothing while the shop is closed', () =>
    Story.story(
      APPLICATION,
      Story.given(
        modifyFocus(modifyFields(shopReady, { phase: () => preparing(2) }), {
          shop: () => ShopState.Away(),
        }),
      ),
      selectTab('Traps'),
      Story.Command.expectNone(),
      Story.model(({ seats: [{ shopCategory, shop }] }) => {
        expect(shopCategory).toBe('Guns')
        expect(shop).toEqual(ShopState.Away())
      }),
    ),
  )

  test('each tab counts what the player can buy right now', () => {
    const firstVisit = browsing(withMoney(shopReady, WAVE_ONE_PAY))
    expect(affordableCount(firstVisit, focusSlotOf(firstVisit), 'Guns')).toBe(0)
    expect(affordableCount(firstVisit, focusSlotOf(firstVisit), 'Traps')).toBe(
      0,
    )
    expect(totalAffordable(firstVisit, focusSlotOf(firstVisit))).toBe(0)

    const hurt = withHp(firstVisit, PLAYER_MAX_HP - 2)
    expect(affordableCount(hurt, focusSlotOf(hurt), 'Health')).toBe(1)
    expect(totalAffordable(hurt, focusSlotOf(hurt))).toBe(1)

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
    expect(itemsIn(unarmed, focusSlotOf(unarmed), 'Health')).toEqual(['Heart'])
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
    'he cheers a buy and tells short money apart from a gun carried',
    () =>
      Story.story(
        APPLICATION,
        Story.given(
          withHp(
            withArsenal(
              browsing(withMoney(shopReady, 30)),
              holdingSecond(gun('Shotgun', 48)),
            ),
            3,
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
        Story.messageIn(
          ShopDialogBinding,
          ShopMessage.PressedBuyKey({ item: 'Barricade' }),
        ),
        Story.model(({ shopChatter }) => {
          expect(shopChatter).toEqual(
            ShopChatter.TooPricey({ item: 'Barricade' }),
          )
        }),
        Story.messageIn(
          ShopDialogBinding,
          ShopMessage.PressedBuyKey({ item: 'Heart' }),
        ),
        Story.model(({ shopChatter, seats: [{ wallet }] }) => {
          expect(shopChatter).toEqual(ShopChatter.Bought({ item: 'Heart' }))
          expect(wallet.balance).toBe(5)
        }),
      ),
  )
})
