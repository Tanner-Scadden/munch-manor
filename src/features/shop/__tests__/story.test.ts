import { Story } from 'foldkit'

import { describe, expect, it } from '@effect/vitest'
import { DialogBlock, Tabs } from '@foldkit/ui'

import { ShopDialogBinding } from '../../../app/bindings'
import {
  APPLICATION,
  closeDialog,
  press,
  release,
  resolveGuideFocus,
  ticks,
} from '../../../test/testing'
import { ShopState } from '../../../world/schema/worldSchema'
import { Message as GuideMessage } from '../../guide/message'
import { GuideStatus } from '../../guide/model'
import { DialogBinding, GuideBinding, TabsBinding } from '../bindings'
import { ShopBlock } from '../block'
import { InMessage } from '../inMessage'
import { ShopLayer } from '../layer'
import { Message, OutMessage } from '../message'
import { isShopGuideOpen, isShopShown } from '../model'
import { ShopTabsBlock } from '../shopTabs'
import { FocusItem } from '../steps'
import {
  FRAMES_TO_STALL,
  SHOP_FRAME_MS,
  besideStall,
  preparing,
  resolveShowShop,
} from './shop.fixture'

// The shop dialog Block on its own: opening and closing at the root's
// request, its guide, its keys, and what it tells the root. The root's
// side, which makes each as the seat's action in the World, is in
// shop.story.test.ts and shopDialog.story.test.ts beside this; the last
// tests here reach the shop's children through the root by Binding path.

const SHOP = { block: ShopBlock, layer: ShopLayer }

const closed = closeDialog()

const opened = Story.steps(
  Story.inMessage(InMessage.RequestedOpen()),
  Story.expectNoOutMessage(),
  resolveShowShop,
)

const guideUp = Story.steps(
  opened,
  Story.message(Message.ClickedGuideButton({ section: 'Traps' })),
  resolveGuideFocus,
)

describe('the shop dialog Block', () => {
  it.effect('starts shut, its guide shut and placed in the shop', () =>
    Story.story(
      SHOP,
      Story.init(),
      Story.model(model => {
        expect(isShopShown(model)).toBe(false)
        expect(model.guide.placement).toBe('Shop')
        expect(model.guide.status).toEqual(GuideStatus.Closed())
      }),
    ),
  )

  it.effect('opens and closes at the root request, telling it Closed', () =>
    Story.story(
      SHOP,
      Story.init(),
      opened,
      Story.model(model => {
        expect(isShopShown(model)).toBe(true)
      }),
      Story.inMessage(InMessage.RequestedClose()),
      Story.expectOutMessage(OutMessage.Closed()),
      closed,
      Story.model(model => {
        expect(isShopShown(model)).toBe(false)
      }),
    ),
  )

  it.effect('the player closing the Dialog tells the root Closed', () =>
    Story.story(
      SHOP,
      Story.init(),
      opened,
      Story.messageIn(DialogBinding, DialogBlock.Message.CanceledDialog()),
      Story.expectOutMessage(OutMessage.Closed()),
      closed,
    ),
  )

  it.effect('the ? opens the guide on the tab the player looks at', () =>
    Story.story(
      SHOP,
      Story.init(),
      guideUp,
      Story.expectNoOutMessage(),
      Story.model(model => {
        expect(model.guide.status).toEqual(
          GuideStatus.Open({ section: 'Traps' }),
        )
      }),
      Story.messageIn(
        GuideBinding,
        GuideMessage.ClickedSectionButton({ section: 'Fridge' }),
      ),
      Story.model(model => {
        expect(model.guide.status).toEqual(
          GuideStatus.Open({ section: 'Fridge' }),
        )
      }),
    ),
  )

  it.effect('the ? does nothing while the dialog is shut', () =>
    Story.story(
      SHOP,
      Story.init(),
      Story.message(Message.ClickedGuideButton({ section: 'Guns' })),
      Story.Command.expectNone(),
      Story.model(model => {
        expect(isShopGuideOpen(model)).toBe(false)
      }),
    ),
  )

  it.effect('the ? key toggles the guide; other keys do nothing', () =>
    Story.story(
      SHOP,
      Story.init(),
      opened,
      Story.inMessage(
        InMessage.RequestedPressKey({ code: 'KeyA', section: 'Health' }),
      ),
      Story.Command.expectNone(),
      Story.inMessage(
        InMessage.RequestedPressKey({ code: 'Slash', section: 'Health' }),
      ),
      resolveGuideFocus,
      Story.model(model => {
        expect(model.guide.status).toEqual(
          GuideStatus.Open({ section: 'Health' }),
        )
      }),
      Story.inMessage(
        InMessage.RequestedPressKey({ code: 'Slash', section: 'Health' }),
      ),
      resolveGuideFocus,
      Story.model(model => {
        expect(isShopGuideOpen(model)).toBe(false)
      }),
    ),
  )

  it.effect('opening again shows the shelves, not the guide', () =>
    Story.story(
      SHOP,
      Story.init(),
      guideUp,
      Story.messageIn(DialogBinding, DialogBlock.Message.CanceledDialog()),
      Story.expectOutMessage(OutMessage.Closed()),
      closed,
      Story.model(model => {
        expect(isShopGuideOpen(model)).toBe(true)
      }),
      opened,
      Story.Command.expectNone(),
      Story.model(model => {
        expect(isShopShown(model)).toBe(true)
        expect(isShopGuideOpen(model)).toBe(false)
      }),
    ),
  )

  it.effect('a row bought by tap or Enter goes up as PickedItem', () =>
    Story.story(
      SHOP,
      Story.init(),
      opened,
      Story.message(Message.ClickedBuyButton({ item: 'Shotgun' })),
      Story.expectOutMessage(OutMessage.PickedItem({ item: 'Shotgun' })),
      Story.message(Message.PressedBuyKey({ item: 'Heart' })),
      Story.expectOutMessage(OutMessage.PickedItem({ item: 'Heart' })),
      Story.Command.expectNone(),
    ),
  )

  it.effect('an arrow key and a focused row go up without moving focus', () =>
    Story.story(
      SHOP,
      Story.init(),
      opened,
      Story.message(Message.MovedFocus({ item: 'Smg' })),
      Story.expectOutMessage(OutMessage.MovedFocus({ item: 'Smg' })),
      Story.Command.expectNone(),
      Story.message(Message.FocusedItem({ item: 'Smg' })),
      Story.expectOutMessage(OutMessage.FocusedItem({ item: 'Smg' })),
      Story.Command.expectNone(),
    ),
  )

  it.effect('the root asking for a row moves the keyboard focus to it', () =>
    Story.story(
      SHOP,
      Story.init(),
      opened,
      Story.inMessage(InMessage.RequestedFocusItem({ item: 'LaserSight' })),
      Story.Command.expectExact(FocusItem({ item: 'LaserSight' })),
      Story.Command.resolve(FocusItem, Message.CompletedFocusItem()),
      Story.expectNoOutMessage(),
    ),
  )

  it.effect('a tab goes up as ChoseCategory while the dialog is up', () =>
    Story.story(
      SHOP,
      Story.init(),
      Story.messageIn(
        TabsBinding,
        ShopTabsBlock.Message.SelectedTab({ index: 2, value: 'Traps' }),
      ),
      Story.Command.expectNone(),
      Story.expectNoOutMessage(),
      opened,
      Story.messageIn(
        TabsBinding,
        ShopTabsBlock.Message.SelectedTab({ index: 2, value: 'Traps' }),
      ),
      Story.expectOutMessage(OutMessage.ChoseCategory({ category: 'Traps' })),
      Story.Command.resolve(
        Tabs.test.FocusTab,
        ShopTabsBlock.Message.CompletedFocusTab(),
      ),
    ),
  )

  it.effect('the guide inside the shop is reached by its Binding path', () =>
    Story.story(
      SHOP,
      Story.init(),
      guideUp,
      Story.messageIn([GuideBinding], GuideMessage.ClickedBackButton()),
      resolveGuideFocus,
      Story.model(model => {
        expect(isShopGuideOpen(model)).toBe(false)
      }),
    ),
  )
})

const atTheCounter = Story.steps(
  press('KeyD'),
  ...ticks(FRAMES_TO_STALL, SHOP_FRAME_MS),
  resolveShowShop,
  release('KeyD'),
)

describe('the shop dialog in the root', () => {
  it.effect('the player closing it leaves the counter in the World', () =>
    Story.story(
      APPLICATION,
      Story.given(besideStall(preparing(2))),
      atTheCounter,
      Story.model(({ seats: [{ shop }] }) => {
        expect(ShopState.guards.Browsing(shop)).toBe(true)
      }),
      Story.messageIn(
        [ShopDialogBinding, DialogBinding],
        DialogBlock.Message.CanceledDialog(),
      ),
      closed,
      Story.model(({ shopDialog, seats: [{ shop }] }) => {
        expect(isShopShown(shopDialog)).toBe(false)
        expect(shop).toEqual(ShopState.Dismissed())
      }),
    ),
  )

  it.effect('Escape with the guide up puts only the guide away', () =>
    Story.story(
      APPLICATION,
      Story.given(besideStall(preparing(2))),
      atTheCounter,
      Story.messageIn(
        ShopDialogBinding,
        Message.ClickedGuideButton({ section: 'Guns' }),
      ),
      resolveGuideFocus,
      Story.messageIn(
        [ShopDialogBinding, DialogBinding],
        DialogBlock.Message.CanceledDialog(),
      ),
      closed,
      resolveShowShop,
      Story.model(({ shopDialog, seats: [{ shop }] }) => {
        expect(isShopShown(shopDialog)).toBe(true)
        expect(isShopGuideOpen(shopDialog)).toBe(false)
        expect(ShopState.guards.Browsing(shop)).toBe(true)
      }),
    ),
  )

  it.effect('a tab chosen moves the seat to it in the World', () =>
    Story.story(
      APPLICATION,
      Story.given(besideStall(preparing(2))),
      atTheCounter,
      Story.messageIn(
        [ShopDialogBinding, TabsBinding],
        ShopTabsBlock.Message.SelectedTab({ index: 2, value: 'Traps' }),
      ),
      Story.Command.resolve(
        Tabs.test.FocusTab,
        ShopTabsBlock.Message.CompletedFocusTab(),
      ),
      Story.model(({ seats: [{ shop, shopCategory }] }) => {
        expect(shopCategory).toBe('Traps')
        expect(shop).toEqual(ShopState.Browsing({ focusedItem: 'Barricade' }))
      }),
    ),
  )
})
