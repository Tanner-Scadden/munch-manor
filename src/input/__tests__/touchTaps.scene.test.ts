import { Effect } from 'effect'

import { describe, it } from '@effect/vitest'

import { homeAfterRead } from '../../test/model.fixture'
import { measureSurface } from '../../test/sceneTesting'
import { sceneOf } from '../../test/testing'

describe('the touch tap listener', () => {
  it.effect('is mounted on the root with the game surface', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(homeAfterRead)
      s.pipe(measureSurface)
    }),
  )
})
