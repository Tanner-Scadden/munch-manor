import { Option } from 'effect'
import { Scene } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, it } from '@effect/vitest'

import { type Arsenal, type Model, Phase } from '../../../app/model'
import { initialModel } from '../../../app/pureApp'
import { PREPARATION_MS } from '../../../shared/constants'
import {
  APPLICATION,
  holdingSecond,
  measureSurface,
  walkIntoStallInScene,
} from '../../../test/testing'
import { modifyFocus } from '../../../world/party/party'

const atStall = (balance: number, arsenal: Arsenal): Model =>
  modifyFocus(
    modifyFields(initialModel, {
      maybeSurface: () =>
        Option.some({ left: 0, top: 0, width: 800, height: 400 }),
      phase: () =>
        Phase.Preparation({
          wave: 4,
          remainingMs: 15_000,
          durationMs: PREPARATION_MS,
          spawns: [
            {
              atMs: 1e9,
              kind: 'Shambler',
              door: 'North',
              offset: 0,
              speedScale: 1,
              hpScale: 1,
              pack: 0,
              formation: 'Squad',
            },
          ],
        }),
    }),
    {
      player: player =>
        modifyFields(player, {
          x: () => 270,
          y: () => 142,
          hp: () => 3,
          arsenal: () => arsenal,
        }),
      wallet: () => ({ balance, earned: balance, shown: balance }),
    },
  )

const holdingSmg = (tier: number, kills: number = 0): Arsenal =>
  holdingSecond({ kind: 'Smg', loaded: 30, tier, kills })

const keeper = Scene.role('img', { name: /^Rattles the skeleton/ })

describe('the shop at a glance', () => {
  it.effect(
    "a gun card shows its tier, and the next tier's pip fills with its kills",
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(atStall(180, holdingSmg(1, 80))),
        measureSurface,
        ...walkIntoStallInScene(),
        Scene.expect(Scene.role('img', { name: 'Tier 1 of 3' })).toExist(),
        Scene.expect(
          Scene.selector('.shop-gun[data-held="true"] .shop-pip-fill'),
        ).toHaveStyle('width', '50%'),
        Scene.expect(
          Scene.selector('.shop-gun[data-held="true"] .shop-pip.is-filled'),
        ).toExist(),
      ),
  )

  it.effect('a player with nothing to buy gets a sad hello', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(atStall(5, holdingSmg(1))),
      measureSurface,
      ...walkIntoStallInScene(),
      Scene.expect(keeper).toHaveAttr('data-mood', 'Sad'),
    ),
  )
})

