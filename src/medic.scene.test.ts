import { click, expect, given, scene, selector } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'

import { MEDIC_RULES } from './medic'
import { Life, type Model } from './model'
import { crewInWave, pipeline, placeSeat, withSeatLife } from './model.fixture'
import { COOP_RULES } from './party'
import { ROOT, measureSurface } from './testing'

// The MEDIC button (src/touchControls.ts): a red cross over the touch row
// for your own downed player, and only then. A tap shouts, and the button
// glows while the shout rings.

const medicButton = selector('.medic-button')

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
  test('is not there while you stand, nor for a teammate who is down', () => {
    scene(
      ROOT,
      given(
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
      expect(medicButton).toBeAbsent(),
    )
  })

  test('shows while you are down, and a tap shouts MEDIC!', () => {
    scene(
      ROOT,
      given(downedLead(MEDIC_RULES.cooldownMs)),
      measureSurface,
      expect(medicButton).toExist(),
      expect(medicButton).toHaveAttr('aria-label', 'MEDIC!'),
      expect(medicButton).toHaveAttr('data-fresh', 'false'),
      click(medicButton),
      expect(medicButton).toHaveAttr('data-fresh', 'true'),
    )
  })
})
