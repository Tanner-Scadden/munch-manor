import { Effect } from 'effect'

import { describe, it } from '@effect/vitest'

import { homeAfterRead } from '#test/model.fixture.ts'
import { measureSurface } from '#test/sceneTesting.ts'
import { sceneOf } from '#test/testing.ts'

describe('the touch tap listener', () => {
  it.effect('is mounted on the root with the game surface', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(homeAfterRead)
      s.pipe(measureSurface)
    }),
  )
})
