import { expect, given, scene, selector } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'

import { Arsenal, type CarriedGun, type Model } from '../../../app/model'
import { fighting } from '../../../test/model.fixture'
import { ROOT, measureSurface } from '../../../test/testing'
import { freshGun } from '../../../world/gear/weapons'
import { modifyFocus } from '../../../world/party/party'

// NOTE: with every gun dry, the knife's slot pulses: it is the way out, and
// the next pull draws it by itself.

const dry = (gun: CarriedGun): CarriedGun => ({ ...gun, rounds: 0, loaded: 0 })

const onTouchWith = (first: CarriedGun, second: CarriedGun): Model =>
  modifyFocus(modifyFields(fighting, { lastDevice: () => 'Touch' }), {
    player: player =>
      modifyFields(player, {
        arsenal: () => Arsenal.HoldingSecond({ first, second }),
      }),
  })

const knifeSlot = selector('.gun-slot-button[data-slot="Melee"]')

describe('the knife when the guns run dry', () => {
  test('the knife slot pulses once every gun is dry', () => {
    scene(
      ROOT,
      given(onTouchWith(dry(freshGun('Shotgun')), dry(freshGun('Smg')))),
      measureSurface,
      expect(knifeSlot).toHaveAttr('data-out', 'true'),
    )
  })

  test('a gun with rounds left keeps the knife slot plain', () => {
    scene(
      ROOT,
      given(onTouchWith(freshGun('Shotgun'), dry(freshGun('Smg')))),
      measureSurface,
      expect(knifeSlot).toHaveAttr('data-out', 'false'),
    )
  })
})
