import { Array, Effect, Option } from 'effect'

import { Component, UiStruct } from '@effect/ui'
import { Story } from '@effect/ui/testing'
import { afterEach, describe, expect, it, test } from '@effect/vitest'

import { isPanelOpen } from '#app/menuState.ts'
import { Message } from '#app/message.ts'
import { FridgeDoor } from '#app/model.ts'
import { GuideStatus } from '#features/guide/model.ts'
import {
  type GuideEntry,
  entriesOf,
  isEntryKnown,
  prizeUnlockId,
} from '#features/guide/shopGuide.ts'
import { munchopediaPropsOf } from '#features/munchopedia/__tests__/munchopedia.fixture.ts'
import { FocusGuideControl, Munchopedia } from '#features/munchopedia/block.ts'
import { Message as MunchopediaMessage } from '#features/munchopedia/message.ts'
import { FIXED_STEP_MS } from '#shared/constants.ts'
import { atFridgeOnWave, home } from '#test/model.fixture.ts'
import { checkModel, modelAfter, send, storyOf, ticks } from '#test/testing.ts'
import { FRIDGE_RULES } from '#world/fridge/leftovers.ts'
import { TRAPS } from '#world/gear/traps.ts'
import { UPGRADE_TIERS, WEAPONS } from '#world/gear/weapons.ts'
import { EXIT_RULES } from '#world/level/exits.ts'
import { LASER_SIGHT_NAME, PICKUP_NAMES } from '#world/names.ts'

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
      Effect.gen(function* () {
        const opened = yield* modelAfter(
          home,
          send(Message.ClickedMunchopediaButton()),
        )
        expect(isPanelOpen(opened, 'Munchopedia')).toBe(true)
        const s = yield* Story.make(Munchopedia, munchopediaPropsOf(opened))
        s.send(MunchopediaMessage.ClickedShopButton()).resolve(
          FocusGuideControl.make({ target: 'Back' }),
          Component.noop,
        )
        expect(s.model.guide).toEqual(GuideStatus.Open({ section: 'Guns' }))
        s.send(
          MunchopediaMessage.ClickedGuideSectionButton({ section: 'House' }),
        )
        expect(s.model.guide).toEqual(GuideStatus.Open({ section: 'House' }))
      }),
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
    Effect.gen(function* () {
      const s = yield* storyOf(
        UiStruct.evolve(atFridgeOnWave(3, 0), {
          fridge: fridge =>
            UiStruct.evolve(fridge, {
              door: () =>
                FridgeDoor.Open({
                  prize: 'Freeze',
                  slot: 0,
                  remainingMs: 800,
                  durationMs: 1100,
                }),
            }),
        }),
      )
      s.pipe(
        ticks(2, FIXED_STEP_MS),
        checkModel(({ seenUnlocks }) => {
          expect(
            Array.filter(seenUnlocks, id => id === prizeUnlockId('Freeze')),
          ).toHaveLength(1)
          expect(seenUnlocks).not.toContain(prizeUnlockId('Cooker'))
        }),
      )
    }),
  )
})
