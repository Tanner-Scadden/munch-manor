import { Scene } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, it } from '@effect/vitest'

import type { Model } from '../../../app/model'
import { initialModel } from '../../../app/pureApp'
import {
  APPLICATION,
  measureSurface,
  pauseButton,
  startIntoIntroInScene,
  throughIntroByTapInScene,
} from '../../../test/testing'
import { asVeteran } from '../../../test/veteran'

// The intro on screen (src/features/intro/introView.ts): nothing of the
// run's HUD or its buttons while the crew arrives, a tap skips to the slam,
// and the run's first break comes up after it.

const ARRIVING_STATUS = 'Arriving at the manor. Press any key or tap to skip.'
const status = Scene.role('status')
const startWave = Scene.role('button', { name: 'Start wave 1 now' })

const onTouch: Model = modifyFields(asVeteran(initialModel), {
  lastDevice: () => 'Touch',
})

describe('the intro on screen', () => {
  it.effect('shows no HUD or buttons, and a tap skips to the slam', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(onTouch),
      measureSurface,
      ...startIntoIntroInScene(),
      Scene.expect(status).toHaveText(ARRIVING_STATUS),
      Scene.expect(pauseButton).toBeAbsent(),
      Scene.expect(startWave).toBeAbsent(),
      Scene.expect(Scene.selector('[data-stick="move"]')).toBeAbsent(),
      ...throughIntroByTapInScene(),
      Scene.expect(status).toContainText('Get ready for wave 1 of 10.'),
      Scene.expect(pauseButton).toExist(),
      Scene.expect(startWave).toExist(),
    ),
  )
})
