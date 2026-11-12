import { Scene } from 'foldkit'

import { describe, it } from '@effect/vitest'

import { quietWave, withDareThings } from '../../../test/model.fixture'
import { APPLICATION, measureSurface } from '../../../test/testing'
import { DareThingState } from '../../../world/dare/dareSchema'

// The HUD's dare list as a button (src/screens/game/dareListButton.ts): a
// click or tap opens the dare card again, and the same button, renamed,
// puts it away.

const hunting = withDareThings(quietWave(3), [
  {
    id: 0,
    kind: 'MusicBox',
    state: DareThingState.Hidden({ x: 40, y: 40, workedMs: 0 }),
  },
])

const openButton = Scene.role('button', { name: 'Open the dare card' })
const awayButton = Scene.role('button', { name: 'Put the dare card away' })

describe("the HUD's dare list", () => {
  it.effect('opens the dare card and puts it away', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(hunting),
      measureSurface,
      Scene.click(openButton),
      Scene.expect(awayButton).toExist(),
      Scene.click(awayButton),
      Scene.expect(openButton).toExist(),
    ),
  )

  it.effect('is no button in a run with no list', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(withDareThings(quietWave(3), [])),
      measureSurface,
      Scene.expect(openButton).toBeAbsent(),
    ),
  )
})
