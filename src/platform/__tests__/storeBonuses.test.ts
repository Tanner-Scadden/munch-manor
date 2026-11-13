// @vitest-environment happy-dom
import { Effect, Option } from 'effect'

import { describe, expect, it } from '@effect/vitest'

import {
  legacySave,
  linkedPair,
  synced,
  until,
  write,
} from '../../test/store.fixture'
import { noRank } from '../../world/heroes/rank'
import { changesBetween } from '../playerSync'
import { type PlayerSave } from '../save'

// The Bones bonuses through sync (src/platform/playerScope.ts): two linked
// devices that both claim the same bonus offline are paid it once, while
// the runs themselves both count.

const TODAY = '2026-11-12'

// NOTE: a run that earned `bones` and, with them, claimed the bonuses in
// `bonuses`.
const afterRun = (
  bones: number,
  bonuses: PlayerSave['bonuses'],
): PlayerSave => ({
  ...legacySave,
  rank: { ...noRank, earnedPoints: 60, earnedBones: bones },
  bonuses,
})

describe('the Bones bonuses in sync', () => {
  it('a doubled run goes up as its run and its double', () => {
    expect(
      changesBetween(
        legacySave,
        afterRun(12, { doubledDay: TODAY, escapedOn: [] }),
      ),
    ).toEqual([
      { _tag: 'EarnedRank', points: 60, bones: 6 },
      { _tag: 'DoubledFirstRun', day: TODAY, bones: 6 },
    ])
  })

  it.effect('two devices doubling the same day are paid one double', () =>
    synced(
      Effect.gen(function* () {
        const { phone, laptop } = yield* linkedPair
        const doubled = afterRun(12, { doubledDay: TODAY, escapedOn: [] })
        yield* write(phone, legacySave, doubled)
        yield* write(laptop, legacySave, doubled)
        // NOTE: both runs' 6 Bones, and one double of 6.
        const isPaidOnce = (maybeSave: Option.Option<PlayerSave>) =>
          Option.exists(
            maybeSave,
            save =>
              save.rank.earnedBones === 18 &&
              save.rank.earnedPoints === 120 &&
              save.bonuses.doubledDay === TODAY,
          )
        const onPhone = yield* until(phone.load, isPaidOnce)
        const onLaptop = yield* until(laptop.load, isPaidOnce)
        expect(isPaidOnce(onPhone)).toBe(true)
        expect(isPaidOnce(onLaptop)).toBe(true)
      }),
    ),
  )

  it.effect('two devices escaping first on Normal are paid one 50', () =>
    synced(
      Effect.gen(function* () {
        const { phone, laptop } = yield* linkedPair
        const escaped = afterRun(6 + 50, {
          doubledDay: null,
          escapedOn: ['Normal'],
        })
        yield* write(phone, legacySave, escaped)
        yield* write(laptop, legacySave, escaped)
        const isPaidOnce = (maybeSave: Option.Option<PlayerSave>) =>
          Option.exists(
            maybeSave,
            save =>
              save.rank.earnedBones === 6 + 6 + 50 &&
              save.bonuses.escapedOn.length === 1,
          )
        const onPhone = yield* until(phone.load, isPaidOnce)
        const onLaptop = yield* until(laptop.load, isPaidOnce)
        expect(isPaidOnce(onPhone)).toBe(true)
        expect(isPaidOnce(onLaptop)).toBe(true)
      }),
    ),
  )
})
