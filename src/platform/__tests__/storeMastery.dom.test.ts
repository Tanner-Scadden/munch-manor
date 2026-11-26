import { Effect, Option } from 'effect'

import { describe, expect, it } from '@effect/vitest'

import { changesBetween } from '#platform/playerSync.ts'
import { type PlayerSave } from '#platform/save.ts'
import {
  type SavedMastery,
  mergeMastery,
  noMastery,
} from '#shared/masteryData.ts'
import {
  legacySave,
  linkedPair,
  synced,
  until,
  write,
} from '#test/store.fixture.ts'

const withMastery = (mastery: SavedMastery): PlayerSave => ({
  ...legacySave,
  mastery,
})

describe('mastery in sync', () => {
  it('a payout goes up as the increment it added', () => {
    expect(
      changesBetween(
        withMastery({ heroes: { You: 60 }, guns: { Pistol: 10 } }),
        withMastery({ heroes: { You: 90 }, guns: { Pistol: 10, Smg: 4 } }),
      ),
    ).toEqual([
      {
        _tag: 'GainedMastery',
        added: { heroes: { You: 30 }, guns: { Smg: 4 } },
      },
    ])
    expect(
      changesBetween(withMastery(noMastery), withMastery(noMastery)),
    ).toEqual([])
  })

  it('a synced save keeps the larger count of each track', () => {
    expect(
      mergeMastery(
        { heroes: { You: 60, Medic: 10 }, guns: { Pistol: 900 } },
        { heroes: { You: 40 }, guns: { Pistol: 1200, Smg: 3 } },
      ),
    ).toEqual({
      heroes: { You: 60, Medic: 10 },
      guns: { Pistol: 1200, Smg: 3 },
    })
  })

  it.effect('two devices playing apart both end on the sum', () =>
    synced(
      Effect.gen(function* () {
        const { phone, laptop } = yield* linkedPair
        yield* write(
          phone,
          legacySave,
          withMastery({ heroes: { You: 60 }, guns: { Pistol: 600 } }),
        )
        yield* write(
          laptop,
          legacySave,
          withMastery({ heroes: { You: 50 }, guns: { Pistol: 500 } }),
        )
        const isSettled = (maybeSave: Option.Option<PlayerSave>) =>
          Option.exists(
            maybeSave,
            save =>
              save.mastery.heroes['You'] === 110 &&
              save.mastery.guns['Pistol'] === 1100,
          )
        const onPhone = yield* until(phone.load, isSettled)
        const onLaptop = yield* until(laptop.load, isSettled)
        expect(isSettled(onPhone)).toBe(true)
        expect(isSettled(onLaptop)).toBe(true)
      }),
    ),
  )
})
