import { Option } from 'effect'
import { given, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'

import { FIXED_STEP_MS } from './constants'
import type { Model } from './model'
import {
  crewInWave,
  pipeline,
  placeSeat,
  untouchableSeat,
} from './model.fixture'
import { maybePlayerAt } from './party'
import { update } from './pureApp'
import { ticks } from './testing'

// A downed player's whole bleed, played out (src/medic.story.test.ts has
// the shout): 20 s since the owner doubled it on 2026-11-02, with a
// teammate no zombie can reach keeping the run going.

const TICK_MS = FIXED_STEP_MS

const lifeOf = (current: Model): string =>
  Option.getOrThrow(maybePlayerAt(current, 0)).seat.life._tag

describe('bleeding out', () => {
  // NOTE: on no hearts, the lead falls on the first tick and bleeds from
  // the next.
  test('a downed player alone lasts 20 s', () => {
    const bleedTicks = Math.ceil(20_000 / TICK_MS)
    story(
      update,
      given(
        pipeline(
          placeSeat(0, 60, 104, 0),
          placeSeat(1, 240, 104),
          untouchableSeat(1),
        )(crewInWave(2)),
      ),
      ...ticks(bleedTicks - 2, TICK_MS),
      model(current => {
        expect(lifeOf(current)).toBe('Downed')
        expect(current.phase._tag).toBe('Wave')
      }),
      ...ticks(4, TICK_MS),
      model(current => {
        expect(lifeOf(current)).toBe('BledOut')
        expect(current.phase._tag).toBe('Wave')
      }),
    )
  })
})
