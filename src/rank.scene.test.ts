import {
  all,
  click,
  expect,
  expectAll,
  given,
  inside,
  role,
  scene,
  selector,
} from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'

import { homeAfterRead } from './model.fixture'
import {
  ROOT,
  measureSurface,
  profileDialog,
  settingsButton,
  showDialogInScene,
} from './testing'

// The rank in the menus: the badge and number on the home menu's player,
// and the Profile's plate (src/rankBadgeView.ts).

// NOTE: 162 points is rank 2 with 62 of its 125 done, and 16 Bones.
const ranked = modifyFields(homeAfterRead, {
  rank: rank => ({ ...rank, earnedPoints: 162, earnedBones: 16 }),
})

describe('the rank badge', () => {
  test('sits under the player on the home menu with the rank number', () => {
    scene(
      ROOT,
      given(ranked),
      measureSurface,
      expect(selector('.home-hero .rank-chip')).toExist(),
      expect(selector('.home-hero .rank-number')).toHaveText('2'),
      expect(selector('.home-hero .rank-chip')).toHaveAttr('data-tier', 'Wood'),
    )
  })

  test('changes its look every 10 ranks', () => {
    const tin = modifyFields(homeAfterRead, {
      rank: rank => ({ ...rank, earnedPoints: 2200 }),
    })
    scene(
      ROOT,
      given(tin),
      measureSurface,
      expect(selector('.home-hero .rank-number')).toHaveText('11'),
      expect(selector('.home-hero .rank-chip')).toHaveAttr('data-tier', 'Tin'),
    )
  })

  test('a new player is rank 1', () => {
    scene(
      ROOT,
      given(homeAfterRead),
      measureSurface,
      expect(selector('.home-hero .rank-number')).toHaveText('1'),
    )
  })
})

describe('the Profile rank plate', () => {
  test('shows the rank, the bar to the next, and the Bones', () => {
    scene(
      ROOT,
      given(ranked),
      measureSurface,
      click(settingsButton),
      ...showDialogInScene(),
      expect(profileDialog).toExist(),
      inside(
        role('group', {
          name: 'Rank 2, 62 of 125 points to the next. 16 Bones.',
        }),
        expect(selector('.rank-number')).toHaveText('2'),
        expect(selector('.rank-bones-count')).toHaveText('16'),
        expectAll(all.selector('.rank-bar-fill')).toHaveCount(1),
      ),
      expect(selector('.rank-bar-fill')).toHaveStyle('width', '50%'),
    )
  })

  test('counts the veteran grant and takes away spent Bones', () => {
    const veteran = modifyFields(homeAfterRead, {
      rank: rank => ({
        ...rank,
        veteranPoints: 300,
        veteranBones: 30,
        earnedBones: 5,
        spentBones: 10,
      }),
    })
    scene(
      ROOT,
      given(veteran),
      measureSurface,
      click(settingsButton),
      ...showDialogInScene(),
      expect(selector('.profile-rank .rank-number')).toHaveText('3'),
      expect(selector('.rank-bones-count')).toHaveText('25'),
    )
  })
})
