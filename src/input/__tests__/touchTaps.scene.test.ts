import { Scene } from 'foldkit'

import { describe, it } from '@effect/vitest'

import { ListenForTouchTaps, MeasureGameSurface } from '../../app/mount'
import { homeAfterRead } from '../../test/model.fixture'
import { APPLICATION, measureSurface } from '../../test/testing'

// NOTE: every button's tap comes from the touch tap listener on the game's
// root (src/input/touchTaps.ts), so a tap works with another finger down. The
// root must keep it.
describe('the touch tap listener', () => {
  it.effect('is mounted on the root with the game surface', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(homeAfterRead),
      Scene.Mount.expectExact(MeasureGameSurface, ListenForTouchTaps),
      measureSurface,
    ),
  )
})
