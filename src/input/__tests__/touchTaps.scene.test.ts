import { Mount, given, scene } from 'foldkit/scene'
import { describe, test } from 'vitest'

import { ListenForTouchTaps, MeasureGameSurface } from '../../app/mount'
import { homeAfterRead } from '../../test/model.fixture'
import { ROOT, measureSurface } from '../../test/testing'

// NOTE: every button's tap comes from the touch tap listener on the game's
// root (src/input/touchTaps.ts), so a tap works with another finger down. The
// root must keep it.
describe('the touch tap listener', () => {
  test('is mounted on the root with the game surface', () => {
    scene(
      ROOT,
      given(homeAfterRead),
      Mount.expectExact(MeasureGameSurface, ListenForTouchTaps),
      measureSurface,
    )
  })
})
