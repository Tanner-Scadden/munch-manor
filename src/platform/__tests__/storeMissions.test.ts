// @vitest-environment happy-dom
import { Effect, Option } from 'effect'

import { describe, expect, it } from '@effect/vitest'

import {
  ALL_THREE_BONES,
  type SavedMissions,
  mergeMissions,
  noMissions,
} from '../../shared/missionData'
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

// The daily missions through sync (src/platform/playerScope.ts): progress
// goes up as increments, so two devices' runs both count; a mission's
// Bones and the day's bonus are paid once however many devices claim them.

const TODAY = '2026-11-12'
const TOMORROW = '2026-11-13'

const onToday = (missions: Partial<SavedMissions>): SavedMissions => ({
  ...noMissions,
  day: TODAY,
  ...missions,
})

const afterRun = (missions: SavedMissions, bones: number): PlayerSave => ({
  ...legacySave,
  rank: { ...noRank, earnedBones: bones },
  missions,
})

describe('merging two records', () => {
  it('keeps the larger count, both claims, the first reroll, and co-op', () => {
    expect(
      mergeMissions(
        onToday({
          progress: { SplatZombies: 40, OpenCellar: 1 },
          claimed: ['OpenCellar'],
          reroll: { slot: 2, mission: 'SplatZombies' },
        }),
        onToday({
          progress: { SplatZombies: 90 },
          reroll: { slot: 0, mission: 'PullFridge' },
          stampedDays: ['2026-11-01'],
          hasPlayedCoop: true,
        }),
      ),
    ).toEqual(
      onToday({
        progress: { SplatZombies: 90, OpenCellar: 1 },
        claimed: ['OpenCellar'],
        reroll: { slot: 2, mission: 'SplatZombies' },
        stampedDays: ['2026-11-01'],
        hasPlayedCoop: true,
      }),
    )
  })

  it("a later day's record starts afresh, keeping the stamps", () => {
    expect(
      mergeMissions(
        onToday({ progress: { SplatZombies: 40 }, stampedDays: [TODAY] }),
        { ...noMissions, day: TOMORROW, progress: { PullFridge: 1 } },
      ),
    ).toEqual({
      ...noMissions,
      day: TOMORROW,
      progress: { PullFridge: 1 },
      stampedDays: [TODAY],
    })
  })
})

describe('the daily missions in sync', () => {
  it("a claim goes up as its own change, apart from the run's Bones", () => {
    expect(
      changesBetween(
        legacySave,
        afterRun(
          onToday({
            progress: { SplatZombies: 150 },
            claimed: ['SplatZombies'],
          }),
          20,
        ),
      ),
    ).toEqual([
      {
        _tag: 'ProgressedMissions',
        day: TODAY,
        progress: { SplatZombies: 150 },
        coop: false,
      },
      { _tag: 'ClaimedMission', day: TODAY, mission: 'SplatZombies' },
    ])
  })

  it.effect("two devices' runs both count toward a mission", () =>
    synced(
      Effect.gen(function* () {
        const { phone, laptop } = yield* linkedPair
        yield* write(
          phone,
          legacySave,
          afterRun(onToday({ progress: { SplatZombies: 40 } }), 0),
        )
        yield* write(
          laptop,
          legacySave,
          afterRun(onToday({ progress: { SplatZombies: 50 } }), 0),
        )
        const isSummed = (maybeSave: Option.Option<PlayerSave>) =>
          Option.exists(
            maybeSave,
            save => save.missions.progress['SplatZombies'] === 90,
          )
        const onPhone = yield* until(phone.load, isSummed)
        const onLaptop = yield* until(laptop.load, isSummed)
        expect(isSummed(onPhone)).toBe(true)
        expect(isSummed(onLaptop)).toBe(true)
      }),
    ),
  )

  it.effect('two devices finishing the day are paid once', () =>
    synced(
      Effect.gen(function* () {
        const { phone, laptop } = yield* linkedPair
        // NOTE: each device's run also counts one of its own, so the check
        // waits for both devices' changes, not the first to land.
        const done = (own: string) =>
          afterRun(
            onToday({
              progress: {
                PullFridge: 1,
                OpenCellar: 1,
                SplatZombies: 150,
                [own]: 5,
              },
              claimed: ['PullFridge', 'OpenCellar', 'SplatZombies'],
              stampedDays: [TODAY],
            }),
            10 + 15 + 20 + ALL_THREE_BONES,
          )
        yield* write(phone, legacySave, done('HotfootKills'))
        yield* write(laptop, legacySave, done('BarnBusterKills'))
        const isBoth = (save: PlayerSave) =>
          save.missions.progress['HotfootKills'] === 5 &&
          save.missions.progress['BarnBusterKills'] === 5
        const isPaidOnce = (maybeSave: Option.Option<PlayerSave>) =>
          Option.exists(
            maybeSave,
            save =>
              isBoth(save) &&
              save.rank.earnedBones === 70 &&
              save.missions.claimed.length === 3 &&
              save.missions.stampedDays.length === 1,
          )
        const isSettled = (maybeSave: Option.Option<PlayerSave>) =>
          Option.exists(maybeSave, isBoth)
        const onPhone = yield* until(phone.load, isSettled)
        const onLaptop = yield* until(laptop.load, isSettled)
        expect(isPaidOnce(onPhone)).toBe(true)
        expect(isPaidOnce(onLaptop)).toBe(true)
      }),
    ),
  )
})
