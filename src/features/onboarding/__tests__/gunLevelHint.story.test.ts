import { Array } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import type { Arsenal, Model } from '../../../app/model'
import { saveOf } from '../../../platform/save'
import { FIXED_STEP_MS } from '../../../shared/constants'
import { gunAt, holdingSecond } from '../../../test/arsenals'
import { killShot } from '../../../test/model.fixture'
import { APPLICATION, changeModel, hintIds, tick } from '../../../test/testing'
import { modifyFocus } from '../../../world/party/party'
import { settledLessons } from '../../../world/run/lessons'
import { Lesson } from '../../../world/schema/worldSchema'

// The gun level hint (src/features/onboarding/onboarding.ts): halfway to a
// gun's first level, a skull, the gun, and an up arrow say kills level it.
// The first level up learns it for good, saved with the other lessons.

const hintPending = (arsenal: Arsenal): Model =>
  modifyFields(killShot(arsenal, 'Smg'), {
    lessons: () => ({ ...settledLessons, gunLevel: Lesson.Pending() }),
  })

const isHintUp = (current: Model): boolean =>
  Array.contains(hintIds(current), 'GunLevel')

describe('the gun level hint', () => {
  it.effect('shows once the gun in hand is halfway to its first level', () =>
    Story.story(
      APPLICATION,
      Story.given(hintPending(holdingSecond(gunAt('Smg', 0, 19)))),
      Story.model(current => {
        expect(isHintUp(current)).toBe(false)
      }),
      tick(FIXED_STEP_MS),
      Story.model(current => {
        expect(isHintUp(current)).toBe(true)
      }),
    ),
  )

  it.effect(
    'the first level up learns it, saves it, and it never shows again',
    () =>
      Story.story(
        APPLICATION,
        Story.given(hintPending(holdingSecond(gunAt('Smg', 0, 39)))),
        Story.model(current => {
          expect(isHintUp(current)).toBe(true)
        }),
        tick(FIXED_STEP_MS),
        Story.model(current => {
          expect(Lesson.isAnyOf(['Learned'])(current.lessons.gunLevel)).toBe(
            true,
          )
          expect(saveOf(current).onboarding.lessons.gunLevel).toBe('Learned')
          expect(isHintUp(current)).toBe(false)
        }),
        changeModel(current =>
          modifyFocus(current, {
            player: player =>
              modifyFields(player, {
                arsenal: () => holdingSecond(gunAt('Rifle', 0, 30)),
              }),
          }),
        ),
        Story.model(current => {
          expect(isHintUp(current)).toBe(false)
        }),
      ),
  )
})
