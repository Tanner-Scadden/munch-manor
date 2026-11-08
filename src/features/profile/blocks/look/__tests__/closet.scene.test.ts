import { Array } from 'effect'
import { Scene } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, it } from '@effect/vitest'
import { Dialog, DialogBlock } from '@foldkit/ui'

import { Message } from '../../../../../app/message'
import type { Model } from '../../../../../app/model'
import { WriteSave } from '../../../../../app/update/save'
import { homeAfterRead } from '../../../../../test/model.fixture'
import {
  APPLICATION,
  closeButton,
  emitPressedKey,
  lookGroup,
  lookOptionIn,
  lookSection,
  measureSurface,
  openLookSection,
  resolveFocusOptionInScene,
  showDialogInScene,
} from '../../../../../test/testing'
import { noRank, pointsForRank } from '../../../../../world/heroes/rank'
import { unlocksAt } from '../../../../unlocks/unlocks'
import { FocusLookOption } from '../../../inMessageUpdate'
import { Message as ProfileMessage } from '../../../message'

// The Look tab's rows of earned looks (src/features/profile/blocks/look/view.ts,
// src/features/profile/blocks/look/lookGearView.ts): an option in one of four states, a pick that wears
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
  Scene.click(closeButton),
  Scene.Command.resolve(
    Dialog.test.CloseDialog,
    DialogBlock.Message.CompletedCloseDialog(),
  ),
]

const openLook = () => [emitPressedKey('KeyC'), ...showDialogInScene()]

const balance = Scene.selector('.profile-rank .rank-bones-count')

const buyPill = Scene.selector('.look-buy')

describe('the gear rows', () => {
  it.effect(
    'every hat is an option: worn, owned, for sale, or a locked gift',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(closet),
        measureSurface,
        ...openLook(),
        ...openLookSection('Gear'),
        Scene.expectAll(
          Scene.all.selector('[role="radio"][id^="look-hat-option-"]'),
        ).toHaveCount(17),
        Scene.expect(lookOptionIn('Hat', 'Fez')).toHaveAttr(
          'data-standing',
          'Worn',
        ),
        Scene.expect(lookOptionIn('Hat', 'Fez')).toHaveAttr(
          'aria-checked',
          'true',
        ),
        Scene.expect(lookOptionIn('Hat', 'No hat')).toHaveAttr(
          'data-standing',
          'Owned',
        ),
        Scene.expect(lookOptionIn('Hat', 'Party Hat')).toHaveAttr(
          'data-standing',
          'Owned',
        ),
        Scene.expect(lookOptionIn('Hat', 'Colander')).toHaveAttr(
          'data-standing',
          'ForSale',
        ),
        Scene.expect(lookOptionIn('Hat', 'Top Hat')).toHaveAttr(
          'data-standing',
          'Locked',
        ),
        Scene.expect(lookOptionIn('Hat', 'Top Hat')).toHaveAttr(
          'aria-checked',
          'false',
        ),
        Scene.expectAll(
          Scene.all.selector('[role="radio"][id^="look-gun-skin-option-"]'),
        ).toHaveCount(6),
        Scene.expect(lookOptionIn('Gun skin', 'Stock')).toHaveAttr(
          'data-standing',
          'Worn',
        ),
        Scene.expect(lookOptionIn('Gun skin', 'Candy')).toHaveAttr(
          'data-standing',
          'ForSale',
        ),
        Scene.expect(lookOptionIn('Gun skin', 'Gold')).toHaveAttr(
          'data-standing',
          'Locked',
        ),
      ),
  )

  it.effect(
    'the colors and prints show the earned ones beside the free ones',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(closet),
        measureSurface,
        ...openLook(),
        ...openLookSection('Outfit'),
        Scene.expectAll(
          Scene.all.selector('[role="radio"][id^="look-shirt-color-option-"]'),
        ).toHaveCount(10),
        Scene.expect(lookOptionIn('Outfit color', 'Blue')).toHaveAttr(
          'aria-checked',
          'true',
        ),
        Scene.expect(lookOptionIn('Outfit color', 'Red')).toHaveAttr(
          'data-standing',
          'Owned',
        ),
        Scene.expect(lookOptionIn('Outfit color', 'Midnight')).toHaveAttr(
          'data-standing',
          'ForSale',
        ),
        Scene.expect(lookOptionIn('Outfit color', 'Gold')).toHaveAttr(
          'data-standing',
          'Locked',
        ),
        Scene.expectAll(
          Scene.all.selector('[role="radio"][id^="look-print-option-"]'),
        ).toHaveCount(7),
        Scene.expect(lookOptionIn('Print', 'Skull')).toHaveAttr(
          'data-standing',
          'ForSale',
        ),
        Scene.expect(lookOptionIn('Print', 'Polka')).toHaveAttr(
          'data-standing',
          'Locked',
        ),
      ),
  )

  it.effect(
    'a pick tries the look for sale on, and the BUY pill buys and wears it',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(closet),
        measureSurface,
        ...openLook(),
        ...openLookSection('Gear'),
        Scene.expect(balance).toHaveText('90'),
        Scene.expect(buyPill).toBeAbsent(),
        Scene.click(lookOptionIn('Hat', 'Colander')),
        Scene.expect(lookOptionIn('Hat', 'Colander')).toHaveAttr(
          'aria-checked',
          'false',
        ),
        Scene.expect(lookOptionIn('Hat', 'Fez')).toHaveAttr(
          'aria-checked',
          'true',
        ),
        Scene.expect(Scene.selector('.look-preview')).toHaveAttr(
          'aria-label',
          'Preview: broad build, light skin, brown short hair, blue tee, colander',
        ),
        Scene.expect(buyPill).toHaveText('BUY40'),
        Scene.expect(balance).toHaveText('90'),
        Scene.click(buyPill),
        Scene.Command.resolve(
          FocusLookOption,
          ProfileMessage.CompletedFocusLookOption(),
        ),
        Scene.Command.resolve(WriteSave, Message.CompletedWriteSave()),
        Scene.expect(buyPill).toBeAbsent(),
        Scene.expect(lookOptionIn('Hat', 'Colander')).toHaveAttr(
          'aria-checked',
          'true',
        ),
        Scene.expect(lookOptionIn('Hat', 'Colander')).toHaveAttr(
          'data-cue',
          'Bought',
        ),
        Scene.expect(lookOptionIn('Hat', 'Fez')).toHaveAttr(
          'data-standing',
          'Owned',
        ),
        Scene.expect(balance).toHaveText('50'),
      ),
  )

  it.effect(
    'a hero shows the hat tried on, and the BUY pill gives the gun skin for 60',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(modifyFields(closet, { calling: () => 'Handyman' })),
        measureSurface,
        ...openLook(),
        ...openLookSection('Gear'),
        Scene.click(lookOptionIn('Gun skin', 'Candy')),
        Scene.expect(lookOptionIn('Gun skin', 'Candy')).toHaveAttr(
          'data-previewed',
          'true',
        ),
        Scene.click(lookOptionIn('Hat', 'Colander')),
        Scene.expect(lookOptionIn('Gun skin', 'Candy')).not.toHaveAttr(
          'data-previewed',
          'true',
        ),
        Scene.expect(buyPill).toHaveText('BUY40'),
        Scene.click(lookOptionIn('Hat', 'Fez')),
        Scene.expect(buyPill).toBeAbsent(),
        Scene.click(lookOptionIn('Gun skin', 'Candy')),
        Scene.expect(buyPill).toHaveText('BUY60'),
        Scene.click(buyPill),
        Scene.Command.resolve(
          FocusLookOption,
          ProfileMessage.CompletedFocusLookOption(),
        ),
        Scene.Command.resolve(WriteSave, Message.CompletedWriteSave()),
        Scene.expect(lookOptionIn('Gun skin', 'Candy')).toHaveAttr(
          'aria-checked',
          'true',
        ),
        Scene.expect(balance).toHaveText('30'),
      ),
  )

  it.effect(
    'a look the Bones do not cover is tried on, and BUY waits disabled',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(
          modifyFields(closet, {
            rank: rank => ({ ...rank, earnedBones: 60 }),
          }),
        ),
        measureSurface,
        ...openLook(),
        ...openLookSection('Gear'),
        Scene.click(lookOptionIn('Hat', 'Plunger')),
        Scene.expect(lookOptionIn('Hat', 'Plunger')).toHaveAttr(
          'aria-checked',
          'false',
        ),
        Scene.expect(buyPill).toHaveAttr('data-short', 'true'),
        Scene.expect(buyPill).toHaveText('BUY60'),
        Scene.expect(lookOptionIn('Hat', 'Fez')).toHaveAttr(
          'aria-checked',
          'true',
        ),
        Scene.expect(balance).toHaveText('10'),
      ),
  )

  it.effect('a locked gift shakes and is not selected', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(closet),
      measureSurface,
      ...openLook(),
      ...openLookSection('Gear'),
      Scene.click(lookOptionIn('Hat', 'Top Hat')),
      Scene.expect(lookOptionIn('Hat', 'Top Hat')).toHaveAttr(
        'aria-checked',
        'false',
      ),
      Scene.expect(lookOptionIn('Hat', 'Top Hat')).toHaveAttr(
        'data-cue',
        'Short',
      ),
      Scene.expect(lookOptionIn('Hat', 'Fez')).toHaveAttr(
        'aria-checked',
        'true',
      ),
    ),
  )

  it.effect('the arrow keys only move between the options, and never buy', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(closet),
      measureSurface,
      ...openLook(),
      ...openLookSection('Gear'),
      Scene.keydown(lookOptionIn('Hat', 'Fez'), 'ArrowRight'),
      resolveFocusOptionInScene(),
      Scene.keydown(lookOptionIn('Hat', 'Fez'), 'ArrowRight'),
      resolveFocusOptionInScene(),
      Scene.keydown(lookOptionIn('Hat', 'Fez'), 'End'),
      resolveFocusOptionInScene(),
      Scene.expect(lookOptionIn('Hat', 'Fez')).toHaveAttr(
        'aria-checked',
        'true',
      ),
      Scene.expect(lookOptionIn('Hat', 'Pumpkin Head')).toHaveAttr(
        'data-standing',
        'ForSale',
      ),
      Scene.expect(balance).toHaveText('90'),
    ),
  )

  it.effect('works by touch and mouse: a pick is a click', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(modifyFields(closet, { lastDevice: () => 'Touch' })),
      measureSurface,
      ...openLook(),
      ...openLookSection('Gear'),
      Scene.click(lookOptionIn('Hat', 'No hat')),
      Scene.Command.resolve(WriteSave, Message.CompletedWriteSave()),
      Scene.expect(lookOptionIn('Hat', 'No hat')).toHaveAttr(
        'aria-checked',
        'true',
      ),
      ...closeLook(),
    ),
  )
})

describe('NEW badges', () => {
  const reached = modifyFields(homeAfterRead, {
    rank: () => ({ ...noRank, earnedPoints: pointsForRank(16) }),
    seenUnlocks: () => ['hat:PartyHat'],
  })

  const newBadge = (groupName: string, name: string) =>
    Scene.within(lookOptionIn(groupName, name), Scene.selector('.look-new'))

  it.effect(
    'the MORE button pips the Character card until the Look tab opens',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(reached),
        measureSurface,
        Scene.expect(
          Scene.selector('.manor-pip[data-card="Character"]'),
        ).toExist(),
        ...openLook(),
        Scene.expect(
          Scene.selector('.manor-pip[data-card="Character"]'),
        ).toBeAbsent(),
        Scene.Command.resolve(WriteSave, Message.CompletedWriteSave()),
        Scene.expect(
          Scene.within(
            Scene.role('tab', { name: 'Look' }),
            Scene.selector('.new-pip'),
          ),
        ).toBeAbsent(),
      ),
  )

  it.effect(
    'opening the Look tab shows the badge on what was unlocked, once',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(reached),
        measureSurface,
        ...openLook(),
        Scene.Command.resolve(WriteSave, Message.CompletedWriteSave()),
        ...openLookSection('Outfit'),
        Scene.expect(newBadge('Outfit color', 'Gold')).toExist(),
        Scene.expect(newBadge('Outfit color', 'Blue')).toBeAbsent(),
        Scene.expect(newBadge('Outfit color', 'Glow')).toBeAbsent(),
        ...openLookSection('Gear'),
        Scene.expect(newBadge('Hat', 'Bucket Hat')).toExist(),
        Scene.expect(newBadge('Hat', 'Party Hat')).toBeAbsent(),
        Scene.expect(newBadge('Hat', 'Fez')).toBeAbsent(),
        ...closeLook(),
        ...openLook(),
        ...openLookSection('Outfit'),
        Scene.expect(newBadge('Outfit color', 'Gold')).toBeAbsent(),
        ...openLookSection('Gear'),
        Scene.expect(newBadge('Hat', 'Bucket Hat')).toBeAbsent(),
      ),
  )
})

describe('a NEW badge', () => {
  const reachedGold = modifyFields(homeAfterRead, {
    rank: () => ({ ...noRank, earnedPoints: pointsForRank(16) }),
    seenUnlocks: () => ['hat:PartyHat'],
  })

  it.effect('goes at once when its look is picked, the others stay', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(reachedGold),
      measureSurface,
      ...openLook(),
      Scene.Command.resolve(WriteSave, Message.CompletedWriteSave()),
      ...openLookSection('Outfit'),
      Scene.expect(
        Scene.within(
          lookOptionIn('Outfit color', 'Gold'),
          Scene.selector('.look-new'),
        ),
      ).toExist(),
      Scene.click(lookOptionIn('Outfit color', 'Gold')),
      Scene.Command.resolve(WriteSave, Message.CompletedWriteSave()),
      Scene.expect(
        Scene.within(
          lookOptionIn('Outfit color', 'Gold'),
          Scene.selector('.look-new'),
        ),
      ).toBeAbsent(),
      Scene.expect(lookOptionIn('Outfit color', 'Gold')).toHaveAttr(
        'aria-checked',
        'true',
      ),
      ...openLookSection('Gear'),
      Scene.expect(
        Scene.within(
          lookOptionIn('Hat', 'Bucket Hat'),
          Scene.selector('.look-new'),
        ),
      ).toExist(),
    ),
  )
})

describe('the sections', () => {
  it.effect('there are four, and the Gear one holds the hat and the gun', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(closet),
      measureSurface,
      ...openLook(),
      ...Array.map(['Body', 'Hair', 'Outfit', 'Gear'], name =>
        Scene.expect(lookSection(name)).toExist(),
      ),
      Scene.expect(lookGroup('Hat')).toBeAbsent(),
      ...openLookSection('Gear'),
      Scene.expect(lookGroup('Hat')).toExist(),
      Scene.expect(lookGroup('Gun skin')).toExist(),
    ),
  )
})
