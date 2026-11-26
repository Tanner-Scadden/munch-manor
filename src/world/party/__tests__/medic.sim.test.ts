import { Option } from 'effect'

import { describe, expect, it } from '@effect/vitest'

import type { Model } from '#app/model.ts'
import { FIXED_STEP_MS } from '#shared/constants.ts'
import {
  crewInWave,
  pipeline,
  placeSeat,
  untouchableSeat,
} from '#test/model.fixture.ts'
import { checkModel, modelAfter, steps, ticks } from '#test/testing.ts'
import { maybePlayerAt } from '#world/party/party.ts'

const TICK_MS = FIXED_STEP_MS

const lifeOf = (current: Model): string =>
  Option.getOrThrow(maybePlayerAt(current, 0)).seat.life._tag

describe('bleeding out', () => {
  it.effect('a downed player alone lasts 20 s', () => {
    const bleedTicks = Math.ceil(20_000 / TICK_MS)
    return modelAfter(
      pipeline(
        placeSeat(0, 60, 104, 0),
        placeSeat(1, 240, 104),
        untouchableSeat(1),
      )(crewInWave(2)),
      steps(
        ticks(bleedTicks - 2, TICK_MS),
        checkModel(current => {
          expect(lifeOf(current)).toBe('Downed')
          expect(current.phase._tag).toBe('Wave')
        }),
        ticks(4, TICK_MS),
        checkModel(current => {
          expect(lifeOf(current)).toBe('BledOut')
          expect(current.phase._tag).toBe('Wave')
        }),
      ),
    )
  })
})
