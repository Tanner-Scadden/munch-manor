import { Scene } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, it } from '@effect/vitest'

import { home, knowingDay } from '../../../test/model.fixture'
import {
  APPLICATION,
  measureSurface,
  openHandInScene,
  pickCardInScene,
} from '../../../test/testing'
import { DARE_LINES } from '../../../world/names'
import { SLOT_COUNT } from '../proof'

// The Proof Shelf in its panel: opened from the MANOR hand's PROOF card, a
// slot per thing per difficulty, the found ones filled, and a tapped slot's
// stamp and line in the card beside the shelf.

const TODAY = '2026-11-13'

const shelved = modifyFields(knowingDay(home, TODAY), {
  proof: () => [
    {
      thing: 'SilverSpoon',
      difficulty: 'Hard',
      stamp: {
        wave: 7,
        hero: 'You',
        crew: [{ name: 'GIZMO', isBot: true }],
        day: TODAY,
        ending: 'Munched',
      },
    },
  ],
})

const panel = Scene.role('dialog', { name: 'Proof' })

const spoonSlot = Scene.role('button', { name: /^Silver Spoon, Triple Dare:/ })

describe('the Proof Shelf panel', () => {
  it.effect(
    'opens from the PROOF card with every slot, and a tap shows its stamp',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(shelved),
        measureSurface,
        ...openHandInScene(),
        ...pickCardInScene(/^Proof:/),
        Scene.inside(
          panel,
          Scene.expectAll(Scene.all.selector('.proof-slot')).toHaveCount(
            SLOT_COUNT,
          ),
          Scene.expectAll(
            Scene.all.selector(".proof-slot[data-filled='true']"),
          ).toHaveCount(1),
          Scene.expect(Scene.selector('.proof-new')).toExist(),
          Scene.expect(Scene.text(`1/${SLOT_COUNT}`)).toExist(),
          Scene.click(spoonSlot),
          Scene.expect(Scene.text('MUNCHED')).toExist(),
          Scene.expect(Scene.text('WAVE 7')).toExist(),
          Scene.expect(Scene.text('GIZMO')).toExist(),
          Scene.expect(Scene.text('NOV 13')).toExist(),
          Scene.expect(Scene.text(DARE_LINES.SilverSpoon)).toExist(),
        ),
      ),
  )
})
