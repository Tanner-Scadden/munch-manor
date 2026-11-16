// How the step's cost grows with the crowd: the zombies' share of a stretch
// of a wave (its time less the same stretch with none) should grow about
// four times for four times the zombies, never the sixteen a pass of every
// zombie against every zombie would. The same holds for the wave's plan:
// the packs held at the doors while the house is full are read on every
// tick, and four times as many should cost about four times as much. The
// sizes are timed in turn, several times, and their medians compared, so a
// slow moment on a busy machine moves them alike.
import { Array, Clock, Effect, Order, pipe } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import type { Model } from '../../app/model'
import { ZOMBIE_ALIVE_MAX } from '../../shared/constants'
import {
  DISTANT_SPAWN,
  plannedSpawn,
  quietWave,
} from '../../test/model.fixture'
import { APPLICATION, FRAME_MS, ticks } from '../../test/testing'
import { Phase } from '../schema/worldSchema'
import { crowdOf } from './workBudget.fixture'

const SMALL = 20
const LARGE = 80
const FRAMES = 120
const ROUNDS = 7
// NOTE: linear is 4, quadratic 16. The step measured 4.6 to 5.2 (a crowd
// four times as thick jostles a little more), and with one small pass of
// every zombie against every zombie added, 9.2 to 9.5.
const MOST_GROWTH = 7.5

const timedFrom = (start: Model) =>
  Effect.gen(function* () {
    const before = yield* Clock.currentTimeNanos
    yield* Story.story(
      APPLICATION,
      Story.given(start),
      ...ticks(FRAMES, FRAME_MS),
    )
    const after = yield* Clock.currentTimeNanos
    return Number(after - before)
  })

const timed = (crowd: number) => timedFrom(crowdOf(quietWave(3), crowd))

// NOTE: a full house (every place the alive cap allows taken) and `packs`
// packs of one due now, so each waits at its door on every tick.
const SMALL_PLAN = 100
const LARGE_PLAN = 400

const heldPlan = (packs: number): Model =>
  modifyFields(crowdOf(quietWave(3), ZOMBIE_ALIVE_MAX), {
    phase: () =>
      Phase.Wave({
        wave: 3,
        elapsedMs: 0,
        spawns: [
          ...Array.makeBy(packs, pack => ({ ...plannedSpawn(0), pack })),
          DISTANT_SPAWN,
        ],
      }),
  })

const median = (values: ReadonlyArray<number>): number =>
  pipe(
    Array.sort(values, Order.Number),
    sorted => sorted[Math.floor(sorted.length / 2)] ?? 0,
  )

describe('the step as the crowd grows', () => {
  it.effect('the crowd stands as asked', () =>
    Effect.sync(() => {
      expect(crowdOf(quietWave(3), LARGE).zombies.length).toBe(LARGE)
    }),
  )

  // NOTE: a real clock, since the test is about how long the step takes.
  it.live(
    'four times the zombies costs about four times the frame',
    () =>
      Effect.gen(function* () {
        // NOTE: the first run builds what the level keeps, timed apart.
        yield* timed(SMALL)
        const rounds = yield* Effect.forEach(
          Array.makeBy(ROUNDS, () => undefined),
          () =>
            Effect.all({
              none: timed(0),
              small: timed(SMALL),
              large: timed(LARGE),
            }),
        )
        const none = median(Array.map(rounds, round => round.none))
        const growth =
          (median(Array.map(rounds, ({ large }) => large)) - none) /
          (median(Array.map(rounds, ({ small }) => small)) - none)
        expect(growth).toBeLessThan(MOST_GROWTH)
      }),
    60_000,
  )

  // NOTE: a real clock, since the test is about how long the step takes.
  it.live(
    'four times the packs held at the doors costs about four times the frame',
    () =>
      Effect.gen(function* () {
        expect(heldPlan(SMALL_PLAN).zombies.length).toBe(ZOMBIE_ALIVE_MAX)
        yield* timedFrom(heldPlan(SMALL_PLAN))
        const rounds = yield* Effect.forEach(
          Array.makeBy(ROUNDS, () => undefined),
          () =>
            Effect.all({
              none: timedFrom(heldPlan(0)),
              small: timedFrom(heldPlan(SMALL_PLAN)),
              large: timedFrom(heldPlan(LARGE_PLAN)),
            }),
        )
        const none = median(Array.map(rounds, round => round.none))
        const growth =
          (median(Array.map(rounds, ({ large }) => large)) - none) /
          (median(Array.map(rounds, ({ small }) => small)) - none)
        expect(growth).toBeLessThan(MOST_GROWTH)
      }),
    60_000,
  )
})
