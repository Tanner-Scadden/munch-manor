import { Array, Effect } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it } from '@effect/vitest'

import type { Arsenal, Model } from '../../../app/model'
import { saveOf } from '../../../platform/save'
import { FIXED_STEP_MS } from '../../../shared/constants'
import { gunAt, holdingSecond } from '../../../test/arsenals'
import { killShot } from '../../../test/model.fixture'
import {
  changeModel,
  checkModel,
  hintIds,
  storyOf,
  tick,
} from '../../../test/testing'
import { modifyFocus } from '../../../world/party/party'
import { settledLessons } from '../../../world/run/lessons'
import { Lesson } from '../../../world/schema/worldSchema'

const hintPending = (arsenal: Arsenal): Model =>
  UiStruct.evolve(killShot(arsenal, 'Smg'), {
    lessons: () => ({ ...settledLessons, gunLevel: Lesson.Pending() }),
  })

const isHintUp = (current: Model): boolean =>
  Array.contains(hintIds(current), 'GunLevel')

describe('the gun level hint', () => {
  it.effect('shows once the gun in hand is halfway to its first level', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(hintPending(holdingSecond(gunAt('Smg', 0, 19))))
      s.pipe(
        checkModel(current => {
          expect(isHintUp(current)).toBe(false)
        }),
        tick(FIXED_STEP_MS),
        checkModel(current => {
          expect(isHintUp(current)).toBe(true)
        }),
      )
    }),
  )

  it.effect(
    'the first level up learns it, saves it, and it never shows again',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(
          hintPending(holdingSecond(gunAt('Smg', 0, 39))),
        )
        s.pipe(
          checkModel(current => {
            expect(isHintUp(current)).toBe(true)
          }),
          tick(FIXED_STEP_MS),
          checkModel(current => {
            expect(Lesson.isAnyOf(['Learned'])(current.lessons.gunLevel)).toBe(
              true,
            )
            expect(saveOf(current).onboarding.lessons.gunLevel).toBe('Learned')
            expect(isHintUp(current)).toBe(false)
          }),
          changeModel(current =>
            modifyFocus(current, {
              player: player =>
                UiStruct.evolve(player, {
                  arsenal: () => holdingSecond(gunAt('Rifle', 0, 30)),
                }),
            }),
          ),
          checkModel(current => {
            expect(isHintUp(current)).toBe(false)
          }),
        )
      }),
  )
})
