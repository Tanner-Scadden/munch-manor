import { Effect, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import { Message } from '../../../app/message'
import { type Model, Phase } from '../../../app/model'
import { initialModel } from '../../../app/pureApp'
import { FIXED_STEP_MS, PREPARATION_MS } from '../../../shared/constants'
import { lastHeart, withDareThings } from '../../../test/model.fixture'
import { APPLICATION, ticks, writeSave } from '../../../test/testing'
import { noRank } from '../../../world/heroes/rank'
import { seatCrew } from '../../../world/party/party'
import { type Modifiers } from '../../../world/run/modifiers'
import { withWorld } from '../../../world/schema/world'
import {
  FOUND_THINGS,
  checkSavedChanges,
  diesOnWave7,
  ended,
  frame,
  lastWave,
  leave,
  runAt,
  wave,
} from './rank.fixture'

// Rank and Bones (src/world/heroes/rank.ts, src/features/end/rankRun.ts): a run pays its points and
// Bones into the saved rank when it ends or is left, and sets what the end
// card's strip shows. The numbers are the design's: a Normal run that dies
// on wave 7 pays 60 points and 6 Bones; a Normal escape on wave 10 with its
// three things and Uncle Chunk felled 315 and 31.

// NOTE: the end card's beat is over, so its buttons work.
const afterBeat = (model: Model): Model =>
  modifyFields(model, { screenMs: () => 60_000 })

describe('a death', () => {
  it.effect('pays 10 points a wave cleared, and a Bone for each 10', () =>
    Story.story(
      APPLICATION,
      Story.given(diesOnWave7),
      frame,
      Story.model(after => {
        expect(after.phase._tag).toBe('GameOver')
        expect(after.rank).toMatchObject({ earnedPoints: 60, earnedBones: 6 })
        expect(after.maybeRankGain).toEqual(
          Option.some({
            pointsBefore: 0,
            gained: 60,
            bonesGained: 6,
            bonusPercent: 0,
            bonuses: [],
          }),
        )
      }),
      writeSave(),
    ),
  )

  it.effect('grows the save, as an increment', () =>
    Story.story(
      APPLICATION,
      Story.given(
        modifyFields(diesOnWave7, {
          rank: rank => ({ ...rank, earnedPoints: 90, earnedBones: 9 }),
        }),
      ),
      frame,
      Story.model(after => {
        expect(after.rank.earnedPoints).toBe(150)
        expect(after.maybeRankGain).toEqual(
          Option.some({
            pointsBefore: 90,
            gained: 60,
            bonesGained: 6,
            bonusPercent: 0,
            bonuses: [],
          }),
        )
      }),
      checkSavedChanges(changes => {
        expect(changes).toContainEqual({
          _tag: 'EarnedRank',
          points: 60,
          bones: 6,
        })
      }),
      writeSave(),
    ),
  )

  it.effect('counts the points the veteran grant gave before the run', () =>
    Effect.gen(function* () {
      const after = yield* ended(
        modifyFields(diesOnWave7, {
          rank: rank => ({ ...rank, veteranPoints: 400, veteranBones: 40 }),
        }),
      )
      expect(after.maybeRankGain).toEqual(
        Option.some({
          pointsBefore: 400,
          gained: 60,
          bonesGained: 6,
          bonusPercent: 0,
          bonuses: [],
        }),
      )
    }),
  )

  it.effect('is multiplied by the difficulty and rounded down', () =>
    Effect.gen(function* () {
      const on = (chosen: 'Easy' | 'Hard'): Model =>
        modifyFields(diesOnWave7, {
          difficulty: setting =>
            modifyFields(setting, { chosen: () => chosen }),
        })
      const hard = yield* ended(on('Hard'))
      const easy = yield* ended(on('Easy'))
      expect(hard.rank.earnedPoints).toBe(90)
      expect(easy.rank.earnedPoints).toBe(45)
    }),
  )

  it.effect(
    'is multiplied by the modifiers’ bonus, and the end card says so',
    () =>
      Effect.gen(function* () {
        const modifiers: Modifiers = {
          friendlyFire: false,
          bigCrowd: false,
          broke: true,
          glass: true,
        }
        const after = yield* ended(
          modifyFields(diesOnWave7, { modifiers: () => modifiers }),
        )
        expect(after.rank).toMatchObject({ earnedPoints: 315, earnedBones: 31 })
        expect(after.maybeRankGain).toEqual(
          Option.some({
            pointsBefore: 0,
            gained: 315,
            bonesGained: 31,
            bonusPercent: 425,
            bonuses: [],
          }),
        )
      }),
  )

  it.effect('counts Friendly Fire only with a teammate to hit', () =>
    Effect.gen(function* () {
      const friendly: Modifiers = {
        friendlyFire: true,
        bigCrowd: false,
        broke: false,
        glass: false,
      }
      const alone = yield* ended(
        modifyFields(diesOnWave7, { modifiers: () => friendly }),
      )
      expect(alone.rank.earnedPoints).toBe(60)
      expect(
        Option.map(alone.maybeRankGain, ({ bonusPercent }) => bonusPercent),
      ).toEqual(Option.some(0))
      return yield* Story.story(
        APPLICATION,
        Story.given(
          withWorld(
            modifyFields(runAt(wave(7), 6, 0), { modifiers: () => friendly }),
            world => seatCrew(world, 2),
          ),
        ),
        leave,
        Story.model(crewed => {
          expect(crewed.rank.earnedPoints).toBe(69)
        }),
        writeSave(),
      )
    }),
  )

  it.effect('pays once: the end card ticking on pays nothing more', () =>
    Story.story(
      APPLICATION,
      Story.given(diesOnWave7),
      frame,
      writeSave(),
      ...ticks(30, FIXED_STEP_MS),
      Story.model(later => {
        expect(later.rank.earnedPoints).toBe(60)
      }),
    ),
  )
})

describe('an escape', () => {
  it.effect(
    'pays the waves, each thing found, Uncle Chunk, and the walk out',
    () =>
      Effect.gen(function* () {
        const won = yield* ended(lastWave)
        expect(won.phase._tag).toBe('Escaped')
        // NOTE: the first escape on Normal adds its 50 Bones.
        expect(won.rank).toMatchObject({ earnedPoints: 315, earnedBones: 81 })
        expect(won.maybeRankGain).toEqual(
          Option.some({
            pointsBefore: 0,
            gained: 315,
            bonesGained: 81,
            bonusPercent: 0,
            bonuses: ['FirstEscape'],
          }),
        )
      }),
  )

  it.effect('a death still pays for the things it found', () =>
    Effect.gen(function* () {
      const after = yield* ended(
        lastHeart(withDareThings(runAt(wave(7), 6, 0), FOUND_THINGS)),
      )
      expect(after.phase._tag).toBe('GameOver')
      expect(after.rank.earnedPoints).toBe(60 + 75)
    }),
  )
})

describe('leaving a run', () => {
  it.effect('pays the waves cleared so far like a death, once', () =>
    Story.story(
      APPLICATION,
      Story.given(runAt(wave(4), 3, 0)),
      leave,
      Story.model(left => {
        expect(left.phase._tag).toBe('Ready')
        expect(left.rank).toMatchObject({ earnedPoints: 30, earnedBones: 3 })
        expect(Option.isNone(left.maybeRankGain)).toBe(true)
      }),
      writeSave(),
      Story.message(Message.ClickedMenuButton()),
      Story.model(after => {
        expect(after.rank.earnedPoints).toBe(30)
      }),
    ),
  )

  it.effect('a run left from the end card pays nothing more', () =>
    Effect.gen(function* () {
      const over = yield* ended(diesOnWave7)
      return yield* Story.story(
        APPLICATION,
        Story.given(afterBeat(over)),
        Story.message(Message.ClickedMenuButton()),
        Story.model(home => {
          expect(home.phase._tag).toBe('Ready')
          expect(home.rank.earnedPoints).toBe(60)
        }),
      )
    }),
  )

  it.effect('the practice gate pays nothing', () =>
    // NOTE: a guided run cannot have cleared waves, so the stats are forced
    // to show that the gate itself pays nothing.
    Story.story(
      APPLICATION,
      Story.given(
        modifyFields(initialModel, {
          stats: stats => modifyFields(stats, { wavesCleared: () => 3 }),
          phase: () =>
            Phase.Preparation({
              wave: 1,
              remainingMs: 9000,
              durationMs: PREPARATION_MS,
              spawns: [],
            }),
        }),
      ),
      leave,
      Story.model(left => {
        expect(left.rank).toEqual(noRank)
      }),
    ),
  )
})
