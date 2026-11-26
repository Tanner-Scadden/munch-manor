import { Effect } from 'effect'

import { UiStruct } from '@effect/ui'
import { HtmlLocator, HtmlScene } from '@effect/ui/html/testing'
import { Locator } from '@effect/ui/testing'
import { describe, it } from '@effect/vitest'

import { Message } from '../../../app/message'
import { HAND_DIALOG_ID, PANEL_DIALOG_ID } from '../../../domain/clientSchema'
import { openedThingsOf } from '../../../domain/journal'
import { home, knowingDay } from '../../../test/model.fixture'
import {
  byClass,
  measureSurface,
  openHandInScene,
  pickCardInScene,
  showDialog,
  withAttrs,
} from '../../../test/sceneTesting'
import { modelAfter, sceneOf, send } from '../../../test/testing'
import { DARE_LINES } from '../../../world/names'
import { ProofShelf } from '../block'
import { shelfThingsFor, slotCountOf } from '../proof'

const SLOT_COUNT = slotCountOf(shelfThingsFor([]))

// The Proof Shelf in its panel: opened from the MANOR hand's PROOF card, a
// slot per thing per difficulty, the found ones filled, and a tapped slot's
// stamp and line in the card beside the shelf. The shelf is a child
// component, a leaf in the root's Scene: its insides are drawn on their own
// from the props the root hands it.

const TODAY = '2026-11-13'

const shelved = UiStruct.evolve(knowingDay(home, TODAY), {
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

const panel = HtmlLocator.role('dialog', { name: 'Proof' })

const spoonSlot = HtmlLocator.role('button', {
  name: /^Silver Spoon, Triple Dare:/,
})

describe('the Proof Shelf panel', () => {
  it.effect(
    'opens from the PROOF card with every slot, and a tap shows its stamp',
    () =>
      Effect.gen(function* () {
        const root = yield* sceneOf(shelved)
        root
          .pipe(
            measureSurface,
            openHandInScene,
            showDialog(HAND_DIALOG_ID),
            pickCardInScene(/^Proof:/),
            showDialog(PANEL_DIALOG_ID),
          )
          .expect(panel)
          .toExist()
        // NOTE: the shelf as the panel draws it (src/app/dialogs.ts), from
        // the Model opening PROOF leaves, which marks the new slots fresh.
        const opened = yield* modelAfter(
          shelved,
          send(Message.ClickedProofButton()),
        )
        const shelf = yield* HtmlScene.make(
          ProofShelf,
          {
            proof: opened.proof,
            things: shelfThingsFor(openedThingsOf(opened)),
            stampedDays: opened.missions.stampedDays,
            maybeToday: opened.maybeToday,
            fresh: opened.freshUnlocks,
            dareMarks: opened.dareMarks,
          },
          { slots: h => ({ done: h.button('Done') }) },
        )
        shelf
          .expect(byClass('proof-slot'))
          .toHaveCount(SLOT_COUNT)
          .expect(withAttrs({ 'data-filled': 'true' })(byClass('proof-slot')))
          .toHaveCount(1)
          .expect(byClass('proof-new'))
          .toExist()
          .expect(Locator.text(`1/${SLOT_COUNT}`))
          .toExist()
          .click(spoonSlot)
          .expect(Locator.text('MUNCHED'))
          .toExist()
          .expect(Locator.text('WAVE 7'))
          .toExist()
          .expect(Locator.text('GIZMO'))
          .toExist()
          .expect(Locator.text('NOV 13'))
          .toExist()
          .expect(Locator.text(DARE_LINES.SilverSpoon))
          .toExist()
      }),
  )
})
