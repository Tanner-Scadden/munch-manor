import { Scene } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, it } from '@effect/vitest'

import { homeAfterRead } from '../../../test/model.fixture'
import {
  APPLICATION,
  measureSurface,
  profileDialog,
  settingsButton,
  showDialogInScene,
} from '../../../test/testing'

// The rank in the menus: the badge and number on the home menu's player,
// and the Profile's plate (src/features/rank/rankBadgeView.ts).

// NOTE: 162 points is rank 2 with 62 of its 125 done, and 16 Bones.
const ranked = modifyFields(homeAfterRead, {
  rank: rank => ({ ...rank, earnedPoints: 162, earnedBones: 16 }),
})

describe('the rank badge', () => {
  it.effect('sits under the player on the home menu with the rank number', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(ranked),
      measureSurface,
      Scene.expect(Scene.selector('.home-hero .rank-chip')).toExist(),
      Scene.expect(Scene.selector('.home-hero .rank-number')).toHaveText('2'),
      Scene.expect(Scene.selector('.home-hero .rank-chip')).toHaveAttr(
        'data-tier',
        'Wood',
      ),
    ),
  )

  it.effect('changes its look every 10 ranks', () => {
    const tin = modifyFields(homeAfterRead, {
      rank: rank => ({ ...rank, earnedPoints: 2200 }),
    })
    return Scene.scene(
      APPLICATION,
      Scene.given(tin),
      measureSurface,
      Scene.expect(Scene.selector('.home-hero .rank-number')).toHaveText('11'),
      Scene.expect(Scene.selector('.home-hero .rank-chip')).toHaveAttr(
        'data-tier',
        'Tin',
      ),
    )
  })

  it.effect('a new player is rank 1', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(homeAfterRead),
      measureSurface,
      Scene.expect(Scene.selector('.home-hero .rank-number')).toHaveText('1'),
    ),
  )
})

describe('the Profile rank plate', () => {
  it.effect('shows the rank, the bar to the next, and the Bones', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(ranked),
      measureSurface,
      Scene.click(settingsButton),
      ...showDialogInScene(),
      Scene.expect(profileDialog).toExist(),
      Scene.inside(
        Scene.role('group', {
          name: 'Rank 2, 62 of 125 points to the next. 16 Bones.',
        }),
        Scene.expect(Scene.selector('.rank-number')).toHaveText('2'),
        Scene.expect(Scene.selector('.rank-bones-count')).toHaveText('16'),
        Scene.expectAll(Scene.all.selector('.rank-bar-fill')).toHaveCount(1),
      ),
      Scene.expect(Scene.selector('.rank-bar-fill')).toHaveStyle(
        'width',
        '50%',
      ),
    ),
  )

  it.effect('counts the veteran grant and takes away spent Bones', () => {
    const veteran = modifyFields(homeAfterRead, {
      rank: rank => ({
        ...rank,
        veteranPoints: 300,
        veteranBones: 30,
        earnedBones: 5,
        spentBones: 10,
      }),
    })
    return Scene.scene(
      APPLICATION,
      Scene.given(veteran),
      measureSurface,
      Scene.click(settingsButton),
      ...showDialogInScene(),
      Scene.expect(Scene.selector('.profile-rank .rank-number')).toHaveText(
        '3',
      ),
      Scene.expect(Scene.selector('.rank-bones-count')).toHaveText('25'),
    )
  })
})
