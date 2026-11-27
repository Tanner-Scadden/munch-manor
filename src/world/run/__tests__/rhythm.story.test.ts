import { Array, Effect, Option } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it } from '@effect/vitest'

import { type Difficulty, type Model, Phase } from '#app/model.ts'
import { FIXED_STEP_MS } from '#shared/constants.ts'
import { breakSpawns, home, pastTimedBreaks } from '#test/model.fixture.ts'
import { modelAfter, tick } from '#test/testing.ts'
import { DIFFICULTIES } from '#world/run/difficulty.ts'

const clearingOn = (difficulty: Difficulty): Model =>
  UiStruct.evolve(pastTimedBreaks(home), {
    difficulty: setting =>
      UiStruct.evolve(setting, { chosen: () => difficulty }),
    phase: () => Phase.Wave({ wave: 4, elapsedMs: 0, spawns: [] }),
  })

const breakRolledOn = (difficulty: Difficulty) =>
  modelAfter(clearingOn(difficulty), tick(FIXED_STEP_MS))

const times = (model: Model): ReadonlyArray<number> =>
  Array.map(breakSpawns(model), ({ atMs }) => atMs)

describe('the difficulty sets the wave rhythm', () => {
  it('Double Dare keeps the planned rhythm; Dare rests longer; the two above peak sooner', () => {
    expect(DIFFICULTIES.Normal.tempo).toBe(1)
    expect(DIFFICULTIES.Normal.lullScale).toBe(1)
    expect(DIFFICULTIES.Easy.tempo).toBe(1)
    expect(DIFFICULTIES.Easy.lullScale).toBeGreaterThan(1)
    expect(DIFFICULTIES.Hard.tempo).toBeLessThan(1)
    expect(DIFFICULTIES.Nightmare.tempo).toBeLessThan(DIFFICULTIES.Hard.tempo)
  })

  it.effect('every level gets the same count, and the harder ones sooner', () =>
    Effect.gen(function* () {
      const normal = yield* breakRolledOn('Normal')
      const hard = yield* breakRolledOn('Hard')
      const nightmare = yield* breakRolledOn('Nightmare')
      expect(times(normal).length).toBeGreaterThan(20)
      expect(times(hard).length).toBe(times(normal).length)
      expect(times(nightmare).length).toBe(times(normal).length)
      expect(times(hard)).toEqual(
        Array.map(times(normal), atMs =>
          Math.round(atMs * DIFFICULTIES.Hard.tempo),
        ),
      )
      expect(Array.map(hard.pacing.holds, ({ atMs }) => atMs)).toEqual(
        Array.map(normal.pacing.holds, ({ atMs }) =>
          Math.round(atMs * DIFFICULTIES.Hard.tempo),
        ),
      )
      expect(Array.last(times(nightmare))).toEqual(
        Option.map(Array.last(times(normal)), atMs =>
          Math.round(atMs * DIFFICULTIES.Nightmare.tempo),
        ),
      )
    }),
  )

  it.effect('Dare spawns on time and rests longer after each hold', () =>
    Effect.gen(function* () {
      const normal = yield* breakRolledOn('Normal')
      const easy = yield* breakRolledOn('Easy')
      expect(times(easy)).toEqual(times(normal))
      expect(normal.pacing.holds.length).toBeGreaterThan(0)
      expect(Array.map(easy.pacing.holds, ({ atMs }) => atMs)).toEqual(
        Array.map(normal.pacing.holds, ({ atMs }) => atMs),
      )
      expect(Array.map(easy.pacing.holds, ({ relaxMs }) => relaxMs)).toEqual(
        Array.map(normal.pacing.holds, ({ relaxMs }) =>
          Math.round(relaxMs * DIFFICULTIES.Easy.lullScale),
        ),
      )
    }),
  )
})
