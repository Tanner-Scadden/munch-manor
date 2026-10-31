import { Array, Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { toParentMessage } from 'foldkit/test'
import { describe, expect, test } from 'vitest'

import { DialogBlock, Tabs } from '@foldkit/ui'

import { ShopDialogBinding, ShopTabsBinding } from './bindings'
import { PLAYER_MAX_HP, SHAMBLER_BOUNTY } from './constants'
import { update } from './main'
import { Message } from './message'
import {
  type Model,
  Phase,
  type ShopCategory,
  ShopChatter,
  type ShopItemId,
  ShopState,
  type WeaponKind,
} from './model'
import { withArsenal } from './model.fixture'
import {
  SHOP_CATEGORY_ORDER,
  SHOP_ITEMS,
  affordableCount,
  gunShelves,
  itemsIn,
  totalAffordable,
} from './shop'
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
import { ShopTabsBlock } from './shopTabs'
import {
  RESTART_GRACE_TICKS,
  holdingFirst,
  holdingSecond,
  maybeSpareGun,
  press,
  ticks,
} from './testing'
import { FocusShopItem } from './update/shop'
import { waveBonus } from './waves'
import { UPGRADE_TIERS } from './weapons'

describe('shop categories', () => {
  const WAVE_ONE_PAY = 6 * SHAMBLER_BOUNTY + waveBonus(1)

  const selectTab = (value: ShopCategory) =>
    message(
      toParentMessage(
        ShopTabsBinding,
        ShopTabsBlock.Message.SelectedTab({
          index: Option.getOrElse(
            Array.findFirstIndex(SHOP_CATEGORY_ORDER, tab => tab === value),
            () => 0,
          ),
          value,
        }),
      ),
    )

  const resolveFocusTab = Command.resolve(
    Tabs.test.FocusTab,
    ShopTabsBlock.Message.CompletedFocusTab(),
  )

  test('choosing a tab shows its items, focuses its first item, and moves keyboard focus to the tab', () => {
    story(
      update,
      given(browsing(withMoney(shopReady, 100))),
      model(({ shopCategory }) => {
        expect(shopCategory).toBe('Guns')
      }),
      selectTab('Traps'),
      Command.expectExact(Tabs.test.FocusTab),
      resolveFocusTab,
      model(({ shopCategory, shop }) => {
        expect(shopCategory).toBe('Traps')
        expect(shop).toEqual(ShopState.Browsing({ focusedItem: 'Barricade' }))
      }),
      selectTab('Health'),
      resolveFocusTab,
      model(({ shopCategory, shop }) => {
        expect(shopCategory).toBe('Health')
        expect(shop).toEqual(ShopState.Browsing({ focusedItem: 'Heart' }))
      }),
    )
  })

  test('the shop reopens on the last tab chosen in the run, and a new run starts on Guns', () => {
    story(
      update,
      given(browsing(withMoney(shopReady, 100))),
      selectTab('Health'),
      resolveFocusTab,
      message(
        toParentMessage(
          ShopDialogBinding,
          DialogBlock.Message.RequestedClose(),
        ),
      ),
      // NOTE: the fixture browses with the dialog already down, which the
      // next frame takes as a dialog that failed to show.
      ...ticks(1, SHOP_FRAME_MS),
      model(({ shop, shopCategory }) => {
        expect(shop).toEqual(ShopState.Dismissed())
        expect(shopCategory).toBe('Health')
      }),
    )

    story(
      update,
      given(
        modifyFields(besideStall(preparing(3)), {
          shopCategory: () => 'Traps',
        }),
      ),
      press('KeyD'),
      ...ticks(FRAMES_TO_STALL, SHOP_FRAME_MS),
      resolveShowShop,
      model(({ shop, shopCategory }) => {
        expect(shopCategory).toBe('Traps')
        expect(shop).toEqual(ShopState.Browsing({ focusedItem: 'Barricade' }))
      }),
    )

    story(
      update,
      given(
        modifyFields(shopReady, {
          phase: () => Phase.GameOver({ wave: 4 }),
          shopCategory: () => 'Traps',
        }),
      ),
      ...ticks(RESTART_GRACE_TICKS, GRACE_TICK_MS),
      press('Enter'),
      model(({ phase, shopCategory }) => {
        expect(Phase.guards.Preparation(phase)).toBe(true)
        expect(shopCategory).toBe('Guns')
      }),
    )
  })

  test('tab Messages change nothing while the shop is closed', () => {
    story(
      update,
      given(
        modifyFields(shopReady, {
          phase: () => preparing(2),
          shop: () => ShopState.Away(),
        }),
      ),
      selectTab('Traps'),
      Command.expectNone(),
      model(({ shopCategory, shop }) => {
        expect(shopCategory).toBe('Guns')
        expect(shop).toEqual(ShopState.Away())
      }),
    )
  })

  test('each tab counts what the player can buy right now', () => {
    const firstVisit = browsing(withMoney(shopReady, WAVE_ONE_PAY))
    expect(affordableCount(firstVisit, 'Guns')).toBe(1)
    expect(affordableCount(firstVisit, 'Health')).toBe(0)
    expect(affordableCount(firstVisit, 'Traps')).toBe(0)
    expect(totalAffordable(firstVisit)).toBe(1)

    const hurt = withHp(firstVisit, PLAYER_MAX_HP - 2)
    expect(affordableCount(hurt, 'Health')).toBe(1)
    expect(totalAffordable(hurt)).toBe(2)

    const armed = withArsenal(withMoney(firstVisit, 50), holdingSpare(20))
    expect(affordableCount(armed, 'Guns')).toBe(2)

    expect(totalAffordable(withMoney(firstVisit, 0))).toBe(0)
  })

  test('the money from a clean wave 1 buys a first gun at the first visit', () => {
    story(
      update,
      given(browsing(withMoney(shopReady, WAVE_ONE_PAY))),
      message(Message.ClickedBuyButton({ item: 'Shotgun' })),
      resolveFocusShopItem,
      model(({ wallet, player }) => {
        expect(wallet.balance).toBe(WAVE_ONE_PAY - SHOP_ITEMS.Shotgun.price)
        expect(
          Option.map(maybeSpareGun(player.arsenal), ({ kind }) => kind),
        ).toEqual(Option.some('Shotgun'))
      }),
    )
  })

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
      Array.map(gunShelves(current), ({ weapon }) => weapon)
    const PISTOL_FIRST: ReadonlyArray<WeaponKind> = ['Pistol', 'Shotgun', 'Smg']

    expect(weaponOrder(unarmed)).toEqual(PISTOL_FIRST)
    expect(itemsIn(unarmed, 'Guns')).toEqual([
      'PistolUpgrade',
      'Shotgun',
      'Smg',
      'LaserSight',
    ])

    const shotgunInHand = withArsenal(unarmed, holdingSpare(20))
    expect(weaponOrder(shotgunInHand)).toEqual(PISTOL_FIRST)
    expect(itemsIn(shotgunInHand, 'Guns')).toEqual([
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
    expect(itemsIn(smgInHand, 'Guns')).toEqual([
      'PistolUpgrade',
      'Shotgun',
      'SmgRounds',
      'SmgUpgrade',
      'LaserSight',
    ])

    const smgHolstered = withArsenal(unarmed, holdingFirst(gun('Smg', 60)))
    expect(weaponOrder(smgHolstered)).toEqual(PISTOL_FIRST)
    expect(itemsIn(unarmed, 'Health')).toEqual(['Heart'])
  })

  test('buying a gun moves focus to its ammo, and buying ammo leaves focus where it is', () => {
    story(
      update,
      given(browsing(withMoney(shopReady, 200))),
      message(Message.PressedBuyKey({ item: 'Shotgun' })),
      Command.expectExact(FocusShopItem({ item: 'ShotgunShells' })),
      resolveFocusShopItem,
      model(({ shop }) => {
        expect(shop).toEqual(
          ShopState.Browsing({ focusedItem: 'ShotgunShells' }),
        )
      }),
      message(Message.PressedBuyKey({ item: 'ShotgunShells' })),
      Command.expectNone(),
      model(({ shop, player }) => {
        expect(shop).toEqual(
          ShopState.Browsing({ focusedItem: 'ShotgunShells' }),
        )
        expect(player.arsenal).toEqual(holdingSpare(32))
      }),
    )
  })

  test('swapping guns moves focus from the bought row to the new gun ammo', () => {
    story(
      update,
      given(
        focusedOn(
          withArsenal(browsing(withMoney(shopReady, 200)), holdingSpare(20)),
          'Smg',
        ),
      ),
      message(Message.ClickedBuyButton({ item: 'Smg' })),
      Command.expectExact(FocusShopItem({ item: 'SmgRounds' })),
      resolveFocusShopItem,
      model(({ shop, player }) => {
        expect(shop).toEqual(ShopState.Browsing({ focusedItem: 'SmgRounds' }))
        expect(
          Option.map(maybeSpareGun(player.arsenal), ({ kind }) => kind),
        ).toEqual(Option.some('Smg'))
      }),
    )
  })

  test('a refused purchase leaves focus alone', () => {
    story(
      update,
      given(browsing(withMoney(shopReady, 10))),
      message(Message.PressedBuyKey({ item: 'Shotgun' })),
      Command.expectNone(),
      model(({ shop }) => {
        expect(shop).toEqual(ShopState.Browsing({ focusedItem: 'Shotgun' }))
      }),
    )
  })
})

describe('the row the shop opens on', () => {
  const focusAfterWalkingUp = (base: Model): Array<ShopItemId> => {
    const focused: Array<ShopItemId> = []
    story(
      update,
      given(base),
      press('KeyD'),
      ...ticks(FRAMES_TO_STALL, SHOP_FRAME_MS),
      resolveShowShop,
      model(({ shop }) => {
        focused.push(
          Option.getOrThrow(
            Option.liftPredicate(shop, ShopState.guards.Browsing),
          ).focusedItem,
        )
      }),
    )
    return focused
  }

  const withSmg = (balance: number, rounds: number): Model =>
    withArsenal(
      withMoney(besideStall(preparing(4)), balance),
      holdingSecond(gun('Smg', rounds, 1)),
    )

  test('with only the pistol, it opens on a gun the player can afford', () => {
    expect(
      focusAfterWalkingUp(withMoney(besideStall(preparing(2)), 40)),
    ).toEqual(['Shotgun'])
  })

  test('with a spare gun running low, it opens on that gun ammo', () => {
    expect(focusAfterWalkingUp(withSmg(200, 40))).toEqual(['SmgRounds'])
  })

  test('with a full spare gun, it opens on its upgrade, never on a gun that would replace it', () => {
    expect(focusAfterWalkingUp(withSmg(200, 360))).toEqual(['SmgUpgrade'])
  })

  test('with nothing affordable, it opens on something to save up for', () => {
    expect(focusAfterWalkingUp(withSmg(5, 360))).toEqual(['SmgUpgrade'])
  })
})

describe('what Rattles says', () => {
  test('he cheers a buy and tells short money apart from a full gun', () => {
    story(
      update,
      given(
        withHp(
          withArsenal(
            browsing(withMoney(shopReady, 30)),
            holdingSecond(gun('Shotgun', 48)),
          ),
          3,
        ),
      ),
      model(({ shopChatter }) => {
        expect(shopChatter).toEqual(ShopChatter.Greeting())
      }),
      message(Message.PressedBuyKey({ item: 'ShotgunShells' })),
      model(({ shopChatter }) => {
        expect(shopChatter).toEqual(
          ShopChatter.Refused({ item: 'ShotgunShells' }),
        )
      }),
      message(Message.PressedBuyKey({ item: 'ShotgunUpgrade' })),
      model(({ shopChatter }) => {
        expect(shopChatter).toEqual(
          ShopChatter.TooPricey({ item: 'ShotgunUpgrade' }),
        )
      }),
      message(Message.PressedBuyKey({ item: 'Heart' })),
      model(({ shopChatter, wallet }) => {
        expect(shopChatter).toEqual(ShopChatter.Bought({ item: 'Heart' }))
        expect(wallet.balance).toBe(5)
      }),
      resolveFocusShopItem,
    )
  })
})
