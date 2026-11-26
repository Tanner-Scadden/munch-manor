import { Array, Effect, Option } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it, test } from '@effect/vitest'

import { CaseState, Feat, type Model } from '#app/model.ts'
import { featCountOf } from '#render/featLockView.ts'
import { FIXED_STEP_MS } from '#shared/constants.ts'
import { AT_CASE, atCase, playingModel } from '#test/model.fixture.ts'
import { checkModel, holdFire, storyOf, tick, zombieOf } from '#test/testing.ts'
import { focusOf } from '#world/party/party.ts'

const countOn = (model: Model): Option.Option<string> =>
  Option.flatMap(Array.head(model.cases), ({ feat }) =>
    featCountOf(feat, focusOf(model).feats),
  )

const threeKillCase = UiStruct.evolve(
  atCase(playingModel, 'Shotgun', CaseState.Locked(), Feat.Kills({ count: 3 })),
  {
    zombies: () => [
      zombieOf('Shambler', 901, AT_CASE.x + 12, AT_CASE.y, {
        hp: 1,
        speed: 0,
      }),
    ],
  },
)

describe('the case lock count', () => {
  it.effect('a kill moves the count on the lock', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(threeKillCase)
      s.pipe(
        checkModel(current => {
          expect(countOn(current)).toEqual(Option.some('0/3'))
        }),
        holdFire,
        tick(FIXED_STEP_MS),
        checkModel(current => {
          expect(countOn(current)).toEqual(Option.some('1/3'))
        }),
      )
    }),
  )

  test('a feat done once shows no count, only its ring', () => {
    expect(featCountOf(Feat.LitFire(), focusOf(threeKillCase).feats)).toEqual(
      Option.none(),
    )
  })
})
