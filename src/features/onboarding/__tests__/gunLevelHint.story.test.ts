import { Array, Effect } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it } from '@effect/vitest'

import type { Arsenal, Model } from '#app/model.ts'
import { saveOf } from '#platform/save/save.ts'
import { FIXED_STEP_MS } from '#shared/constants.ts'
import { gunAt, holdingSecond } from '#test/arsenals.ts'
import { killShot } from '#test/model.fixture.ts'
import {
  changeModel,
  checkModel,
  hintIds,
  storyOf,
  tick,
} from '#test/testing.ts'
import { modifyFocus } from '#world/party/party.ts'
import { settledLessons } from '#world/run/lessons.ts'
import { Lesson } from '#world/schema/worldSchema.ts'

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
