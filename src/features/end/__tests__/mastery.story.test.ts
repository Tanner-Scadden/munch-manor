import { Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it, test } from '@effect/vitest'

import { ProfileBinding } from '../../../app/bindings'
import { type Model } from '../../../app/model'
import { MasteryUnlock } from '../../../domain/clientSchema'
import {
  fitPropStyle,
  heroLevelIn,
  isStyleOpen,
  masterySkinIn,
  masterySkinOf,
  unlocksBetween,
} from '../../../domain/mastery'
import { type SavedMastery, noMastery } from '../../../shared/masteryData'
import { home } from '../../../test/model.fixture'
import { APPLICATION, writeSave } from '../../../test/testing'
import { focusOf, modifyFocus } from '../../../world/party/party'
import { Message as ProfileMessage } from '../../profile/message'
import { unlocksOf } from '../endBeat'
import { checkSavedChanges, diesOnWave7, frame, leave } from './rank.fixture'

// Hero and gun mastery (src/domain/mastery.ts, ./masteryRun.ts): a run
// pays its hero 10 points a wave cleared and 25 a dare thing found, and
// each gun its kills, at the moments it pays rank; a level opens a prop
// style the Profile's MASTERY tab wears, and a gun's 1,000th kill opens
// its Gilded skin, both flipped on the end card.

const withMastery = (model: Model, mastery: SavedMastery): Model =>
  modifyFields(model, { mastery: () => mastery })

const callingOf = (model: Model) => focusOf(model).player.calling

// NOTE: the run's own seat with `kills` Pistol kills in its tally.
const withPistolKills = (model: Model, kills: number): Model =>
  modifyFocus(model, {
    feats: feats =>
      modifyFields(feats, {
        killsWith: killsWith => ({ ...killsWith, Pistol: kills }),
      }),
  })

describe("a run pays its hero's track", () => {
  it.effect('10 points a wave cleared, not a win', () =>
    Story.story(
      APPLICATION,
      Story.given(diesOnWave7),
      frame,
      Story.model(after => {
        expect(after.mastery.heroes).toEqual({ [callingOf(diesOnWave7)]: 60 })
      }),
      checkSavedChanges(changes => {
        expect(changes).toContainEqual({
          _tag: 'GainedMastery',
          added: { heroes: { [callingOf(diesOnWave7)]: 60 }, guns: {} },
        })
      }),
      writeSave(),
    ),
  )

  it.effect(
    'as an increment on what it had, and flips the level it reached',
    () =>
      Story.story(
        APPLICATION,
        Story.given(
          withMastery(diesOnWave7, {
            heroes: { [callingOf(diesOnWave7)]: 90 },
            guns: {},
          }),
        ),
        frame,
        Story.model(after => {
          expect(after.mastery.heroes[callingOf(diesOnWave7)]).toBe(150)
          expect(after.masteryRun.unlocks).toEqual([
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
        writeSave(),
      ),
  )

  it.effect('once: a run left for the menu pays and then nothing more', () =>
    Story.story(
      APPLICATION,
      Story.given(diesOnWave7),
      leave,
      Story.model(after => {
        expect(after.mastery.heroes).toEqual({ [callingOf(diesOnWave7)]: 60 })
        expect(after.masteryRun.unlocks).toEqual([])
      }),
      writeSave(),
    ),
  )
})

describe("a gun's kills fill its track", () => {
  it.effect('each kill with a gun is a kill on its track', () =>
    Story.story(
      APPLICATION,
      Story.given(withPistolKills(diesOnWave7, 40)),
      frame,
      Story.model(after => {
        expect(after.mastery.guns).toEqual({ Pistol: 40 })
        expect(masterySkinIn(after.mastery, 'Pistol')).toEqual(Option.none())
      }),
      writeSave(),
    ),
  )

  it.effect('the 1,000th kill opens the Gilded skin and flips it', () =>
    Story.story(
      APPLICATION,
      Story.given(
        withMastery(withPistolKills(diesOnWave7, 5), {
          heroes: {},
          guns: { Pistol: 996 },
        }),
      ),
      frame,
      Story.model(after => {
        expect(after.mastery.guns['Pistol']).toBe(1001)
        expect(masterySkinIn(after.mastery, 'Pistol')).toEqual(
          Option.some('Gilded'),
        )
        expect(after.masteryRun.unlocks).toContainEqual(
          MasteryUnlock.GunMastery({ kind: 'Pistol', skin: 'Gilded' }),
        )
      }),
      writeSave(),
    ),
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
    Story.story(
      APPLICATION,
      Story.given(atLevel1),
      Story.messageIn(
        ProfileBinding,
        ProfileMessage.ClickedPropStyle({ style: 'Silver' }),
      ),
      Story.model(after => {
        expect(after.appearance.propStyle).toBe('Silver')
      }),
    ),
  )

  it.effect('a shut one is not', () =>
    Story.story(
      APPLICATION,
      Story.given(atLevel1),
      Story.messageIn(
        ProfileBinding,
        ProfileMessage.ClickedPropStyle({ style: 'Gold' }),
      ),
      Story.model(after => {
        expect(after.appearance.propStyle).toBe('Stock')
      }),
    ),
  )

  test('a style worn goes back to Stock on a hero that has not opened it', () => {
    const worn = modifyFields(atLevel1, {
      appearance: look => ({ ...look, propStyle: 'Silver' as const }),
    })
    expect(fitPropStyle(worn)).toBe(worn)
    expect(
      fitPropStyle(withMastery(worn, noMastery)).appearance.propStyle,
    ).toBe('Stock')
  })
})
