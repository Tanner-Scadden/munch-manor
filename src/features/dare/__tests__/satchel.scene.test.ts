import { Effect } from 'effect'

import { HtmlLocator } from '@effect/ui/html/testing'
import { describe, it } from '@effect/vitest'

import { quietWave, withDareThings } from '#test/model.fixture.ts'
import { ackHudSlots, measureHud } from '#test/sceneTesting.ts'
import { sceneOf } from '#test/testing.ts'
import { DareThingState } from '#world/dare/dareSchema.ts'

const hunting = withDareThings(quietWave(3), [
  {
    id: 0,
    kind: 'MusicBox',
    state: DareThingState.Hidden({ x: 40, y: 40, workedMs: 0 }),
  },
])

const openButton = HtmlLocator.role('button', { name: 'Open the dare card' })
const awayButton = HtmlLocator.role('button', {
  name: 'Put the dare card away',
})

describe("the HUD's dare list", () => {
  it.effect('opens the dare card and puts it away', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(hunting)
      s.pipe(measureHud)
        .click(openButton)
        .expect(awayButton)
        .toExist()
        .click(awayButton)
        .pipe(ackHudSlots)
        .expect(openButton)
        .toExist()
    }),
  )

  it.effect('is no button in a run with no list', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(withDareThings(quietWave(3), []))
      s.pipe(measureHud).expect(openButton).toBeAbsent()
    }),
  )
})
