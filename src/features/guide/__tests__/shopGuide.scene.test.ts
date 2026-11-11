import { Scene } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, it } from '@effect/vitest'

import { type Model } from '../../../app/model'
import { home } from '../../../test/model.fixture'
import {
  APPLICATION,
  measureSurface,
  munchopediaDialog,
  openHandInScene,
  pickCardInScene,
} from '../../../test/testing'
import { EXIT_RULES } from '../../../world/level/exits'
import { SHOP_GUIDE_NAME } from '../../../world/names'
import { Message as GuideMessage } from '../message'
import { prizeUnlockId } from '../shopGuide'
import { FocusGuideControl } from '../steps'

// The guide to the house's finds, on the Munchopedia's Finds page. Rattles'
// shop, and the ? that opened the guide in it, went with the shop
// (docs/ESCAPE_PLAN.md, layer 7).

const guide = Scene.selector('.sg')
const findsTile = Scene.role('button', {
  name: new RegExp(`^${SHOP_GUIDE_NAME},`),
})
const resolveFocusGuide = Scene.Command.resolve(
  FocusGuideControl,
  GuideMessage.CompletedFocusControl(),
)

// NOTE: the Munchopedia open from the MANOR hand, on its Finds page.
const openFinds = () => [
  ...openHandInScene(),
  ...pickCardInScene(/^Munchopedia:/),
  Scene.inside(munchopediaDialog, Scene.click(findsTile)),
  resolveFocusGuide,
]

describe('the Munchopedia Finds page', () => {
  it.effect(
    'the Finds tile opens the guide, sections switch, and Back returns to the zombies',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(home),
        measureSurface,
        ...openFinds(),
        Scene.inside(
          munchopediaDialog,
          Scene.expect(guide).toExist(),
          Scene.expect(Scene.selector("[data-entry='Pistol']")).toExist(),
          Scene.click(Scene.role('button', { name: 'House' })),
          Scene.expect(Scene.selector("[data-entry='Boards']")).toExist(),
          Scene.expect(Scene.selector("[data-entry='Rattles']")).toExist(),
          Scene.expect(Scene.text(`${EXIT_RULES.kitchenKeys} keys`)).toExist(),
          Scene.expect(Scene.selector("[data-entry='Pistol']")).toBeAbsent(),
          Scene.click(
            Scene.role('button', { name: 'Back to the Munchopedia' }),
          ),
        ),
        resolveFocusGuide,
        Scene.inside(
          munchopediaDialog,
          Scene.expect(guide).toBeAbsent(),
          Scene.expect(findsTile).toExist(),
        ),
      ),
  )

  it.effect('a gun shows its bars and its ladder of kills', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(home),
      measureSurface,
      ...openFinds(),
      Scene.inside(
        Scene.selector("[data-entry='Shotgun']"),
        Scene.expect(Scene.selector('.sg-name')).toExist(),
        Scene.expect(Scene.role('img', { name: /^Power \d of 5/ })).toExist(),
        Scene.expectAll(Scene.all.selector('.sg-step')).toHaveCount(3),
      ),
    ),
  )

  it.effect(
    'the fridge shows ??? until a prize is pulled, then its card fills in',
    () => {
      const pulled: Model = modifyFields(home, {
        seenUnlocks: () => [prizeUnlockId('Freeze')],
      })
      return Scene.scene(
        APPLICATION,
        Scene.given(pulled),
        measureSurface,
        ...openFinds(),
        Scene.click(Scene.role('button', { name: 'Fridge' })),
        Scene.expectAll(
          Scene.all.selector("[data-known='Unknown']"),
        ).toHaveCount(4),
        Scene.expectAll(Scene.all.selector("[data-known='Known']")).toHaveCount(
          1,
        ),
        Scene.inside(
          Scene.selector("[data-entry='Freeze']"),
          Scene.expect(Scene.selector('.sg-bars')).toExist(),
        ),
        Scene.inside(
          Scene.selector("[data-entry='Cooker']"),
          Scene.expect(Scene.selector('.sg-bars')).toBeAbsent(),
          Scene.expect(Scene.text('???')).toExist(),
        ),
      )
    },
  )
})
