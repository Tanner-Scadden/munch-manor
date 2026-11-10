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
  buyAtCounter,
  closeDialog,
  holdingFirst,
  holdingSecond,
  maybeSpareGun,
  press,
  throughIntro,
  ticks,
} from '../../../test/testing'
import { UPGRADE_TIERS } from '../../../world/gear/weapons'
import { focusSlotOf, modifyFocus } from '../../../world/party/party'
import {
  SHOP_CATEGORY_ORDER,
  SHOP_ITEMS,
  affordableCount,
  gunShelves,
  itemsIn,
  totalAffordable,
} from '../../../world/shop/shop'
import { waveBonus } from '../../../world/waves/waves'
import { DialogBinding, TabsBinding } from '../bindings'
import { Message as ShopMessage } from '../message'
import { ShopTabsBlock } from '../shopTabs'
import { FocusItem } from '../steps'
import {
  FRAMES_TO_STALL,
  GRACE_TICK_MS,
  SHOP_FRAME_MS,
  besideStall,
  browsing,
  focusedOn,
  gun,
  holdingSpare,
  preparing,
  resolveFocusShopItem,
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
          throughIntro,
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
    expect(affordableCount(firstVisit, focusSlotOf(firstVisit), 'Guns')).toBe(1)
    expect(affordableCount(firstVisit, focusSlotOf(firstVisit), 'Health')).toBe(
      0,
    )
    expect(affordableCount(firstVisit, focusSlotOf(firstVisit), 'Traps')).toBe(
      0,
    )
    expect(totalAffordable(firstVisit, focusSlotOf(firstVisit))).toBe(1)

    const hurt = withHp(firstVisit, PLAYER_MAX_HP - 2)
    expect(affordableCount(hurt, focusSlotOf(hurt), 'Health')).toBe(1)
    expect(totalAffordable(hurt, focusSlotOf(hurt))).toBe(2)

    const armed = withArsenal(withMoney(firstVisit, 50), holdingSpare(20))
    expect(affordableCount(armed, focusSlotOf(armed), 'Guns')).toBe(2)

    expect(
      totalAffordable(
        withMoney(firstVisit, 0),
        focusSlotOf(withMoney(firstVisit, 0)),
      ),
    ).toBe(0)
  })

  it.effect(
    'the money from a clean wave 1 buys a first gun at the first visit',
    () =>
      Story.story(
        APPLICATION,
        Story.given(browsing(withMoney(shopReady, WAVE_ONE_PAY))),
        buyAtCounter('Shotgun'),
        resolveFocusShopItem,
        Story.model(({ seats: [{ wallet, player }] }) => {
          expect(wallet.balance).toBe(WAVE_ONE_PAY - SHOP_ITEMS.Shotgun.price)
          expect(
            Option.map(maybeSpareGun(player.arsenal), ({ kind }) => kind),
          ).toEqual(Option.some('Shotgun'))
        }),
      ),
  )

  test('every upgrade line starts cheap and gets steeper', () => {
    const lines: ReadonlyArray<WeaponKind> = ['Shotgun', 'Smg', 'Pistol']
    Array.forEach(lines, weapon => {
      const prices = Array.map(UPGRADE_TIERS[weapon], ({ price }) => price)
      const steps = Array.zipWith(
        prices,
        Array.drop(prices, 1),
        (lower, higher) => higher - lower,
      )
      expect(Array.every(steps, step => step > 0)).toBe(true)
    })
    expect(
      Option.map(Array.head(UPGRADE_TIERS.Smg), ({ price }) => price),
    ).toEqual(Option.some(60))
    expect(
      Option.map(Array.head(UPGRADE_TIERS.Shotgun), ({ price }) => price),
    ).toEqual(Option.some(40))
  })
})

describe('ammo and upgrades under the gun', () => {
  test('guns always go pistol, shotgun, machine gun, whether owned, in hand, or for sale', () => {
    const unarmed = browsing(withMoney(shopReady, 100))
    const weaponOrder = (current: Model): ReadonlyArray<WeaponKind> =>
      Array.map(
        gunShelves(current, focusSlotOf(current)),
        ({ weapon }) => weapon,
      )
    const PISTOL_FIRST: ReadonlyArray<WeaponKind> = ['Pistol', 'Shotgun', 'Smg']

    expect(weaponOrder(unarmed)).toEqual(PISTOL_FIRST)
    expect(itemsIn(unarmed, focusSlotOf(unarmed), 'Guns')).toEqual([
      'PistolUpgrade',
      'Shotgun',
      'Smg',
      'LaserSight',
    ])

    const shotgunInHand = withArsenal(unarmed, holdingSpare(20))
    expect(weaponOrder(shotgunInHand)).toEqual(PISTOL_FIRST)
    expect(itemsIn(shotgunInHand, focusSlotOf(shotgunInHand), 'Guns')).toEqual([
      'PistolUpgrade',
      'ShotgunShells',
      'ShotgunUpgrade',
      'Smg',
      'LaserSight',
    ])

    const shotgunHolstered = withArsenal(
      unarmed,
      holdingFirst(gun('Shotgun', 20)),
    )
    expect(weaponOrder(shotgunHolstered)).toEqual(PISTOL_FIRST)

    const smgInHand = withArsenal(unarmed, holdingSpare(60, 'Smg'))
    expect(weaponOrder(smgInHand)).toEqual(PISTOL_FIRST)
    expect(itemsIn(smgInHand, focusSlotOf(smgInHand), 'Guns')).toEqual([
      'PistolUpgrade',
      'Shotgun',
      'SmgRounds',
      'SmgUpgrade',
      'LaserSight',
    ])

    const smgHolstered = withArsenal(unarmed, holdingFirst(gun('Smg', 60)))
    expect(weaponOrder(smgHolstered)).toEqual(PISTOL_FIRST)
    expect(itemsIn(unarmed, focusSlotOf(unarmed), 'Health')).toEqual(['Heart'])
  })

  it.effect(
    'buying a gun moves focus to its ammo, and buying ammo leaves focus where it is',
    () =>
      Story.story(
        APPLICATION,
        Story.given(browsing(withMoney(shopReady, 200))),
        Story.messageIn(
          ShopDialogBinding,
          ShopMessage.PressedBuyKey({ item: 'Shotgun' }),
        ),
        Story.Command.expectExact(FocusItem({ item: 'ShotgunShells' })),
        resolveFocusShopItem,
        Story.model(({ seats: [{ shop }] }) => {
          expect(shop).toEqual(
            ShopState.Browsing({ focusedItem: 'ShotgunShells' }),
          )
        }),
        Story.messageIn(
          ShopDialogBinding,
          ShopMessage.PressedBuyKey({ item: 'ShotgunShells' }),
        ),
        Story.Command.expectNone(),
        Story.model(({ seats: [{ shop, player }] }) => {
          expect(shop).toEqual(
            ShopState.Browsing({ focusedItem: 'ShotgunShells' }),
          )
          expect(player.arsenal).toEqual(holdingSpare(32))
        }),
      ),
  )

  it.effect(
    'swapping guns moves focus from the bought row to the new gun ammo',
    () =>
      Story.story(
        APPLICATION,
        Story.given(
          focusedOn(
            withArsenal(browsing(withMoney(shopReady, 200)), holdingSpare(20)),
            'Smg',
          ),
        ),
        buyAtCounter('Smg'),
        Story.Command.expectExact(FocusItem({ item: 'SmgRounds' })),
        resolveFocusShopItem,
        Story.model(({ seats: [{ shop, player }] }) => {
          expect(shop).toEqual(ShopState.Browsing({ focusedItem: 'SmgRounds' }))
          expect(
            Option.map(maybeSpareGun(player.arsenal), ({ kind }) => kind),
          ).toEqual(Option.some('Smg'))
        }),
      ),
  )

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
        expect(shop).toEqual(ShopState.Browsing({ focusedItem: 'Shotgun' }))
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

  const withSmg = (balance: number, rounds: number): Model =>
    withArsenal(
      withMoney(besideStall(preparing(4)), balance),
      holdingSecond(gun('Smg', rounds, 1)),
    )

  it.effect(
    'with only the pistol, it opens on a gun the player can afford',
    () =>
      focusAfterWalkingUp(withMoney(besideStall(preparing(2)), 40)).pipe(
        Effect.map(focused => {
          expect(focused).toBe('Shotgun')
        }),
      ),
  )

  it.effect('with a spare gun running low, it opens on that gun ammo', () =>
    focusAfterWalkingUp(withSmg(200, 40)).pipe(
      Effect.map(focused => {
        expect(focused).toBe('SmgRounds')
      }),
    ),
  )

  it.effect(
    'with a full spare gun, it opens on its upgrade, never on a gun that would replace it',
    () =>
      focusAfterWalkingUp(withSmg(200, 360)).pipe(
        Effect.map(focused => {
          expect(focused).toBe('SmgUpgrade')
        }),
      ),
  )

  it.effect(
    'with nothing affordable, it opens on something to save up for',
    () =>
      focusAfterWalkingUp(withSmg(5, 360)).pipe(
        Effect.map(focused => {
          expect(focused).toBe('SmgUpgrade')
        }),
      ),
  )
})

describe('what Rattles says', () => {
  it.effect('he cheers a buy and tells short money apart from a full gun', () =>
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
        ShopMessage.PressedBuyKey({ item: 'ShotgunShells' }),
      ),
      Story.model(({ shopChatter }) => {
        expect(shopChatter).toEqual(
          ShopChatter.Refused({ item: 'ShotgunShells' }),
        )
      }),
      Story.messageIn(
        ShopDialogBinding,
        ShopMessage.PressedBuyKey({ item: 'ShotgunUpgrade' }),
      ),
      Story.model(({ shopChatter }) => {
        expect(shopChatter).toEqual(
          ShopChatter.TooPricey({ item: 'ShotgunUpgrade' }),
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
      resolveFocusShopItem,
    ),
  )
})
