import { Array, Effect } from 'effect'

import { Component, UiStruct } from '@effect/ui'
import { HtmlLocator, HtmlScene } from '@effect/ui/html/testing'
import { Locator } from '@effect/ui/testing'
import { describe, it } from '@effect/vitest'

import { Message } from '../../../../../app/message'
import type { Model } from '../../../../../app/model'
import { profilePropsOf } from '../../../../../app/profileView'
import { FocusProfileElement } from '../../../../../app/update/profile'
import { PROFILE_DIALOG_ID } from '../../../../../domain/clientSchema'
import type { LookPart } from '../../../../../domain/looks'
import { unlocksAt } from '../../../../../domain/unlocks'
import { homeAfterRead } from '../../../../../test/model.fixture'
import {
  byClass,
  emitPressedKey,
  lookGroup,
  lookSection,
  measureSurface,
  showDialog,
  withAttrs,
} from '../../../../../test/sceneTesting'
import { sceneOf, send, steps, writeSave } from '../../../../../test/testing'
import { noRank, pointsForRank } from '../../../../../world/heroes/rank'
import {
  type LookDesk,
  atLookRoot,
  inLook,
  lookDeskOf,
  lookOption,
  openLookSection,
  seeLook,
  settleLook,
} from '../../../__tests__/profile.fixture'
import { Profile } from '../../../block'

// The Look tab's rows of earned looks (src/features/profile/blocks/look/view.ts,
// src/features/profile/blocks/look/lookGearView.ts): an option in one of four
// states, a pick that wears or buys, the arrow keys that only move, and the
// NEW badges. The Look tab is a child of the Profile, of the root, so its
// rows are drawn in a Scene of their own, each event taken up to a Story of
// the root (profile.fixture.ts); the Bones on the rank plate and the home
// menu's pips are the root's, read in the root's Scene.

const closet: Model = UiStruct.evolve(homeAfterRead, {
  rank: () => ({
    ...noRank,
    earnedPoints: pointsForRank(5),
    earnedBones: 140,
    spentBones: 50,
  }),
  boughtCosmetics: () => ['Fez'],
  seenUnlocks: () => unlocksAt(5),
  appearance: look => ({ ...look, hat: 'Fez' }),
})

// NOTE: the Look tab opened by C, as the root hears it.
const openLook = send(Message.PressedKey({ code: 'KeyC' }))

const lookOpenedFrom = (model: Model) =>
  Effect.map(lookDeskOf(model), atLookRoot(openLook))

// NOTE: the Profile shut by its close, as its Dialog asks.
const closeLook = send(Message.ClosedDialog({ dialog: 'Profile' }))

const buyPill = byClass('look-buy')

const optionsIn = (groupName: string) =>
  Locator.inside(lookGroup(groupName), HtmlLocator.role('radio'))

const newBadge = (part: LookPart, value: string) =>
  Locator.inside(lookOption(part, value), byClass('look-new'))

const has = (
  locator: Locator.Locator,
  attrs: Readonly<Record<string, string>>,
) => seeLook(s => s.expect(withAttrs(attrs)(locator)).toExist())

const standing = (part: LookPart, value: string, name: string) =>
  has(lookOption(part, value), { 'data-standing': name })

const checked = (part: LookPart, value: string, isChecked: boolean) =>
  has(lookOption(part, value), { 'aria-checked': isChecked ? 'true' : 'false' })

const lacks = (locator: Locator.Locator, name: string) =>
  seeLook(s =>
    s.check(() => {
      if (s.get(locator).attrs?.[name] !== undefined) {
        throw new Error(`${locator.description} has ${name}`)
      }
    }),
  )

const click = (locator: Locator.Locator) => inLook(s => s.click(locator))

// NOTE: a buy moves focus to the look bought, its BUY pill gone.
const focusedBought = (part: LookPart, value: string) =>
  atLookRoot(s =>
    s.resolve(
      FocusProfileElement.make({
        selector: `[data-look-option="${part}.${value}"]`,
      }),
      Component.noop,
    ),
  )

// NOTE: the Bones the rank plate over the Profile's tabs shows, drawn by the
// root's Scene from the Model the desk's root holds.
const balanceShown = (desk: LookDesk, count: string) =>
  Effect.gen(function* () {
    const s = yield* sceneOf(desk.root.model)
    s.pipe(measureSurface, showDialog(PROFILE_DIALOG_ID))
      .expect(
        Locator.inside(byClass('profile-rank'), byClass('rank-bones-count')),
      )
      .toHaveText(count)
  })

describe('the gear rows', () => {
  it.effect(
    'every hat is an option: worn, owned, for sale, or a locked gift',
    () =>
      Effect.gen(function* () {
        const desk = yield* lookOpenedFrom(closet)
        steps<LookDesk>(
          openLookSection('Gear'),
          seeLook(s => s.expect(optionsIn('Hat')).toHaveCount(17)),
          standing('Hat', 'Fez', 'Worn'),
          checked('Hat', 'Fez', true),
          standing('Hat', 'None', 'Owned'),
          standing('Hat', 'PartyHat', 'Owned'),
          standing('Hat', 'Colander', 'ForSale'),
          standing('Hat', 'TopHat', 'Locked'),
          checked('Hat', 'TopHat', false),
          seeLook(s => s.expect(optionsIn('Gun skin')).toHaveCount(8)),
          standing('GunSkin', 'Stock', 'Worn'),
          standing('GunSkin', 'Candy', 'ForSale'),
          standing('GunSkin', 'Gold', 'Locked'),
          standing('GunSkin', 'Ember', 'Locked'),
          settleLook,
        )(desk)
      }),
  )

  it.effect(
    'the colors and prints show the earned ones beside the free ones',
    () =>
      Effect.gen(function* () {
        const desk = yield* lookOpenedFrom(closet)
        steps<LookDesk>(
          openLookSection('Outfit'),
          seeLook(s => s.expect(optionsIn('Outfit color')).toHaveCount(12)),
          checked('ShirtColor', 'Blue', true),
          standing('ShirtColor', 'Red', 'Owned'),
          standing('ShirtColor', 'Midnight', 'ForSale'),
          standing('ShirtColor', 'Gold', 'Locked'),
          standing('ShirtColor', 'Frost', 'Locked'),
          seeLook(s => s.expect(optionsIn('Print')).toHaveCount(7)),
          standing('Print', 'Skull', 'ForSale'),
          standing('Print', 'Polka', 'Locked'),
          settleLook,
        )(desk)
      }),
  )

  it.effect(
    'a pick tries the look for sale on, and the BUY pill buys and wears it',
    () =>
      Effect.gen(function* () {
        const desk = yield* lookOpenedFrom(closet)
        steps<LookDesk>(
          settleLook,
          openLookSection('Gear'),
          seeLook(s => s.expect(buyPill).toBeAbsent()),
        )(desk)
        yield* balanceShown(desk, '90')
        steps<LookDesk>(
          click(lookOption('Hat', 'Colander')),
          checked('Hat', 'Colander', false),
          checked('Hat', 'Fez', true),
          has(byClass('look-preview'), {
            'aria-label':
              'Preview: broad build, light skin, brown short hair, blue tee, colander',
          }),
          seeLook(s => s.expect(buyPill).toHaveText('BUY40')),
        )(desk)
        yield* balanceShown(desk, '90')
        steps<LookDesk>(
          click(buyPill),
          focusedBought('Hat', 'Colander'),
          settleLook,
          seeLook(s => s.expect(buyPill).toBeAbsent()),
          checked('Hat', 'Colander', true),
          has(lookOption('Hat', 'Colander'), { 'data-cue': 'Bought' }),
          standing('Hat', 'Fez', 'Owned'),
        )(desk)
        yield* balanceShown(desk, '50')
      }),
  )

  it.effect(
    'a hero shows the hat tried on, and the BUY pill gives the gun skin for 60',
    () =>
      Effect.gen(function* () {
        const desk = yield* lookOpenedFrom(
          UiStruct.evolve(closet, { calling: () => 'Handyman' }),
        )
        steps<LookDesk>(
          settleLook,
          openLookSection('Gear'),
          click(lookOption('GunSkin', 'Candy')),
          has(lookOption('GunSkin', 'Candy'), { 'data-previewed': 'true' }),
          click(lookOption('Hat', 'Colander')),
          lacks(lookOption('GunSkin', 'Candy'), 'data-previewed'),
          seeLook(s => s.expect(buyPill).toHaveText('BUY40')),
          click(lookOption('Hat', 'Fez')),
          seeLook(s => s.expect(buyPill).toBeAbsent()),
          click(lookOption('GunSkin', 'Candy')),
          seeLook(s => s.expect(buyPill).toHaveText('BUY60')),
          click(buyPill),
          focusedBought('GunSkin', 'Candy'),
          settleLook,
          checked('GunSkin', 'Candy', true),
        )(desk)
        yield* balanceShown(desk, '30')
      }),
  )

  it.effect(
    'a look the Bones do not cover is tried on, and BUY waits disabled',
    () =>
      Effect.gen(function* () {
        const desk = yield* lookOpenedFrom(
          UiStruct.evolve(closet, {
            rank: rank => ({ ...rank, earnedBones: 60 }),
          }),
        )
        steps<LookDesk>(
          settleLook,
          openLookSection('Gear'),
          click(lookOption('Hat', 'Plunger')),
          checked('Hat', 'Plunger', false),
          has(buyPill, { 'data-short': 'true' }),
          seeLook(s => s.expect(buyPill).toHaveText('BUY60')),
          checked('Hat', 'Fez', true),
        )(desk)
        yield* balanceShown(desk, '10')
      }),
  )

  it.effect('a locked gift shakes and is not selected', () =>
    Effect.gen(function* () {
      const desk = yield* lookOpenedFrom(closet)
      steps<LookDesk>(
        settleLook,
        openLookSection('Gear'),
        click(lookOption('Hat', 'TopHat')),
        checked('Hat', 'TopHat', false),
        has(lookOption('Hat', 'TopHat'), { 'data-cue': 'Short' }),
        checked('Hat', 'Fez', true),
      )(desk)
    }),
  )

  // NOTE: the kit's RadioGroup moves focus on an arrow key and picks only in
  // a group that is not read only; its keys run in its own update, which a
  // Scene does not run. What the Look tab decides is that an earned row is
  // read only, so walking it never tries on or buys.
  it.effect('the arrow keys only move between the options, and never buy', () =>
    Effect.gen(function* () {
      const desk = yield* lookOpenedFrom(closet)
      steps<LookDesk>(
        settleLook,
        openLookSection('Gear'),
        has(lookGroup('Hat'), { 'aria-readonly': 'true' }),
        has(lookGroup('Gun skin'), { 'aria-readonly': 'true' }),
        checked('Hat', 'Fez', true),
        standing('Hat', 'PumpkinHead', 'ForSale'),
      )(desk)
      yield* balanceShown(desk, '90')
    }),
  )

  it.effect('works by touch and mouse: a pick is a click', () =>
    Effect.gen(function* () {
      const desk = yield* lookOpenedFrom(
        UiStruct.evolve(closet, { lastDevice: () => 'Touch' }),
      )
      steps<LookDesk>(
        settleLook,
        openLookSection('Gear'),
        click(lookOption('Hat', 'None')),
        atLookRoot(writeSave),
        checked('Hat', 'None', true),
        atLookRoot(closeLook),
      )(desk)
    }),
  )
})

describe('NEW badges', () => {
  const reached = UiStruct.evolve(homeAfterRead, {
    rank: () => ({ ...noRank, earnedPoints: pointsForRank(16) }),
    seenUnlocks: () => ['hat:PartyHat'],
  })

  const characterPip = withAttrs({ 'data-card': 'Character' })(
    byClass('manor-pip'),
  )

  it.effect(
    'the MORE button pips the Character card until the Look tab opens',
    () =>
      Effect.gen(function* () {
        const s = yield* sceneOf(reached)
        s.pipe(measureSurface)
          .expect(characterPip)
          .toExist()
          .pipe(emitPressedKey('KeyC'), showDialog(PROFILE_DIALOG_ID))
          .expect(characterPip)
          .toBeAbsent()
          .pipe(writeSave)
        const desk = yield* lookOpenedFrom(reached)
        atLookRoot(writeSave)(desk)
        const profile = yield* HtmlScene.make(
          Profile,
          profilePropsOf(desk.root.model),
        )
        profile
          .expect(
            Locator.inside(
              HtmlLocator.role('tab', { name: 'Look' }),
              byClass('new-pip'),
            ),
          )
          .toBeAbsent()
      }),
  )

  it.effect(
    'opening the Look tab shows the badge on what was unlocked, once',
    () =>
      Effect.gen(function* () {
        const desk = yield* lookOpenedFrom(reached)
        steps<LookDesk>(
          atLookRoot(writeSave),
          openLookSection('Outfit'),
          seeLook(s =>
            s
              .expect(newBadge('ShirtColor', 'Gold'))
              .toExist()
              .expect(newBadge('ShirtColor', 'Blue'))
              .toBeAbsent()
              .expect(newBadge('ShirtColor', 'Glow'))
              .toBeAbsent(),
          ),
          openLookSection('Gear'),
          seeLook(s =>
            s
              .expect(newBadge('Hat', 'BucketHat'))
              .toExist()
              .expect(newBadge('Hat', 'PartyHat'))
              .toBeAbsent()
              .expect(newBadge('Hat', 'Fez'))
              .toBeAbsent(),
          ),
          atLookRoot(closeLook),
          atLookRoot(openLook),
          openLookSection('Outfit'),
          seeLook(s => s.expect(newBadge('ShirtColor', 'Gold')).toBeAbsent()),
          openLookSection('Gear'),
          seeLook(s => s.expect(newBadge('Hat', 'BucketHat')).toBeAbsent()),
          settleLook,
        )(desk)
      }),
  )
})

describe('a NEW badge', () => {
  const reachedGold = UiStruct.evolve(homeAfterRead, {
    rank: () => ({ ...noRank, earnedPoints: pointsForRank(16) }),
    seenUnlocks: () => ['hat:PartyHat'],
  })

  it.effect('goes at once when its look is picked, the others stay', () =>
    Effect.gen(function* () {
      const desk = yield* lookOpenedFrom(reachedGold)
      steps<LookDesk>(
        atLookRoot(writeSave),
        openLookSection('Outfit'),
        seeLook(s => s.expect(newBadge('ShirtColor', 'Gold')).toExist()),
        click(lookOption('ShirtColor', 'Gold')),
        atLookRoot(writeSave),
        seeLook(s => s.expect(newBadge('ShirtColor', 'Gold')).toBeAbsent()),
        checked('ShirtColor', 'Gold', true),
        openLookSection('Gear'),
        seeLook(s => s.expect(newBadge('Hat', 'BucketHat')).toExist()),
      )(desk)
    }),
  )
})

describe('the sections', () => {
  it.effect('there are four, and the Gear one holds the hat and the gun', () =>
    Effect.gen(function* () {
      const desk = yield* lookOpenedFrom(closet)
      steps<LookDesk>(
        settleLook,
        seeLook(s =>
          Array.reduce(['Body', 'Hair', 'Outfit', 'Gear'], s, (scene, name) =>
            scene.expect(lookSection(name)).toExist(),
          )
            .expect(lookGroup('Hat'))
            .toBeAbsent(),
        ),
        openLookSection('Gear'),
        seeLook(s =>
          s
            .expect(lookGroup('Hat'))
            .toExist()
            .expect(lookGroup('Gun skin'))
            .toExist(),
        ),
      )(desk)
    }),
  )
})
