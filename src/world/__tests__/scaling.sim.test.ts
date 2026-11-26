import { Array, Clock, Effect, Order, pipe } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it } from '@effect/vitest'

import type { Model } from '#app/model.ts'
import { ZOMBIE_ALIVE_MAX } from '#shared/constants.ts'
import { DISTANT_SPAWN, plannedSpawn, quietWave } from '#test/model.fixture.ts'
import { FRAME_MS, modelAfter, ticks } from '#test/testing.ts'
import { Phase } from '#world/schema/worldSchema.ts'

import { crowdOf } from './workBudget.fixture.ts'

const SMALL = 20
const LARGE = 80
const FRAMES = 120
const ROUNDS = 7
const MOST_GROWTH = 7.5

const timedFrom = (start: Model) =>
  Effect.gen(function* () {
    const before = yield* Clock.currentTimeNanos
    yield* modelAfter(start, ticks(FRAMES, FRAME_MS))
    const after = yield* Clock.currentTimeNanos
    return Number(after - before)
  })

const timed = (crowd: number) => timedFrom(crowdOf(quietWave(3), crowd))

const SMALL_PLAN = 100
const LARGE_PLAN = 400

const heldPlan = (packs: number): Model =>
  UiStruct.evolve(crowdOf(quietWave(3), ZOMBIE_ALIVE_MAX), {
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

  it.live(
    'four times the zombies costs about four times the frame',
    () =>
      Effect.gen(function* () {
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
