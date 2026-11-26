import { Effect, Option } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it } from '@effect/vitest'

import { Message } from '#app/message.ts'
import type { Model } from '#app/model.ts'
import { knowingDay, lastHeart } from '#test/model.fixture.ts'
import { checkModel, send, storyOf, writeSave } from '#test/testing.ts'
import { pointsForRank } from '#world/heroes/rank.ts'

import {
  checkSavedChanges,
  diesOnWave7,
  ended,
  frame,
  lastWave,
  leave,
  runAt,
  wave,
} from './rank.fixture.ts'

const TODAY = '2026-11-12'

const diesOnWave2 = lastHeart(runAt(wave(2), 1, 0))

const today = (model: Model, day: string = TODAY): Model =>
  knowingDay(model, day)

const doubledOn = (model: Model, day: string): Model =>
  UiStruct.evolve(model, {
    bonuses: bonuses => ({ ...bonuses, doubledDay: day }),
  })

describe('the Bones floor', () => {
  it.effect('a short run that ends on the end card pays 3 Bones', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(diesOnWave2)
      s.pipe(
        frame,
        checkModel(after => {
          expect(after.rank).toMatchObject({ earnedPoints: 10, earnedBones: 3 })
          expect(
            Option.map(
              after.runGains.maybeRankGain,
              ({ bonesGained, bonuses }) => ({
                bonesGained,
                bonuses,
              }),
            ),
          ).toEqual(Option.some({ bonesGained: 3, bonuses: ['Floor'] }))
        }),
        checkSavedChanges(changes => {
          expect(changes).toContainEqual({
            _tag: 'EarnedRank',
            points: 10,
            bones: 3,
          })
        }),
        writeSave,
      )
    }),
  )

  it.effect('a run that scored nothing pays nothing', () =>
    Effect.gen(function* () {
      const after = yield* ended(lastHeart(runAt(wave(1), 0, 0)))
      expect(after.phase._tag).toBe('GameOver')
      expect(after.rank.earnedBones).toBe(0)
    }),
  )

  it.effect('a run left for home pays only what it earned', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(today(runAt(wave(2), 1, 0)))
      s.pipe(
        leave,
        checkModel(left => {
          expect(left.rank).toMatchObject({ earnedPoints: 10, earnedBones: 1 })
          expect(left.bonuses.doubledDay).toBeNull()
        }),
        writeSave,
      )
    }),
  )
})

describe("the day's first run", () => {
  it.effect('pays its Bones twice, and marks the day', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(diesOnWave7)
      s.pipe(
        send(Message.ChangedToday({ day: TODAY })),
        writeSave,
        frame,
        checkModel(after => {
          expect(after.rank.earnedBones).toBe(12)
          expect(after.bonuses.doubledDay).toBe(TODAY)
          expect(
            Option.map(after.runGains.maybeRankGain, ({ bonuses }) => bonuses),
          ).toEqual(Option.some(['Double']))
        }),
        checkSavedChanges(changes => {
          expect(changes).toContainEqual({
            _tag: 'EarnedRank',
            points: 60,
            bones: 6,
          })
          expect(changes).toContainEqual({
            _tag: 'DoubledFirstRun',
            day: TODAY,
            bones: 6,
          })
        }),
        writeSave,
      )
    }),
  )

  it.effect('doubles the floor too', () =>
    Effect.gen(function* () {
      const after = yield* ended(today(diesOnWave2))
      expect(after.rank.earnedBones).toBe(6)
      expect(
        Option.map(after.runGains.maybeRankGain, ({ bonuses }) => bonuses),
      ).toEqual(Option.some(['Floor', 'Double']))
    }),
  )

  it.effect('the second run that day pays once', () =>
    Effect.gen(function* () {
      const after = yield* ended(doubledOn(today(diesOnWave7), TODAY))
      expect(after.rank.earnedBones).toBe(6)
      expect(
        Option.map(after.runGains.maybeRankGain, ({ bonuses }) => bonuses),
      ).toEqual(Option.some([]))
    }),
  )

  it.effect('a new day doubles again', () =>
    Effect.gen(function* () {
      const after = yield* ended(
        doubledOn(today(diesOnWave7, '2026-11-13'), TODAY),
      )
      expect(after.rank.earnedBones).toBe(12)
      expect(after.bonuses.doubledDay).toBe('2026-11-13')
    }),
  )

  it.effect('pays nothing extra before the day is known', () =>
    Effect.gen(function* () {
      const after = yield* ended(diesOnWave7)
      expect(after.rank.earnedBones).toBe(6)
      expect(after.bonuses.doubledDay).toBeNull()
    }),
  )
})

describe('the first escape on a difficulty', () => {
  it.effect('pays 50 Bones once, and marks the difficulty', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(lastWave)
      s.pipe(
        frame,
        checkModel(won => {
          expect(won.phase._tag).toBe('Escaped')
          expect(won.rank.earnedBones).toBe(31 + 50)
          expect(won.bonuses.escapedOn).toEqual(['Normal'])
        }),
        checkSavedChanges(changes => {
          expect(changes).toContainEqual({
            _tag: 'EarnedRank',
            points: 315,
            bones: 31,
          })
          expect(changes).toContainEqual({
            _tag: 'EscapedFirst',
            difficulty: 'Normal',
          })
        }),
        writeSave,
      )
    }),
  )

  it.effect('the next escape on it pays only the run', () =>
    Effect.gen(function* () {
      const won = yield* ended(
        UiStruct.evolve(lastWave, {
          bonuses: bonuses => ({ ...bonuses, escapedOn: ['Normal'] }),
        }),
      )
      expect(won.rank.earnedBones).toBe(31)
      expect(
        Option.map(won.runGains.maybeRankGain, ({ bonuses }) => bonuses),
      ).toEqual(Option.some([]))
    }),
  )

  it.effect("stacks on the day's first run, which doubles only the run", () =>
    Effect.gen(function* () {
      const won = yield* ended(today(lastWave))
      const missionBones = Option.match(won.runGains.maybeMissionGain, {
        onNone: () => 0,
        onSome: ({ bones }) => bones,
      })
      expect(won.rank.earnedBones - missionBones).toBe(31 * 2 + 50)
      expect(
        Option.map(won.runGains.maybeRankGain, ({ bonuses }) => bonuses),
      ).toEqual(Option.some(['Double', 'FirstEscape']))
    }),
  )
})

const nearRank21 = (short: number, paid: ReadonlyArray<number>): Model =>
  UiStruct.evolve(diesOnWave7, {
    rank: rank =>
      UiStruct.evolve(rank, { earnedPoints: () => pointsForRank(21) - short }),
    bonuses: bonuses => ({ ...bonuses, purses: paid }),
  })

describe('the rank purses', () => {
  it.effect('a run that reaches rank 21 pays its purse of 15', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(nearRank21(30, []))
      s.pipe(
        frame,
        checkModel(after => {
          expect(after.rank.earnedBones).toBe(6 + 15)
          expect(after.bonuses.purses).toEqual([21])
        }),
        checkSavedChanges(changes => {
          expect(changes).toEqual(
            expect.arrayContaining([
              { _tag: 'EarnedRank', points: 60, bones: 6 },
              { _tag: 'PaidRankPurse', rank: 21 },
            ]),
          )
        }),
        writeSave,
      )
    }),
  )

  it.effect('a purse paid once is never paid again', () =>
    Effect.gen(function* () {
      const after = yield* ended(nearRank21(30, [21]))
      expect(after.rank.earnedBones).toBe(6)
      expect(after.bonuses.purses).toEqual([21])
    }),
  )

  it.effect('a run that stays below rank 21 pays no purse', () =>
    Effect.gen(function* () {
      const after = yield* ended(nearRank21(100, []))
      expect(after.rank.earnedBones).toBe(6)
      expect(after.bonuses.purses).toEqual([])
    }),
  )
})
