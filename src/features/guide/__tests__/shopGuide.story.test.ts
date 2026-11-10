import { Array, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { afterEach, describe, expect, it, test } from '@effect/vitest'
import { DialogBlock } from '@foldkit/ui'

import { MunchopediaBinding, ShopDialogBinding } from '../../../app/bindings'
import { Message } from '../../../app/message'
import { FridgeDoor } from '../../../app/model'
import { home } from '../../../test/model.fixture'
import {
  APPLICATION,
  closeDialog,
  press,
  resolveGuideFocus,
  ticks,
} from '../../../test/testing'
import { TRAPS } from '../../../world/gear/traps'
import { UPGRADE_TIERS, WEAPONS } from '../../../world/gear/weapons'
import { EXIT_RULES } from '../../../world/level/exits'
import { PICKUP_NAMES } from '../../../world/names'
import { modifyFocus } from '../../../world/party/party'
import { SHOP_ITEMS } from '../../../world/shop/shop'
import { GuideBinding as MunchopediaGuideBinding } from '../../munchopedia/bindings'
import { Message as MunchopediaMessage } from '../../munchopedia/message'
import {
  FRAMES_TO_STALL,
  SHOP_FRAME_MS,
  besideStall,
  preparing,
  resolveShowShop,
} from '../../shop/__tests__/shop.fixture'
import {
  DialogBinding,
  GuideBinding as ShopGuideBinding,
} from '../../shop/bindings'
import { Message as ShopMessage } from '../../shop/message'
import { Message as GuideMessage } from '../message'
import { GuideStatus } from '../model'
import {
  type GuideEntry,
  entriesOf,
  isEntryKnown,
  prizeUnlockId,
} from '../shopGuide'

const entry = (section: Parameters<typeof entriesOf>[0], id: string) =>
  Option.getOrThrow(
    Array.findFirst(entriesOf(section), other => other.id === id),
  )

const barOf = (found: GuideEntry, stat: string) =>
  Option.getOrThrow(Array.findFirst(found.bars, bar => bar.stat === stat))

const atCounter = Story.steps(
  press('KeyD'),
  ...ticks(FRAMES_TO_STALL, SHOP_FRAME_MS),
  resolveShowShop,
)

const closedShop = () =>
  modifyFocus(besideStall(preparing(3)), { shopCategory: () => 'Guns' })

describe('the ? in Rattles shop', () => {
  it.effect(
    'opens the guide on the tab being looked at, and back returns to the shelves',
    () =>
      Story.story(
        APPLICATION,
        Story.given(closedShop()),
        atCounter,
        Story.messageIn(
          ShopDialogBinding,
          ShopMessage.ClickedGuideButton({ section: 'Traps' }),
        ),
        resolveGuideFocus,
        Story.model(({ shopDialog: { guide: shopGuide } }) => {
          expect(shopGuide.status).toEqual(
            GuideStatus.Open({ section: 'Traps' }),
          )
        }),
        Story.messageIn(
          [ShopDialogBinding, ShopGuideBinding],
          GuideMessage.ClickedSectionButton({ section: 'Fridge' }),
        ),
        Story.model(({ shopDialog: { guide: shopGuide } }) => {
          expect(shopGuide.status).toEqual(
            GuideStatus.Open({ section: 'Fridge' }),
          )
        }),
        Story.messageIn(
          [ShopDialogBinding, ShopGuideBinding],
          GuideMessage.ClickedBackButton(),
        ),
        resolveGuideFocus,
        Story.model(({ shopDialog: { guide: shopGuide } }) => {
          expect(shopGuide.status).toEqual(GuideStatus.Closed())
        }),
      ),
  )

  it.effect('the ? key toggles the guide from the keyboard', () =>
    Story.story(
      APPLICATION,
      Story.given(closedShop()),
      atCounter,
      press('Slash'),
      resolveGuideFocus,
      Story.model(({ shopDialog: { guide: shopGuide } }) => {
        expect(GuideStatus.isAnyOf(['Open'])(shopGuide.status)).toBe(true)
      }),
      press('Slash'),
      resolveGuideFocus,
      Story.model(({ shopDialog: { guide: shopGuide } }) => {
        expect(shopGuide.status).toEqual(GuideStatus.Closed())
      }),
    ),
  )

  it.effect(
    'closing the dialog with the guide up lands back on the shop, not out of it',
    () =>
      Story.story(
        APPLICATION,
        Story.given(closedShop()),
        atCounter,
        Story.messageIn(
          ShopDialogBinding,
          ShopMessage.ClickedGuideButton({ section: 'Traps' }),
        ),
        resolveGuideFocus,
        Story.messageIn(
          [ShopDialogBinding, DialogBinding],
          DialogBlock.Message.CanceledDialog(),
        ),
        closeDialog(),
        resolveShowShop,
        Story.model(
          ({ shopDialog: { guide: shopGuide }, seats: [{ shop }] }) => {
            expect(shopGuide.status).toEqual(GuideStatus.Closed())
            expect(shop._tag).toBe('Browsing')
          },
        ),
      ),
  )
})

describe('the Munchopedia Shop page', () => {
  it.effect(
    'the Shop tile opens the guide on Guns, and a section button turns it',
    () =>
      Story.story(
        APPLICATION,
        Story.given(home),
        Story.message(Message.ClickedMunchopediaButton()),
        resolveShowShop,
        Story.messageIn(
          MunchopediaBinding,
          MunchopediaMessage.ClickedShopButton(),
        ),
        resolveGuideFocus,
        Story.model(({ munchopedia }) => {
          expect(munchopedia.guide.status).toEqual(
            GuideStatus.Open({ section: 'Guns' }),
          )
        }),
        Story.messageIn(
          [MunchopediaBinding, MunchopediaGuideBinding],
          GuideMessage.ClickedSectionButton({ section: 'House' }),
        ),
        Story.model(({ munchopedia }) => {
          expect(munchopedia.guide.status).toEqual(
            GuideStatus.Open({ section: 'House' }),
          )
        }),
      ),
  )
})

describe('what the entries read', () => {
  const originals = {
    smgMagazine: WEAPONS.Smg.magazine,
    turretHp: TRAPS.Turret.hp,
    exitPrice: EXIT_RULES.price,
  }

  afterEach(() => {
    Object.assign(WEAPONS.Smg, { magazine: originals.smgMagazine })
    Object.assign(TRAPS.Turret, { hp: originals.turretHp })
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

  test('a price tag is the table price, and found things wear none', () => {
    Object.assign(EXIT_RULES, { price: 88 })
    expect(entry('House', 'Boards').price).toEqual(Option.some(88))
    expect(entry('Health', 'Heart').price).toEqual(Option.none())
    expect(entry('Traps', 'Barricade').price).toEqual(Option.none())
  })

  test('a gun lists every tier as a step with the kills it takes', () => {
    const ladder = entry('Guns', 'Shotgun').ladder
    expect(Array.map(ladder, step => step.kills)).toEqual(
      Array.map(UPGRADE_TIERS.Shotgun, tier => tier.kills),
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
      PICKUP_NAMES.Heart,
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

  it.effect('the fridge door opening on a prize writes it down, once', () =>
    Story.story(
      APPLICATION,
      Story.given(
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
      Story.model(({ seenUnlocks }) => {
        expect(
          Array.filter(seenUnlocks, id => id === prizeUnlockId('Freeze')),
        ).toHaveLength(1)
        expect(seenUnlocks).not.toContain(prizeUnlockId('Cooker'))
      }),
    ),
  )
})
