import { Array } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it } from '@effect/vitest'

import { BreakClock, type Model, type Phase } from '#app/model.ts'
import {
  WAVE_2_BREAK,
  breakBefore,
  pastTimedBreaks,
  readyModel,
} from '#test/model.fixture.ts'
import { checkModel, modelAfter, steps, tap } from '#test/testing.ts'
import { readyPointsFor } from '#world/heroes/rank.ts'

const onBreak = (phase: Phase): Model =>
  UiStruct.evolve(pastTimedBreaks(readyModel), { phase: () => phase })

const rushes = (model: Model) =>
  Array.filter(model.frameEvents, event => event._tag === 'RushedIn')

describe('READY before the clock', () => {
  it('pays a point for every 5 seconds left', () => {
    expect(readyPointsFor(30_000)).toBe(6)
    expect(readyPointsFor(14_999)).toBe(2)
    expect(readyPointsFor(4_999)).toBe(0)
    expect(readyPointsFor(-1)).toBe(0)
  })

  it.effect('15 seconds left pays 3 rank points, with a pop', () =>
    modelAfter(
      onBreak(breakBefore(4)),
      steps(
        tap('Enter'),
        checkModel(current => {
          expect(current.phase._tag).toBe('Wave')
          expect(current.stats.readyPoints).toBe(3)
          expect(Array.map(rushes(current), ({ points }) => points)).toEqual([
            3,
          ])
        }),
      ),
    ),
  )

  it.effect('the open break has no clock to beat and pays nothing', () =>
    modelAfter(
      onBreak(
        UiStruct.evolve(WAVE_2_BREAK, {
          clock: () => BreakClock.Waiting({ elapsedMs: 0 }),
        }),
      ),
      steps(
        tap('Enter'),
        checkModel(current => {
          expect(current.phase._tag).toBe('Wave')
          expect(current.stats.readyPoints).toBe(0)
          expect(rushes(current)).toEqual([])
        }),
      ),
    ),
  )
})
