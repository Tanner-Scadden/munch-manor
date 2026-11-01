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
} from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'

import { Tabs } from '@foldkit/ui'

import { Message } from './message'
import type { Model } from './model'
import { homeAfterRead } from './model.fixture'
import { ProfileTabsBlock } from './profile'
import { noRank, pointsForRank } from './rank'
import {
  ROOT,
  emitPressedKey,
  measureSurface,
  showDialogInScene,
} from './testing'
import { FocusClosetCard } from './update/closet'
import { WriteSave } from './update/save'

// The Closet tab (src/closetView.ts): a card for every hat in one of four
// states, taps that wear and buy, and the arrow keys.

const closet: Model = modifyFields(homeAfterRead, {
  rank: () => ({
    ...noRank,
    earnedPoints: pointsForRank(5),
    earnedBones: 140,
    spentBones: 50,
  }),
  boughtHats: () => ['Fez'],
  appearance: look => ({ ...look, hat: 'Fez' }),
})

const openCloset = () => [
  emitPressedKey('KeyC'),
  ...showDialogInScene(),
  click(role('tab', { name: 'Closet' })),
  Command.resolve(
    Tabs.test.FocusTab({ id: 'profile-tabs', index: 1 }),
    ProfileTabsBlock.Message.CompletedFocusTab(),
  ),
]

const card = (hat: string) => selector(`#closet-card-${hat.toLowerCase()}`)

describe('the closet tab', () => {
  test('every hat is a card: worn, owned, for sale, or a locked gift', () => {
    scene(
      ROOT,
      given(closet),
      measureSurface,
      ...openCloset(),
      expectAll(all.selector('.closet-card')).toHaveCount(16),
      expect(card('Fez')).toHaveAttr('data-standing', 'Worn'),
      expect(card('Fez')).toHaveAttr('aria-pressed', 'true'),
      expect(card('PartyHat')).toHaveAttr('data-standing', 'Owned'),
      expect(card('PomBeanie')).toHaveAttr('data-standing', 'Owned'),
      expect(card('Colander')).toHaveAttr('data-standing', 'ForSale'),
      expect(card('PumpkinHead')).toHaveAttr('data-standing', 'ForSale'),
      expect(card('PropellerCap')).toHaveAttr('data-standing', 'Locked'),
      expect(card('TrafficCone')).toHaveAttr('data-standing', 'Locked'),
      expect(role('group', { name: 'Hats' })).toExist(),
      expect(selector('.closet-bones')).toExist(),
    )
  })

  test('a tap buys the hat for sale and wears it, and the balance drops', () => {
    scene(
      ROOT,
      given(closet),
      measureSurface,
      ...openCloset(),
      click(card('Colander')),
      Command.resolve(WriteSave, Message.CompletedWriteSave()),
      expect(card('Colander')).toHaveAttr('data-standing', 'Worn'),
      expect(card('Fez')).toHaveAttr('data-standing', 'Owned'),
      expect(card('Colander')).toHaveAttr('data-cue', 'Bought'),
      expect(selector('.closet-bones .rank-bones-count')).toHaveText('50'),
    )
  })

  test('a hat the Bones do not cover shakes its price and stays for sale', () => {
    scene(
      ROOT,
      given(
        modifyFields(closet, {
          rank: rank => ({ ...rank, earnedBones: 60 }),
        }),
      ),
      measureSurface,
      ...openCloset(),
      click(card('Plunger')),
      expect(card('Plunger')).toHaveAttr('data-standing', 'ForSale'),
      expect(card('Plunger')).toHaveAttr('data-cue', 'Short'),
      expect(selector('.closet-bones .rank-bones-count')).toHaveText('10'),
    )
  })

  test('the arrow keys move between the cards, across and down the grid', () => {
    scene(
      ROOT,
      given(closet),
      measureSurface,
      ...openCloset(),
      keydown(card('PartyHat'), 'ArrowRight'),
      Command.resolve(
        FocusClosetCard({ hat: 'BucketHat' }),
        Message.CompletedFocusClosetCard(),
      ),
      keydown(card('BucketHat'), 'ArrowDown'),
      Command.resolve(
        FocusClosetCard({ hat: 'TrafficCone' }),
        Message.CompletedFocusClosetCard(),
      ),
      keydown(card('PartyHat'), 'ArrowLeft'),
      Command.resolve(
        FocusClosetCard({ hat: 'PumpkinHead' }),
        Message.CompletedFocusClosetCard(),
      ),
    )
  })
})
