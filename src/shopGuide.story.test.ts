import { Array, Option } from 'effect'
import { Command, given, message, model, steps, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { toParentMessage } from 'foldkit/test'
import { afterEach, describe, expect, test } from 'vitest'

import { Dialog, DialogBlock } from '@foldkit/ui'

import { ShopDialogBinding } from './bindings'
import { EXIT_RULES } from './exits'
import { update } from './main'
import { Message } from './message'
import { FridgeDoor, MunchopediaPage, ShopGuide } from './model'
import { home } from './model.fixture'
import { modifyFocus } from './party'
import { SHOP_ITEMS } from './shop'
import {
  FRAMES_TO_STALL,
  SHOP_FRAME_MS,
  besideStall,
  preparing,
  resolveShowShop,
} from './shop.fixture'
import {
  type GuideEntry,
  entriesOf,
  isEntryKnown,
  prizeUnlockId,
} from './shopGuide'
import { press, ticks } from './testing'
import { TRAPS } from './traps'
import { FocusShopGuide } from './update/shopGuide'
import { UPGRADE_TIERS, WEAPONS } from './weapons'

const entry = (section: Parameters<typeof entriesOf>[0], id: string) =>
  Option.getOrThrow(
    Array.findFirst(entriesOf(section), other => other.id === id),
  )

const barOf = (found: GuideEntry, stat: string) =>
  Option.getOrThrow(Array.findFirst(found.bars, bar => bar.stat === stat))

const atCounter = steps(
  press('KeyD'),
  ...ticks(FRAMES_TO_STALL, SHOP_FRAME_MS),
  resolveShowShop,
)

const resolveFocusGuide = Command.resolve(
  FocusShopGuide,
  Message.CompletedFocusShopGuide(),
)

const closedShop = () =>
  modifyFocus(besideStall(preparing(3)), { shopCategory: () => 'Traps' })

describe('the ? in Rattles shop', () => {
  test('opens the guide on the tab being looked at, and back returns to the shelves', () => {
    story(
      update,
      given(closedShop()),
      atCounter,
      message(Message.ClickedShopGuideButton()),
      resolveFocusGuide,
      model(({ shopGuide }) => {
        expect(shopGuide).toEqual(ShopGuide.Open({ section: 'Traps' }))
      }),
      message(Message.ClickedShopGuideSectionButton({ section: 'Fridge' })),
      model(({ shopGuide }) => {
        expect(shopGuide).toEqual(ShopGuide.Open({ section: 'Fridge' }))
      }),
      message(Message.ClickedShopGuideBackButton()),
      resolveFocusGuide,
      model(({ shopGuide }) => {
        expect(shopGuide).toEqual(ShopGuide.Closed())
      }),
    )
  })

  test('the ? key toggles the guide from the keyboard', () => {
    story(
      update,
      given(closedShop()),
      atCounter,
      press('Slash'),
      resolveFocusGuide,
      model(({ shopGuide }) => {
        expect(ShopGuide.isAnyOf(['Open'])(shopGuide)).toBe(true)
      }),
      press('Slash'),
      resolveFocusGuide,
      model(({ shopGuide }) => {
        expect(shopGuide).toEqual(ShopGuide.Closed())
      }),
    )
  })

  test('closing the dialog with the guide up lands back on the shop, not out of it', () => {
    story(
      update,
      given(closedShop()),
      atCounter,
      message(Message.ClickedShopGuideButton()),
      resolveFocusGuide,
      message(
        toParentMessage(
          ShopDialogBinding,
          DialogBlock.Message.RequestedClose(),
        ),
      ),
      Command.resolve(
        Dialog.test.CloseDialog,
        DialogBlock.Message.CompletedCloseDialog(),
      ),
      resolveShowShop,
      model(({ shopGuide, seats: [{ shop }] }) => {
        expect(shopGuide).toEqual(ShopGuide.Closed())
        expect(shop._tag).toBe('Browsing')
      }),
    )
  })
})

describe('the Munchopedia Shop page', () => {
  test('the Shop tile opens the guide on Guns, and a section button turns it', () => {
    story(
      update,
      given(home),
      message(Message.ClickedMunchopediaButton()),
      resolveShowShop,
      message(Message.ClickedMunchopediaShopButton()),
      model(({ home: menu }) => {
        expect(menu.munchopediaPage).toEqual(
          MunchopediaPage.Shop({ section: 'Guns' }),
        )
      }),
      message(
        Message.ClickedMunchopediaShopSectionButton({ section: 'House' }),
      ),
      model(({ home: menu }) => {
        expect(menu.munchopediaPage).toEqual(
          MunchopediaPage.Shop({ section: 'House' }),
        )
      }),
    )
  })
})

describe('what the entries read', () => {
  const originals = {
    smgMagazine: WEAPONS.Smg.magazine,
    turretHp: TRAPS.Turret.hp,
    heartPrice: SHOP_ITEMS.Heart.price,
    exitPrice: EXIT_RULES.price,
  }

  afterEach(() => {
    Object.assign(WEAPONS.Smg, { magazine: originals.smgMagazine })
    Object.assign(TRAPS.Turret, { hp: originals.turretHp })
    Object.assign(SHOP_ITEMS.Heart, { price: originals.heartPrice })
    Object.assign(EXIT_RULES, { price: originals.exitPrice })
  })

  test('a gun bar moves when the weapon table does, and the others are scaled against the best', () => {
    const before = barOf(entry('Guns', 'Smg'), 'Magazine')
    const pistolBefore = barOf(entry('Guns', 'Pistol'), 'Magazine')
    Object.assign(WEAPONS.Smg, { magazine: 10_000 })
    const after = barOf(entry('Guns', 'Smg'), 'Magazine')
    const pistolAfter = barOf(entry('Guns', 'Pistol'), 'Magazine')
    expect(after.now).toBe(5)
    expect(before.now).toBeLessThanOrEqual(after.now)
    expect(pistolAfter.now).toBeLessThan(pistolBefore.now)
  })

  test('a trap bar moves when the trap table does', () => {
    const before = barOf(entry('Traps', 'Turret'), 'Tough')
    Object.assign(TRAPS.Turret, { hp: 5000 })
    const after = barOf(entry('Traps', 'Turret'), 'Tough')
    expect(after.now).toBe(5)
    expect(after.now).toBeGreaterThan(before.now)
    expect(barOf(entry('Traps', 'Barricade'), 'Tough').now).toBe(1)
  })

  test('a price tag is the table price', () => {
    Object.assign(SHOP_ITEMS.Heart, { price: 77 })
    Object.assign(EXIT_RULES, { price: 88 })
    expect(entry('Health', 'Heart').price).toEqual(Option.some(77))
    expect(entry('House', 'Boards').price).toEqual(Option.some(88))
  })

  test('a gun lists every upgrade tier as a step with its table price', () => {
    const ladder = entry('Guns', 'Shotgun').ladder
    expect(ladder.map(step => step.price)).toEqual(
      UPGRADE_TIERS.Shotgun.map(tier => tier.price),
    )
  })

  test('every shop good is in the guide', () => {
    const names = Array.flatMap(
      ['Guns', 'Health', 'Traps', 'Fridge', 'House'] as const,
      section => Array.map(entriesOf(section), other => other.name),
    )
    for (const name of [
      WEAPONS.Pistol.name,
      WEAPONS.Shotgun.name,
      WEAPONS.Smg.name,
      SHOP_ITEMS.LaserSight.name,
      SHOP_ITEMS.Heart.name,
      TRAPS.Barricade.name,
      TRAPS.Turret.name,
    ]) {
      expect(names).toContain(name)
    }
  })
})

describe('the fridge prizes', () => {
  const prizes = entriesOf('Fridge')

  test('every prize is ??? until it has been pulled once', () => {
    expect(prizes.length).toBeGreaterThan(0)
    for (const prize of prizes) {
      expect(isEntryKnown([], prize)).toBe(false)
    }
    const cooker = entry('Fridge', 'Cooker')
    expect(isEntryKnown([prizeUnlockId('Cooker')], cooker)).toBe(true)
    expect(
      isEntryKnown([prizeUnlockId('Cooker')], entry('Fridge', 'Pan')),
    ).toBe(false)
  })

  test('the gun shelves and the house are always known', () => {
    for (const section of ['Guns', 'Health', 'Traps', 'House'] as const) {
      for (const other of entriesOf(section)) {
        expect(isEntryKnown([], other)).toBe(true)
      }
    }
  })

  test('the fridge door opening on a prize writes it down, once', () => {
    story(
      update,
      given(
        modifyFields(besideStall(preparing(3)), {
          fridge: fridge =>
            modifyFields(fridge, {
              door: () =>
                FridgeDoor.Open({
                  prize: 'Freeze',
                  slot: 0,
                  remainingMs: 800,
                  durationMs: 1100,
                }),
            }),
        }),
      ),
      ...ticks(2, SHOP_FRAME_MS),
      model(({ seenUnlocks }) => {
        expect(
          seenUnlocks.filter(id => id === prizeUnlockId('Freeze')),
        ).toHaveLength(1)
        expect(seenUnlocks).not.toContain(prizeUnlockId('Cooker'))
      }),
    )
  })
})
