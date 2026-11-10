import { Array, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { afterEach, describe, expect, it, test } from '@effect/vitest'

import { MunchopediaBinding } from '../../../app/bindings'
import { Message } from '../../../app/message'
import { FridgeDoor } from '../../../app/model'
import { FIXED_STEP_MS } from '../../../shared/constants'
import { atFridgeOnWave, home } from '../../../test/model.fixture'
import {
  APPLICATION,
  resolveGuideFocus,
  showDialog,
  ticks,
} from '../../../test/testing'
import { FRIDGE_RULES } from '../../../world/fridge/leftovers'
import { TRAPS } from '../../../world/gear/traps'
import { UPGRADE_TIERS, WEAPONS } from '../../../world/gear/weapons'
import { EXIT_RULES } from '../../../world/level/exits'
import { LASER_SIGHT_NAME, PICKUP_NAMES } from '../../../world/names'
import { GuideBinding as MunchopediaGuideBinding } from '../../munchopedia/bindings'
import { Message as MunchopediaMessage } from '../../munchopedia/message'
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

describe('the Munchopedia Finds page', () => {
  it.effect(
    'the Finds tile opens the guide on Guns, and a section button turns it',
    () =>
      Story.story(
        APPLICATION,
        Story.given(home),
        Story.message(Message.ClickedMunchopediaButton()),
        showDialog(),
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
    kitchenKeys: EXIT_RULES.kitchenKeys,
  }

  afterEach(() => {
    Object.assign(WEAPONS.Smg, { magazine: originals.smgMagazine })
    Object.assign(TRAPS.Turret, { hp: originals.turretHp })
    Object.assign(EXIT_RULES, { kitchenKeys: originals.kitchenKeys })
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

  test('a price tag is the keys the table asks, and found things wear none', () => {
    Object.assign(EXIT_RULES, { kitchenKeys: 7 })
    expect(entry('House', 'Boards').price).toEqual(Option.some(7))
    expect(entry('House', 'Fridge').price).toEqual(
      Option.some(FRIDGE_RULES.keys),
    )
    expect(entry('Health', 'Heart').price).toEqual(Option.none())
    expect(entry('Traps', 'Barricade').price).toEqual(Option.none())
  })

  test('a gun lists every tier as a step with the kills it takes', () => {
    const ladder = entry('Guns', 'Shotgun').ladder
    expect(Array.map(ladder, step => step.kills)).toEqual(
      Array.map(UPGRADE_TIERS.Shotgun, tier => tier.kills),
    )
  })

  test('every find is in the guide', () => {
    const names = Array.flatMap(
      ['Guns', 'Health', 'Traps', 'Fridge', 'House'] as const,
      section => Array.map(entriesOf(section), other => other.name),
    )
    for (const name of [
      WEAPONS.Pistol.name,
      WEAPONS.Shotgun.name,
      WEAPONS.Smg.name,
      LASER_SIGHT_NAME,
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
        modifyFields(atFridgeOnWave(3, 0), {
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
      ...ticks(2, FIXED_STEP_MS),
      Story.model(({ seenUnlocks }) => {
        expect(
          Array.filter(seenUnlocks, id => id === prizeUnlockId('Freeze')),
        ).toHaveLength(1)
        expect(seenUnlocks).not.toContain(prizeUnlockId('Cooker'))
      }),
    ),
  )
})
