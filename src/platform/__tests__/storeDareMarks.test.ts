// @vitest-environment happy-dom
import { Effect, Option } from 'effect'

import { describe, expect, it } from '@effect/vitest'

import {
  type SavedDareMarks,
  mergeDareMarks,
  noDareMarks,
} from '../../shared/dareMarkData'
import {
  legacySave,
  linkedPair,
  synced,
  until,
  write,
} from '../../test/store.fixture'
import { changesBetween } from '../playerSync'
import { type PlayerSave } from '../save'

// The dare ladder through sync (src/platform/dareMarkScope.ts): a mark
// opened goes up as the mark itself, and the scope keeps the higher of what
// it has, so two devices that climb apart both end on each difficulty's
// best.

const withMarks = (dareMarks: SavedDareMarks): PlayerSave => ({
  ...legacySave,
  dareMarks,
})

describe('the dare ladder in sync', () => {
  it('a mark opened goes up as that mark, one difficulty at a time', () => {
    expect(
      changesBetween(
        withMarks(noDareMarks),
        withMarks({ ...noDareMarks, Normal: 2, Hard: 1 }),
      ),
    ).toEqual([
      { _tag: 'ClimbedDareLadder', difficulty: 'Normal', mark: 2 },
      { _tag: 'ClimbedDareLadder', difficulty: 'Hard', mark: 1 },
    ])
    expect(
      changesBetween(
        withMarks({ ...noDareMarks, Normal: 3 }),
        withMarks({ ...noDareMarks, Normal: 3 }),
      ),
    ).toEqual([])
  })

  it('a synced save keeps the higher mark on each difficulty', () => {
    expect(
      mergeDareMarks(
        { Easy: 4, Normal: 1, Hard: 0, Nightmare: 0 },
        { Easy: 2, Normal: 5, Hard: 1, Nightmare: 0 },
      ),
    ).toEqual({ Easy: 4, Normal: 5, Hard: 1, Nightmare: 0 })
  })

  it.effect('two devices climbing apart both end on the higher mark', () =>
    synced(
      Effect.gen(function* () {
        const { phone, laptop } = yield* linkedPair
        yield* write(
          phone,
          legacySave,
          withMarks({ ...noDareMarks, Normal: 5, Easy: 1 }),
        )
        yield* write(
          laptop,
          legacySave,
          withMarks({ ...noDareMarks, Normal: 3, Hard: 2 }),
        )
        const isSettled = (maybeSave: Option.Option<PlayerSave>) =>
          Option.exists(
            maybeSave,
            save =>
              save.dareMarks.Normal === 5 &&
              save.dareMarks.Easy === 1 &&
              save.dareMarks.Hard === 2,
          )
        const onPhone = yield* until(phone.load, isSettled)
        const onLaptop = yield* until(laptop.load, isSettled)
        expect(isSettled(onPhone)).toBe(true)
        expect(isSettled(onLaptop)).toBe(true)
      }),
    ),
  )
})
