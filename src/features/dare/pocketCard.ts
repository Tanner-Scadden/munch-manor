import { Function } from 'effect'
import { modifyFields } from 'foldkit/struct'

import type { Model } from '../../app/model'
import { PocketCard } from '../../domain/clientSchema'
import { isRunOn } from '../../domain/onlineRun'
import { dareCardOf } from '../../world/dare/dare'
import { Phase } from '../../world/schema/worldSchema'

// The dare card in your pocket (LORE.md, "The dare card in your pocket"):
// once the doors slam, the card your friends wrote opens over the screen,
// this run's list in their scrawl, and then folds itself into the HUD's
// dare card (src/features/dare/dareCard.ts), its pictures flying into their
// outlines. Endless ("stay the night") has no list, so no card. It is the
// client's own: alone the first break waits under it until it is read (a
// key, a tap, or a few seconds), as the new zombie card holds a wave; in
// co-op the room never waits, and the card is drawn over the first break.

// NOTE: the card rises out of your pocket and unfolds in UNFOLD_MS, the
// scrawl writes itself on, and it folds away on its own at READ_MS.
export const UNFOLD_MS = 400
export const READ_MS = 4_500
export const FOLD_MS = 700

export const isPocketCardReading = (model: Model): boolean =>
  PocketCard.isAnyOf(['Reading'])(model.pocketCard)

// NOTE: alone the first break waits while the card is read. The fold plays
// over the running break, so a key that folds it gives the player back at
// once.
export const isPocketCardBlocking = (model: Model): boolean =>
  isPocketCardReading(model) &&
  Phase.isAnyOf(['Preparation'])(model.phase) &&
  !isRunOn(model)

// NOTE: the slam ends the intro: the card comes out if the run has a list.
export const raisePocketCardFrom: {
  (after: Model): (before: Model) => Model
  (before: Model, after: Model): Model
} = Function.dual(2, (before: Model, after: Model): Model =>
  Phase.isAnyOf(['Arriving'])(before.phase) &&
  !Phase.isAnyOf(['Arriving'])(after.phase) &&
  dareCardOf(after).length > 0
    ? modifyFields(after, {
        pocketCard: () => PocketCard.Reading({ ageMs: 0 }),
      })
    : after,
)

// NOTE: any key or tap folds it once it has opened.
export const foldPocketCard = (model: Model): Model =>
  PocketCard.matchOrElse(
    model.pocketCard,
    {
      Reading: ({ ageMs }) =>
        ageMs < UNFOLD_MS
          ? model
          : modifyFields(model, {
              pocketCard: () => PocketCard.Folding({ ageMs: 0 }),
            }),
    },
    () => model,
  )

export const agePocketCard: {
  (deltaMs: number): (model: Model) => Model
  (model: Model, deltaMs: number): Model
} = Function.dual(2, (model: Model, deltaMs: number): Model =>
  PocketCard.match(model.pocketCard, {
    Pocketed: () => model,
    Reading: ({ ageMs }) =>
      modifyFields(model, {
        pocketCard: () =>
          ageMs + deltaMs >= READ_MS
            ? PocketCard.Folding({ ageMs: 0 })
            : PocketCard.Reading({ ageMs: ageMs + deltaMs }),
      }),
    Folding: ({ ageMs }) =>
      modifyFields(model, {
        pocketCard: () =>
          ageMs + deltaMs >= FOLD_MS
            ? PocketCard.Pocketed()
            : PocketCard.Folding({ ageMs: ageMs + deltaMs }),
      }),
  }),
)
