import { Effect, Option } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it, test } from '@effect/vitest'

import { Message } from '#app/message.ts'
import { type Model } from '#app/model.ts'
import { MasteryUnlock } from '#domain/clientSchema.ts'
import {
  fitPropStyle,
  heroLevelIn,
  isStyleOpen,
  masterySkinIn,
  masterySkinOf,
  unlocksBetween,
} from '#domain/mastery.ts'
import { unlocksOf } from '#features/end/endBeat.ts'
import { type SavedMastery, noMastery } from '#shared/records/masteryData.ts'
import { home } from '#test/model.fixture.ts'
import { checkModel, send, storyOf, writeSave } from '#test/testing.ts'
import { focusOf, modifyFocus } from '#world/party/party.ts'

import { checkSavedChanges, diesOnWave7, frame, leave } from './rank.fixture.ts'

const withMastery = (model: Model, mastery: SavedMastery): Model =>
  UiStruct.evolve(model, { mastery: () => mastery })

const callingOf = (model: Model) => focusOf(model).player.calling

const withPistolKills = (model: Model, kills: number): Model =>
  modifyFocus(model, {
    feats: feats =>
      UiStruct.evolve(feats, {
        killsWith: killsWith => ({ ...killsWith, Pistol: kills }),
      }),
  })

describe("a run pays its hero's track", () => {
  it.effect('10 points a wave cleared, not a win', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(diesOnWave7)
      s.pipe(
        frame,
        checkModel(after => {
          expect(after.mastery.heroes).toEqual({ [callingOf(diesOnWave7)]: 60 })
        }),
        checkSavedChanges(changes => {
          expect(changes).toContainEqual({
            _tag: 'GainedMastery',
            added: { heroes: { [callingOf(diesOnWave7)]: 60 }, guns: {} },
          })
        }),
        writeSave,
      )
    }),
  )

  it.effect(
    'as an increment on what it had, and flips the level it reached',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(
          withMastery(diesOnWave7, {
            heroes: { [callingOf(diesOnWave7)]: 90 },
            guns: {},
          }),
        )
        s.pipe(
          frame,
          checkModel(after => {
            expect(after.mastery.heroes[callingOf(diesOnWave7)]).toBe(150)
            expect(after.runGains.masteryRun.unlocks).toEqual([
              MasteryUnlock.HeroLevel({
                calling: callingOf(diesOnWave7),
                level: 1,
              }),
            ])
            expect(unlocksOf(after)).toContainEqual(
              expect.objectContaining({
                _tag: 'HeroLevel',
                calling: callingOf(diesOnWave7),
                level: 1,
              }),
            )
          }),
          writeSave,
        )
      }),
  )

  it.effect('once: a run left for the menu pays and then nothing more', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(diesOnWave7)
      s.pipe(
        leave,
        checkModel(after => {
          expect(after.mastery.heroes).toEqual({ [callingOf(diesOnWave7)]: 60 })
          expect(after.runGains.masteryRun.unlocks).toEqual([])
        }),
        writeSave,
      )
    }),
  )
})

describe("a gun's kills fill its track", () => {
  it.effect('each kill with a gun is a kill on its track', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(withPistolKills(diesOnWave7, 40))
      s.pipe(
        frame,
        checkModel(after => {
          expect(after.mastery.guns).toEqual({ Pistol: 40 })
          expect(masterySkinIn(after.mastery, 'Pistol')).toEqual(Option.none())
        }),
        writeSave,
      )
    }),
  )

  it.effect('the 1,000th kill opens the Gilded skin and flips it', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(
        withMastery(withPistolKills(diesOnWave7, 5), {
          heroes: {},
          guns: { Pistol: 996 },
        }),
      )
      s.pipe(
        frame,
        checkModel(after => {
          expect(after.mastery.guns['Pistol']).toBe(1001)
          expect(masterySkinIn(after.mastery, 'Pistol')).toEqual(
            Option.some('Gilded'),
          )
          expect(after.runGains.masteryRun.unlocks).toContainEqual(
            MasteryUnlock.GunMastery({ kind: 'Pistol', skin: 'Gilded' }),
          )
        }),
        writeSave,
      )
    }),
  )

  test('the steps: none, Gilded at 1,000, Diamond at 2,500', () => {
    expect(masterySkinOf(999)).toEqual(Option.none())
    expect(masterySkinOf(1000)).toEqual(Option.some('Gilded'))
    expect(masterySkinOf(2499)).toEqual(Option.some('Gilded'))
    expect(masterySkinOf(2500)).toEqual(Option.some('Diamond'))
    expect(
      unlocksBetween(
        { heroes: {}, guns: { Smg: 900 } },
        {
          heroes: {},
          guns: { Smg: 2600 },
        },
      ),
    ).toEqual([
      MasteryUnlock.GunMastery({ kind: 'Smg', skin: 'Gilded' }),
      MasteryUnlock.GunMastery({ kind: 'Smg', skin: 'Diamond' }),
    ])
  })
})

describe('a level opens its prop style', () => {
  const calling = home.calling
  const atLevel1 = withMastery(home, { heroes: { [calling]: 100 }, guns: {} })

  test('level 1 opens Silver, and Midnight waits for level 2', () => {
    expect(heroLevelIn(atLevel1.mastery, calling)).toBe(1)
    expect(isStyleOpen(atLevel1.mastery, calling, 'Silver')).toBe(true)
    expect(isStyleOpen(atLevel1.mastery, calling, 'Night')).toBe(false)
    expect(isStyleOpen(noMastery, calling, 'Silver')).toBe(false)
  })

  it.effect('a swatch the track has opened is worn', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(atLevel1)
      s.pipe(
        send(Message.ChoseProfilePropStyle({ style: 'Silver' })),
        checkModel(after => {
          expect(after.appearance.propStyle).toBe('Silver')
        }),
      )
    }),
  )

  it.effect('a shut one is not', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(atLevel1)
      s.pipe(
        send(Message.ChoseProfilePropStyle({ style: 'Gold' })),
        checkModel(after => {
          expect(after.appearance.propStyle).toBe('Stock')
        }),
      )
    }),
  )

  test('a style worn goes back to Stock on a hero that has not opened it', () => {
    const worn = UiStruct.evolve(atLevel1, {
      appearance: look => ({ ...look, propStyle: 'Silver' as const }),
    })
    expect(fitPropStyle(worn)).toBe(worn)
    expect(
      fitPropStyle(withMastery(worn, noMastery)).appearance.propStyle,
    ).toBe('Stock')
  })
})
