import { Effect } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, it } from '@effect/vitest'

import { Life, type Model } from '../../../app/model'
import {
  crewInWave,
  pipeline,
  placeSeat,
  withSeatLife,
} from '../../../test/model.fixture'
import { byClass, expectAttr, measureHud } from '../../../test/sceneTesting'
import { sceneOf } from '../../../test/testing'
import { MEDIC_RULES } from '../medic'
import { COOP_RULES } from '../party'

// The MEDIC button (src/screens/game/touchControls.ts): a red cross over the touch row
// for your own downed player, and only then. A tap shouts, and the button
// glows while the shout rings.

const medicButton = byClass('medic-button')

const onTouch = (base: Model): Model =>
  UiStruct.evolve(base, { lastDevice: () => 'Touch' })

const fighting = pipeline(
  placeSeat(0, 60, 104),
  placeSeat(1, 240, 104),
  onTouch,
)(crewInWave(2))

const downedLead = (callMs: number) =>
  withSeatLife(
    0,
    Life.Downed({ bleedMs: COOP_RULES.bleedOutMs, reviveMs: 0, callMs }),
  )(fighting)

describe('the MEDIC button', () => {
  it.effect(
    'is not there while you stand, nor for a teammate who is down',
    () =>
      Effect.gen(function* () {
        const s = yield* sceneOf(
          withSeatLife(
            1,
            Life.Downed({
              bleedMs: COOP_RULES.bleedOutMs,
              reviveMs: 0,
              callMs: 0,
            }),
          )(fighting),
        )
        s.pipe(measureHud).expect(medicButton).toBeAbsent()
      }),
  )

  it.effect('shows while you are down, and a tap shouts MEDIC!', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(downedLead(MEDIC_RULES.cooldownMs))
      s.pipe(measureHud).expect(medicButton).toExist()
      s.pipe(
        expectAttr(medicButton, 'aria-label', 'MEDIC!'),
        expectAttr(medicButton, 'data-fresh', 'false'),
      ).click(medicButton)
      s.pipe(expectAttr(medicButton, 'data-fresh', 'true'))
    }),
  )
})
