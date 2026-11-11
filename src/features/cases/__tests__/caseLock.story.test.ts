import { Array, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it, test } from '@effect/vitest'

import { CaseState, Feat, type Model } from '../../../app/model'
import { featCountOf } from '../../../render/featLockView'
import { FIXED_STEP_MS } from '../../../shared/constants'
import { AT_CASE, atCase, playingModel } from '../../../test/model.fixture'
import { APPLICATION, holdFire, tick, zombieOf } from '../../../test/testing'
import { focusOf } from '../../../world/party/party'

// The count on a display case's lock (src/render/featLockView.ts), read off
// the focused seat's own feats: how far the player has gone toward the feat
// that opens it.

// NOTE: the case's count as the focused player reads it.
const countOn = (model: Model): Option.Option<string> =>
  Option.flatMap(Array.head(model.cases), ({ feat }) =>
    featCountOf(feat, focusOf(model).feats),
  )

// NOTE: a 1-hp Groaner a step east of the player at a case asking 3 kills.
const threeKillCase = modifyFields(
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
    Story.story(
      APPLICATION,
      Story.given(threeKillCase),
      Story.model(current => {
        expect(countOn(current)).toEqual(Option.some('0/3'))
      }),
      holdFire,
      tick(FIXED_STEP_MS),
      Story.model(current => {
        expect(countOn(current)).toEqual(Option.some('1/3'))
      }),
    ),
  )

  test('a feat done once shows no count, only its ring', () => {
    expect(featCountOf(Feat.LitFire(), focusOf(threeKillCase).feats)).toEqual(
      Option.none(),
    )
  })
})
