import { Effect, Option } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it } from '@effect/vitest'

import type { Model } from '#app/model.ts'
import { maybeGhostOf } from '#features/end/ghostView.ts'
import { lastHeart, withDareThings } from '#test/model.fixture.ts'
import type { BestRun } from '#world/schema/worldSchema.ts'

import {
  FOUND_THINGS,
  diesOnWave7,
  ended,
  runAt,
  wave,
} from './rank.fixture.ts'

const withBestRun = (model: Model, best: BestRun): Model =>
  UiStruct.evolve(model, {
    bests: bests =>
      UiStruct.evolve(bests, {
        byDifficulty: byDifficulty =>
          UiStruct.evolve(byDifficulty, {
            Normal: normal =>
              UiStruct.evolve(normal, {
                maybeBestRun: () => Option.some(best),
              }),
          }),
      }),
  })

const bestRunOn = (model: Model): Option.Option<BestRun> =>
  model.bests.byDifficulty.Normal.maybeBestRun

describe('the best run', () => {
  it.effect('the first run sets it', () =>
    Effect.gen(function* () {
      const after = yield* ended(diesOnWave7)
      expect(bestRunOn(after)).toEqual(Option.some({ wave: 7, things: [] }))
    }),
  )

  it.effect('more things found beats a further wave', () =>
    Effect.gen(function* () {
      const after = yield* ended(
        withBestRun(
          lastHeart(withDareThings(runAt(wave(4), 3, 0), FOUND_THINGS)),
          { wave: 9, things: [] },
        ),
      )
      expect(bestRunOn(after)).toEqual(
        Option.some({
          wave: 4,
          things: ['SilverSpoon', 'MusicBox', 'FamilyPortrait'],
        }),
      )
    }),
  )

  it.effect('a worse run keeps the best', () =>
    Effect.gen(function* () {
      const best: BestRun = { wave: 9, things: ['MusicBox'] }
      const after = yield* ended(withBestRun(diesOnWave7, best))
      expect(bestRunOn(after)).toEqual(Option.some(best))
    }),
  )
})

describe("the best run's ghost", () => {
  it.effect('shows on a loss while the best is better', () =>
    Effect.gen(function* () {
      const best: BestRun = { wave: 9, things: ['MusicBox'] }
      const after = yield* ended(withBestRun(diesOnWave7, best))
      expect(maybeGhostOf(after)).toEqual(Option.some(best))
    }),
  )

  it.effect('a run that just became the best shows none', () =>
    Effect.gen(function* () {
      const after = yield* ended(
        withBestRun(diesOnWave7, { wave: 5, things: [] }),
      )
      expect(maybeGhostOf(after)).toEqual(Option.none())
    }),
  )
})
