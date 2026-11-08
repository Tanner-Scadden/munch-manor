import { Scene } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, it } from '@effect/vitest'

import { Arsenal, type CarriedGun, type Model } from '../../../app/model'
import { fighting } from '../../../test/model.fixture'
import { APPLICATION, measureSurface } from '../../../test/testing'
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

const knifeSlot = Scene.selector('.gun-slot-button[data-slot="Melee"]')

describe('the knife when the guns run dry', () => {
  it.effect('the knife slot pulses once every gun is dry', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(onTouchWith(dry(freshGun('Shotgun')), dry(freshGun('Smg')))),
      measureSurface,
      Scene.expect(knifeSlot).toHaveAttr('data-out', 'true'),
    ),
  )

  it.effect('a gun with rounds left keeps the knife slot plain', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(onTouchWith(freshGun('Shotgun'), dry(freshGun('Smg')))),
      measureSurface,
      Scene.expect(knifeSlot).toHaveAttr('data-out', 'false'),
    ),
  )
})
