import { Effect } from 'effect'

import { UiStruct } from '@effect/ui'
import { HtmlLocator } from '@effect/ui/html/testing'
import { Locator } from '@effect/ui/testing'
import { describe, it } from '@effect/vitest'

import { PROFILE_DIALOG_ID } from '../../../domain/clientSchema'
import { homeAfterRead } from '../../../test/model.fixture'
import {
  byClass,
  expectAttr,
  expectStyle,
  measureSurface,
  profileDialog,
  settingsButton,
  showDialog,
} from '../../../test/sceneTesting'
import { type SceneStep, sceneOf, steps } from '../../../test/testing'
import { pointsForRank } from '../../../world/heroes/rank'

// The rank in the menus: the badge and number on the home menu's player,
// and the Profile's plate (src/ui/rankBadgeView.ts).

// NOTE: 85 points is rank 2 with 35 of its 70 done, and 16 Bones. Rank
// 3 opens the Handyman.
const ranked = UiStruct.evolve(homeAfterRead, {
  rank: rank => ({ ...rank, earnedPoints: 85, earnedBones: 16 }),
})

const onHero = (name: string): Locator.Locator =>
  Locator.inside(byClass('home-hero'), byClass(name))

// NOTE: the Profile opened from the gear, its Dialog shown.
const openProfile: SceneStep = steps(
  s => s.click(settingsButton),
  showDialog(PROFILE_DIALOG_ID),
)

describe('the rank badge', () => {
  it.effect('sits under the player on the home menu with the rank number', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(ranked)
      s.pipe(
        measureSurface,
        expectAttr(onHero('rank-chip'), 'data-tier', 'Wood'),
        expectAttr(onHero('rank-next'), 'data-gift', 'Hero'),
      )
        .expect(onHero('rank-chip'))
        .toExist()
        .expect(onHero('rank-number'))
        .toHaveText('2')
    }),
  )

  it.effect('shows a Bones purse next with its count', () =>
    Effect.gen(function* () {
      const twenty = UiStruct.evolve(homeAfterRead, {
        rank: rank => ({ ...rank, earnedPoints: pointsForRank(20) }),
      })
      const s = yield* sceneOf(twenty)
      s.pipe(
        measureSurface,
        expectAttr(onHero('rank-next'), 'data-gift', 'Purse'),
      )
        .expect(onHero('rank-next-count'))
        .toHaveText('+15')
    }),
  )

  it.effect('changes its look every 10 ranks', () =>
    Effect.gen(function* () {
      const tin = UiStruct.evolve(homeAfterRead, {
        rank: rank => ({ ...rank, earnedPoints: 1500 }),
      })
      const s = yield* sceneOf(tin)
      s.pipe(
        measureSurface,
        expectAttr(onHero('rank-chip'), 'data-tier', 'Tin'),
      )
        .expect(onHero('rank-number'))
        .toHaveText('11')
    }),
  )

  it.effect('a new player is rank 1', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(homeAfterRead)
      s.pipe(measureSurface).expect(onHero('rank-number')).toHaveText('1')
    }),
  )
})

describe('the Profile rank plate', () => {
  it.effect('shows the rank, the bar to the next, and the Bones', () =>
    Effect.gen(function* () {
      const plate = HtmlLocator.role('group', {
        name: 'Rank 2, 35 of 70 points to the next. Rank 3 gives Handyman. 16 Bones.',
      })
      const onPlate = (name: string): Locator.Locator =>
        Locator.inside(plate, byClass(name))
      const s = yield* sceneOf(ranked)
      s.pipe(
        measureSurface,
        openProfile,
        expectAttr(onPlate('rank-next'), 'data-gift', 'Hero'),
        expectStyle(byClass('rank-bar-fill'), 'width', '50%'),
      )
        .expect(profileDialog)
        .toExist()
        .expect(onPlate('rank-number'))
        .toHaveText('2')
        .expect(onPlate('rank-bones-count'))
        .toHaveText('16')
        .expect(onPlate('rank-bar-fill'))
        .toHaveCount(1)
    }),
  )

  it.effect('counts the veteran grant and takes away spent Bones', () =>
    Effect.gen(function* () {
      const veteran = UiStruct.evolve(homeAfterRead, {
        rank: rank => ({
          ...rank,
          veteranPoints: 150,
          veteranBones: 30,
          earnedBones: 5,
          spentBones: 10,
        }),
      })
      const s = yield* sceneOf(veteran)
      s.pipe(measureSurface, openProfile)
        .expect(Locator.inside(byClass('profile-rank'), byClass('rank-number')))
        .toHaveText('3')
        .expect(byClass('rank-bones-count'))
        .toHaveText('25')
    }),
  )
})
