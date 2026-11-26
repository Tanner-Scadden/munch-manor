import { Effect } from 'effect'

import { UiStruct } from '@effect/ui'
import { HtmlLocator } from '@effect/ui/html/testing'
import { Locator } from '@effect/ui/testing'
import { describe, it } from '@effect/vitest'

import type { Model } from '../../../app/model'
import { initialModel } from '../../../app/pureApp'
import {
  ackHudSlots,
  measureSurface,
  pauseButton,
  readDareCardByTapInScene,
  startIntoIntroInScene,
  statusLine,
  throughIntroByTapInScene,
  withAttrs,
} from '../../../test/sceneTesting'
import { sceneOf } from '../../../test/testing'
import { asVeteran } from '../../../test/veteran'

const ARRIVING_STATUS = 'Arriving at the manor. Press any key or tap to skip.'
const startWave = HtmlLocator.role('button', { name: 'Start wave 1 now' })

const moveStick: Locator.Locator = withAttrs({ 'data-stick': 'move' })({
  description: 'any element',
  all: root => Locator.elements(root),
})

const onTouch: Model = UiStruct.evolve(asVeteran(initialModel), {
  lastDevice: () => 'Touch',
})

describe('the intro on screen', () => {
  it.effect('shows no HUD or buttons, and a tap skips to the slam', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(onTouch)
      s.pipe(measureSurface, startIntoIntroInScene)
        .expect(statusLine)
        .toHaveText(ARRIVING_STATUS)
        .expect(pauseButton)
        .toBeAbsent()
        .expect(startWave)
        .toBeAbsent()
        .expect(moveStick)
        .toBeAbsent()
        .pipe(throughIntroByTapInScene, readDareCardByTapInScene, ackHudSlots)
        .expect(statusLine)
        .toHaveText(/Get ready for wave 1\./)
        .expect(pauseButton)
        .toExist()
        .expect(startWave)
        .toExist()
    }),
  )
})
