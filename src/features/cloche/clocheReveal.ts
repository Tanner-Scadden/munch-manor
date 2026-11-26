import { Array, Function, Option, pipe } from 'effect'

import { UiStruct } from '@effect/ui'

import type { Model } from '../../app/model'
import { ClocheLift } from '../../domain/clientSchema'
import { levelOf } from '../../world/level/arena'
import { exitBoxOf } from '../../world/level/exits'
import { slotOfExit } from '../../world/level/plan'
import type { World } from '../../world/schema/world'

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
            UiStruct.evolve(after, {
              cosmetics: cosmetics =>
                UiStruct.evolve(cosmetics, {
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
        }),
      ),
)

export const ageCloche: {
  (frameMs: number): (model: Model) => Model
  (model: Model, frameMs: number): Model
} = Function.dual(2, (model: Model, frameMs: number): Model =>
  ClocheLift.match(model.cosmetics.clocheLift, {
    Resting: () => model,
    Lifting: lift =>
      UiStruct.evolve(model, {
        cosmetics: cosmetics =>
          UiStruct.evolve(cosmetics, {
            clocheLift: () =>
              lift.ageMs + frameMs >= CLOCHE_TOTAL_MS
                ? ClocheLift.Resting()
                : ClocheLift.Lifting({ ...lift, ageMs: lift.ageMs + frameMs }),
          }),
      }),
  }),
)
