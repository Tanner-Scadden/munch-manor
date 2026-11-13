import { Effect, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import { Message } from '../../../app/message'
import type { Model } from '../../../app/model'
import { knowingDay, lastHeart } from '../../../test/model.fixture'
import { APPLICATION, writeSave } from '../../../test/testing'
import {
  checkSavedChanges,
  diesOnWave7,
  ended,
  frame,
  lastWave,
  leave,
  runAt,
  wave,
} from './rank.fixture'

// The Bones bonuses (src/world/heroes/rank.ts, src/features/end/rankRun.ts):
// a run that ends on the end card pays at least 3 Bones, the day's first
// one pays its Bones twice, and the first escape on a difficulty pays 50
// once. Each goes up to the player's other devices as its own change, so
// the server pays it once (src/platform/playerScope.ts).

const TODAY = '2026-11-12'

// NOTE: a death on wave 2 with one wave cleared: 10 points, 1 Bone.
const diesOnWave2 = lastHeart(runAt(wave(2), 1, 0))

const today = (model: Model, day: string = TODAY): Model =>
  knowingDay(model, day)

const doubledOn = (model: Model, day: string): Model =>
  modifyFields(model, {
    bonuses: bonuses => ({ ...bonuses, doubledDay: day }),
  })

describe('the Bones floor', () => {
  it.effect('a short run that ends on the end card pays 3 Bones', () =>
    Story.story(
      APPLICATION,
      Story.given(diesOnWave2),
      frame,
      Story.model(after => {
        expect(after.rank).toMatchObject({ earnedPoints: 10, earnedBones: 3 })
        expect(
          Option.map(after.maybeRankGain, ({ bonesGained, bonuses }) => ({
            bonesGained,
            bonuses,
          })),
        ).toEqual(Option.some({ bonesGained: 3, bonuses: ['Floor'] }))
      }),
      checkSavedChanges(changes => {
        expect(changes).toContainEqual({
          _tag: 'EarnedRank',
          points: 10,
          bones: 3,
        })
      }),
      writeSave(),
    ),
  )

  it.effect('a run that scored nothing pays nothing', () =>
    Effect.gen(function* () {
      const after = yield* ended(lastHeart(runAt(wave(1), 0, 0)))
      expect(after.phase._tag).toBe('GameOver')
      expect(after.rank.earnedBones).toBe(0)
    }),
  )

  it.effect('a run left for home pays only what it earned', () =>
    Story.story(
      APPLICATION,
      Story.given(today(runAt(wave(2), 1, 0))),
      leave,
      Story.model(left => {
        expect(left.rank).toMatchObject({ earnedPoints: 10, earnedBones: 1 })
        expect(left.bonuses.doubledDay).toBeNull()
      }),
      writeSave(),
    ),
  )
})

describe("the day's first run", () => {
  it.effect('pays its Bones twice, and marks the day', () =>
    Story.story(
      APPLICATION,
      Story.given(diesOnWave7),
      Story.message(Message.ChangedToday({ day: TODAY })),
      // NOTE: the day's three frozen as the day comes in.
      writeSave(),
      frame,
      Story.model(after => {
        expect(after.rank.earnedBones).toBe(12)
        expect(after.bonuses.doubledDay).toBe(TODAY)
        expect(
          Option.map(after.maybeRankGain, ({ bonuses }) => bonuses),
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
      writeSave(),
    ),
  )

  it.effect('doubles the floor too', () =>
    Effect.gen(function* () {
      const after = yield* ended(today(diesOnWave2))
      expect(after.rank.earnedBones).toBe(6)
      expect(Option.map(after.maybeRankGain, ({ bonuses }) => bonuses)).toEqual(
        Option.some(['Floor', 'Double']),
      )
    }),
  )

  it.effect('the second run that day pays once', () =>
    Effect.gen(function* () {
      const after = yield* ended(doubledOn(today(diesOnWave7), TODAY))
      expect(after.rank.earnedBones).toBe(6)
      expect(Option.map(after.maybeRankGain, ({ bonuses }) => bonuses)).toEqual(
        Option.some([]),
      )
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
    Story.story(
      APPLICATION,
      Story.given(lastWave),
      frame,
      Story.model(won => {
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
      writeSave(),
    ),
  )

  it.effect('the next escape on it pays only the run', () =>
    Effect.gen(function* () {
      const won = yield* ended(
        modifyFields(lastWave, {
          bonuses: bonuses => ({ ...bonuses, escapedOn: ['Normal'] }),
        }),
      )
      expect(won.rank.earnedBones).toBe(31)
      expect(Option.map(won.maybeRankGain, ({ bonuses }) => bonuses)).toEqual(
        Option.some([]),
      )
    }),
  )

  it.effect("stacks on the day's first run, which doubles only the run", () =>
    Effect.gen(function* () {
      const won = yield* ended(today(lastWave))
      // NOTE: a known day pays the day's missions too (an escape may finish
      // one), apart from the bonuses (src/features/missions/missions.ts).
      const missionBones = Option.match(won.maybeMissionGain, {
        onNone: () => 0,
        onSome: ({ bones }) => bones,
      })
      expect(won.rank.earnedBones - missionBones).toBe(31 * 2 + 50)
      expect(Option.map(won.maybeRankGain, ({ bonuses }) => bonuses)).toEqual(
        Option.some(['Double', 'FirstEscape']),
      )
    }),
  )
})
