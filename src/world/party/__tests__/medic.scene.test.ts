import { Scene } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, it } from '@effect/vitest'

import { Life, type Model } from '../../../app/model'
import {
  crewInWave,
  pipeline,
  placeSeat,
  withSeatLife,
} from '../../../test/model.fixture'
import { APPLICATION, measureSurface } from '../../../test/testing'
import { MEDIC_RULES } from '../medic'
import { COOP_RULES } from '../party'

// The MEDIC button (src/screens/game/touchControls.ts): a red cross over the touch row
// for your own downed player, and only then. A tap shouts, and the button
// glows while the shout rings.

const medicButton = Scene.selector('.medic-button')

const onTouch = (base: Model): Model =>
  modifyFields(base, { lastDevice: () => 'Touch' })

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
      Scene.scene(
        APPLICATION,
        Scene.given(
          withSeatLife(
            1,
            Life.Downed({
              bleedMs: COOP_RULES.bleedOutMs,
              reviveMs: 0,
              callMs: 0,
            }),
          )(fighting),
        ),
        measureSurface,
        Scene.expect(medicButton).toBeAbsent(),
      ),
  )

  it.effect('shows while you are down, and a tap shouts MEDIC!', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(downedLead(MEDIC_RULES.cooldownMs)),
      measureSurface,
      Scene.expect(medicButton).toExist(),
      Scene.expect(medicButton).toHaveAttr('aria-label', 'MEDIC!'),
      Scene.expect(medicButton).toHaveAttr('data-fresh', 'false'),
      Scene.click(medicButton),
      Scene.expect(medicButton).toHaveAttr('data-fresh', 'true'),
    ),
  )
})
