import { Array } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import { BreakClock, type Model, type Phase } from '../../../app/model'
import {
  WAVE_2_BREAK,
  breakBefore,
  pastTimedBreaks,
  readyModel,
} from '../../../test/model.fixture'
import { APPLICATION, tap } from '../../../test/testing'
import { readyPointsFor } from '../../heroes/rank'

const onBreak = (phase: Phase): Model =>
  modifyFields(pastTimedBreaks(readyModel), { phase: () => phase })

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
    Story.story(
      APPLICATION,
      Story.given(onBreak(breakBefore(4))),
      tap('Enter'),
      Story.model(current => {
        expect(current.phase._tag).toBe('Wave')
        expect(current.stats.readyPoints).toBe(3)
        expect(Array.map(rushes(current), ({ points }) => points)).toEqual([3])
      }),
    ),
  )

  it.effect('the open break has no clock to beat and pays nothing', () =>
    Story.story(
      APPLICATION,
      Story.given(
        onBreak(
          modifyFields(WAVE_2_BREAK, {
            clock: () => BreakClock.Waiting({ elapsedMs: 0 }),
          }),
        ),
      ),
      tap('Enter'),
      Story.model(current => {
        expect(current.phase._tag).toBe('Wave')
        expect(current.stats.readyPoints).toBe(0)
        expect(rushes(current)).toEqual([])
      }),
    ),
  )
})
