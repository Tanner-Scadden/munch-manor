import { Effect } from 'effect'

import { describe, it } from '@effect/vitest'

import { homeAfterRead } from '../../test/model.fixture'
import { measureSurface } from '../../test/sceneTesting'
import { sceneOf } from '../../test/testing'

// NOTE: every button's tap comes from the touch tap listener on the game's
// root (src/input/touchTaps.ts), so a tap works with another finger down. The
// root must keep it: `measureSurface` acknowledges the game surface's Mount
// and expects ListenForTouchTaps beside it.
describe('the touch tap listener', () => {
  it.effect('is mounted on the root with the game surface', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(homeAfterRead)
      s.pipe(measureSurface)
    }),
  )
})
