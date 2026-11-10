import { Array, Function, Option, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import type { Model } from '../../app/model'
import { ClocheLift } from '../../domain/clientSchema'
import { levelOf } from '../../world/level/arena'
import { exitBoxOf } from '../../world/level/exits'
import { slotOfExit } from '../../world/level/plan'
import type { World } from '../../world/schema/world'

// The cloche reveal: the room behind each of the house's three slots rolls
// every run, so the boards keep it a secret. When a slot's boards come
// down, a silver cloche over the doorway rattles, lifts, and shows the
// room's icon: a hearth for the parlour, a book for the library, a bottle
// for the cellar. It is read off the level's open exits, so a co-op
// teammate sees the same reveal from the room's World, and nothing here
// changes the game.

type ClocheRules = Readonly<{
  rattleMs: number
  liftMs: number
  holdMs: number
  fadeMs: number
}>

export const CLOCHE_RULES: ClocheRules = {
  rattleMs: 220,
  liftMs: 420,
  holdMs: 900,
  fadeMs: 320,
}

export const CLOCHE_TOTAL_MS =
  CLOCHE_RULES.rattleMs +
  CLOCHE_RULES.liftMs +
  CLOCHE_RULES.holdMs +
  CLOCHE_RULES.fadeMs

// NOTE: a slot's boards came down this frame: its cloche starts to lift
// over the doorway's middle. The kitchen's boards and the secret shelf open
// no slot, so they raise none.
export const raiseCloche: {
  (after: Model): (before: World) => Model
  (before: World, after: Model): Model
} = Function.dual(2, (before: World, after: Model): Model =>
  after.level.openExits.length === before.level.openExits.length
    ? after
    : pipe(
        Array.findLast(
          after.level.openExits,
          exit => !Array.contains(before.level.openExits, exit),
        ),
        Option.flatMap(exit =>
          Option.all({
            slot: slotOfExit(exit),
            box: exitBoxOf(levelOf(after), exit),
          }),
        ),
        Option.match({
          onNone: () => after,
          onSome: ({ slot, box }) =>
            modifyFields(after, {
              clocheLift: () =>
                ClocheLift.Lifting({
                  room: after.level.arrangement[slot],
                  at: {
                    x: Math.round((box.left + box.right) / 2),
                    y: Math.round((box.top + box.bottom) / 2),
                  },
                  ageMs: 0,
                }),
            }),
        }),
      ),
)

export const ageCloche: {
  (frameMs: number): (model: Model) => Model
  (model: Model, frameMs: number): Model
} = Function.dual(2, (model: Model, frameMs: number): Model =>
  ClocheLift.match(model.clocheLift, {
    Resting: () => model,
    Lifting: lift =>
      modifyFields(model, {
        clocheLift: () =>
          lift.ageMs + frameMs >= CLOCHE_TOTAL_MS
            ? ClocheLift.Resting()
            : ClocheLift.Lifting({ ...lift, ageMs: lift.ageMs + frameMs }),
      }),
  }),
)
