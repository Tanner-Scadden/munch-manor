import { Array } from 'effect'
import {
  Command,
  all,
  click,
  expect,
  expectAll,
  given,
  keydown,
  role,
  scene,
  selector,
  within,
} from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'

import { Dialog, DialogBlock } from '@foldkit/ui'

import { Message } from './message'
import type { Model } from './model'
import { homeAfterRead } from './model.fixture'
import { noRank, pointsForRank } from './rank'
import {
  ROOT,
  closeButton,
  emitPressedKey,
  lookGroup,
  lookOptionIn,
  lookSection,
  measureSurface,
  openLookSection,
  resolveFocusOptionInScene,
  showDialogInScene,
} from './testing'
import { unlocksAt } from './unlocks'
import { FocusLookOption } from './update/character'
import { WriteSave } from './update/save'

// The Look tab's rows of earned looks (src/characterView.ts,
// src/lookGearView.ts): an option in one of four states, a pick that wears
// or buys, the arrow keys that only move, and the NEW badges.

const closet: Model = modifyFields(homeAfterRead, {
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

const closeLook = () => [
  click(closeButton),
  Command.resolve(
    Dialog.test.CloseDialog,
    DialogBlock.Message.CompletedCloseDialog(),
  ),
]

const openLook = () => [emitPressedKey('KeyC'), ...showDialogInScene()]

const balance = selector('.profile-rank .rank-bones-count')

const buyPill = selector('.look-buy')

describe('the gear rows', () => {
  test('every hat is an option: worn, owned, for sale, or a locked gift', () => {
    scene(
      ROOT,
      given(closet),
      measureSurface,
      ...openLook(),
      ...openLookSection('Gear'),
      expectAll(
        all.selector('[role="radio"][id^="look-hat-option-"]'),
      ).toHaveCount(17),
      expect(lookOptionIn('Hat', 'Fez')).toHaveAttr('data-standing', 'Worn'),
      expect(lookOptionIn('Hat', 'Fez')).toHaveAttr('aria-checked', 'true'),
      expect(lookOptionIn('Hat', 'No hat')).toHaveAttr(
        'data-standing',
        'Owned',
      ),
      expect(lookOptionIn('Hat', 'Party Hat')).toHaveAttr(
        'data-standing',
        'Owned',
      ),
      expect(lookOptionIn('Hat', 'Colander')).toHaveAttr(
        'data-standing',
        'ForSale',
      ),
      expect(lookOptionIn('Hat', 'Top Hat')).toHaveAttr(
        'data-standing',
        'Locked',
      ),
      expect(lookOptionIn('Hat', 'Top Hat')).toHaveAttr(
        'aria-checked',
        'false',
      ),
      expectAll(
        all.selector('[role="radio"][id^="look-gun-skin-option-"]'),
      ).toHaveCount(6),
      expect(lookOptionIn('Gun skin', 'Stock')).toHaveAttr(
        'data-standing',
        'Worn',
      ),
      expect(lookOptionIn('Gun skin', 'Candy')).toHaveAttr(
        'data-standing',
        'ForSale',
      ),
      expect(lookOptionIn('Gun skin', 'Gold')).toHaveAttr(
        'data-standing',
        'Locked',
      ),
    )
  })

  test('the colors and prints show the earned ones beside the free ones', () => {
    scene(
      ROOT,
      given(closet),
      measureSurface,
      ...openLook(),
      ...openLookSection('Outfit'),
      expectAll(
        all.selector('[role="radio"][id^="look-shirt-color-option-"]'),
      ).toHaveCount(10),
      expect(lookOptionIn('Outfit color', 'Blue')).toHaveAttr(
        'aria-checked',
        'true',
      ),
      expect(lookOptionIn('Outfit color', 'Red')).toHaveAttr(
        'data-standing',
        'Owned',
      ),
      expect(lookOptionIn('Outfit color', 'Midnight')).toHaveAttr(
        'data-standing',
        'ForSale',
      ),
      expect(lookOptionIn('Outfit color', 'Gold')).toHaveAttr(
        'data-standing',
        'Locked',
      ),
      expectAll(
        all.selector('[role="radio"][id^="look-print-option-"]'),
      ).toHaveCount(7),
      expect(lookOptionIn('Print', 'Skull')).toHaveAttr(
        'data-standing',
        'ForSale',
      ),
      expect(lookOptionIn('Print', 'Polka')).toHaveAttr(
        'data-standing',
        'Locked',
      ),
    )
  })

  test('a pick tries the look for sale on, and the BUY pill buys and wears it', () => {
    scene(
      ROOT,
      given(closet),
      measureSurface,
      ...openLook(),
      ...openLookSection('Gear'),
      expect(balance).toHaveText('90'),
      expect(buyPill).toBeAbsent(),
      click(lookOptionIn('Hat', 'Colander')),
      expect(lookOptionIn('Hat', 'Colander')).toHaveAttr(
        'aria-checked',
        'false',
      ),
      expect(lookOptionIn('Hat', 'Fez')).toHaveAttr('aria-checked', 'true'),
      expect(selector('.look-preview')).toHaveAttr(
        'aria-label',
        'Preview: broad build, light skin, brown short hair, blue tee, colander',
      ),
      expect(buyPill).toHaveText('BUY40'),
      expect(balance).toHaveText('90'),
      click(buyPill),
      Command.resolve(FocusLookOption, Message.CompletedFocusLookOption()),
      Command.resolve(WriteSave, Message.CompletedWriteSave()),
      expect(buyPill).toBeAbsent(),
      expect(lookOptionIn('Hat', 'Colander')).toHaveAttr(
        'aria-checked',
        'true',
      ),
      expect(lookOptionIn('Hat', 'Colander')).toHaveAttr('data-cue', 'Bought'),
      expect(lookOptionIn('Hat', 'Fez')).toHaveAttr('data-standing', 'Owned'),
      expect(balance).toHaveText('50'),
    )
  })

  test('a hero shows the hat tried on, and the BUY pill gives the gun skin for 60', () => {
    scene(
      ROOT,
      given(modifyFields(closet, { calling: () => 'Handyman' })),
      measureSurface,
      ...openLook(),
      ...openLookSection('Gear'),
      click(lookOptionIn('Gun skin', 'Candy')),
      expect(lookOptionIn('Gun skin', 'Candy')).toHaveAttr(
        'data-previewed',
        'true',
      ),
      click(lookOptionIn('Hat', 'Colander')),
      expect(lookOptionIn('Gun skin', 'Candy')).not.toHaveAttr(
        'data-previewed',
        'true',
      ),
      expect(buyPill).toHaveText('BUY40'),
      click(lookOptionIn('Hat', 'Fez')),
      expect(buyPill).toBeAbsent(),
      click(lookOptionIn('Gun skin', 'Candy')),
      expect(buyPill).toHaveText('BUY60'),
      click(buyPill),
      Command.resolve(FocusLookOption, Message.CompletedFocusLookOption()),
      Command.resolve(WriteSave, Message.CompletedWriteSave()),
      expect(lookOptionIn('Gun skin', 'Candy')).toHaveAttr(
        'aria-checked',
        'true',
      ),
      expect(balance).toHaveText('30'),
    )
  })

  test('a look the Bones do not cover is tried on, and BUY waits disabled', () => {
    scene(
      ROOT,
      given(
        modifyFields(closet, { rank: rank => ({ ...rank, earnedBones: 60 }) }),
      ),
      measureSurface,
      ...openLook(),
      ...openLookSection('Gear'),
      click(lookOptionIn('Hat', 'Plunger')),
      expect(lookOptionIn('Hat', 'Plunger')).toHaveAttr(
        'aria-checked',
        'false',
      ),
      expect(buyPill).toHaveAttr('data-short', 'true'),
      expect(buyPill).toHaveText('BUY60'),
      expect(lookOptionIn('Hat', 'Fez')).toHaveAttr('aria-checked', 'true'),
      expect(balance).toHaveText('10'),
    )
  })

  test('a locked gift shakes and is not selected', () => {
    scene(
      ROOT,
      given(closet),
      measureSurface,
      ...openLook(),
      ...openLookSection('Gear'),
      click(lookOptionIn('Hat', 'Top Hat')),
      expect(lookOptionIn('Hat', 'Top Hat')).toHaveAttr(
        'aria-checked',
        'false',
      ),
      expect(lookOptionIn('Hat', 'Top Hat')).toHaveAttr('data-cue', 'Short'),
      expect(lookOptionIn('Hat', 'Fez')).toHaveAttr('aria-checked', 'true'),
    )
  })

  test('the arrow keys only move between the options, and never buy', () => {
    scene(
      ROOT,
      given(closet),
      measureSurface,
      ...openLook(),
      ...openLookSection('Gear'),
      keydown(lookOptionIn('Hat', 'Fez'), 'ArrowRight'),
      resolveFocusOptionInScene(),
      keydown(lookOptionIn('Hat', 'Fez'), 'ArrowRight'),
      resolveFocusOptionInScene(),
      keydown(lookOptionIn('Hat', 'Fez'), 'End'),
      resolveFocusOptionInScene(),
      expect(lookOptionIn('Hat', 'Fez')).toHaveAttr('aria-checked', 'true'),
      expect(lookOptionIn('Hat', 'Pumpkin Head')).toHaveAttr(
        'data-standing',
        'ForSale',
      ),
      expect(balance).toHaveText('90'),
    )
  })

  test('works by touch and mouse: a pick is a click', () => {
    scene(
      ROOT,
      given(modifyFields(closet, { lastDevice: () => 'Touch' })),
      measureSurface,
      ...openLook(),
      ...openLookSection('Gear'),
      click(lookOptionIn('Hat', 'No hat')),
      Command.resolve(WriteSave, Message.CompletedWriteSave()),
      expect(lookOptionIn('Hat', 'No hat')).toHaveAttr('aria-checked', 'true'),
      ...closeLook(),
    )
  })
})

describe('NEW badges', () => {
  const reached = modifyFields(homeAfterRead, {
    rank: () => ({ ...noRank, earnedPoints: pointsForRank(16) }),
    seenUnlocks: () => ['hat:PartyHat'],
  })

  const newBadge = (groupName: string, name: string) =>
    within(lookOptionIn(groupName, name), selector('.look-new'))

  test('the MORE button pips the Character card until the Look tab opens', () => {
    scene(
      ROOT,
      given(reached),
      measureSurface,
      expect(selector('.manor-pip[data-card="Character"]')).toExist(),
      ...openLook(),
      expect(selector('.manor-pip[data-card="Character"]')).toBeAbsent(),
      Command.resolve(WriteSave, Message.CompletedWriteSave()),
      expect(
        within(role('tab', { name: 'Look' }), selector('.new-pip')),
      ).toBeAbsent(),
    )
  })

  test('opening the Look tab shows the badge on what was unlocked, once', () => {
    scene(
      ROOT,
      given(reached),
      measureSurface,
      ...openLook(),
      Command.resolve(WriteSave, Message.CompletedWriteSave()),
      ...openLookSection('Outfit'),
      expect(newBadge('Outfit color', 'Gold')).toExist(),
      expect(newBadge('Outfit color', 'Blue')).toBeAbsent(),
      expect(newBadge('Outfit color', 'Glow')).toBeAbsent(),
      ...openLookSection('Gear'),
      expect(newBadge('Hat', 'Bucket Hat')).toExist(),
      expect(newBadge('Hat', 'Party Hat')).toBeAbsent(),
      expect(newBadge('Hat', 'Fez')).toBeAbsent(),
      ...closeLook(),
      ...openLook(),
      ...openLookSection('Outfit'),
      expect(newBadge('Outfit color', 'Gold')).toBeAbsent(),
      ...openLookSection('Gear'),
      expect(newBadge('Hat', 'Bucket Hat')).toBeAbsent(),
    )
  })
})

describe('a NEW badge', () => {
  const reachedGold = modifyFields(homeAfterRead, {
    rank: () => ({ ...noRank, earnedPoints: pointsForRank(16) }),
    seenUnlocks: () => ['hat:PartyHat'],
  })

  test('goes at once when its look is picked, the others stay', () => {
    scene(
      ROOT,
      given(reachedGold),
      measureSurface,
      ...openLook(),
      Command.resolve(WriteSave, Message.CompletedWriteSave()),
      ...openLookSection('Outfit'),
      expect(
        within(lookOptionIn('Outfit color', 'Gold'), selector('.look-new')),
      ).toExist(),
      click(lookOptionIn('Outfit color', 'Gold')),
      Command.resolve(WriteSave, Message.CompletedWriteSave()),
      expect(
        within(lookOptionIn('Outfit color', 'Gold'), selector('.look-new')),
      ).toBeAbsent(),
      expect(lookOptionIn('Outfit color', 'Gold')).toHaveAttr(
        'aria-checked',
        'true',
      ),
      ...openLookSection('Gear'),
      expect(
        within(lookOptionIn('Hat', 'Bucket Hat'), selector('.look-new')),
      ).toExist(),
    )
  })
})

describe('the sections', () => {
  test('there are four, and the Gear one holds the hat and the gun', () => {
    scene(
      ROOT,
      given(closet),
      measureSurface,
      ...openLook(),
      ...Array.map(['Body', 'Hair', 'Outfit', 'Gear'], name =>
        expect(lookSection(name)).toExist(),
      ),
      expect(lookGroup('Hat')).toBeAbsent(),
      ...openLookSection('Gear'),
      expect(lookGroup('Hat')).toExist(),
      expect(lookGroup('Gun skin')).toExist(),
    )
  })
})
