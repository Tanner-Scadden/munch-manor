import { Function, Option } from 'effect'

import { UiStruct } from '@effect/ui'

import type { Model } from '#app/model.ts'
import { Tour } from '#domain/clientSchema.ts'
import { fridgeBoxOf, fridgeSpot } from '#world/fridge/leftovers.ts'
import { isKitchenOpen } from '#world/kitchen/kitchen.ts'
import { levelOf } from '#world/level/arena.ts'
import { KITCHEN_EXIT, exitBoxOf } from '#world/level/exits.ts'
import { learnTimedBreaks } from '#world/run/lessons.ts'
import { isFridgeTried, isKitchenTourOn } from '#world/run/tutorialRules.ts'
import { withWorld } from '#world/schema/world.ts'
import { FridgeDoor, type Vector } from '#world/schema/worldSchema.ts'

export type KitchenStep = 'Boards' | 'Fridge' | 'Choose'

const KITCHEN_DONE_MS = 2600

export const kitchenStepOf = (model: Model): Option.Option<KitchenStep> => {
  if (!Tour.isAnyOf(['Running'])(model.kitchenTour)) {
    return Option.none()
  } else if (!isKitchenOpen(levelOf(model))) {
    return Option.some('Boards')
  } else if (FridgeDoor.isAnyOf(['Open', 'Offering'])(model.fridge.door)) {
    return Option.some('Choose')
  } else {
    return Option.some('Fridge')
  }
}

export const advanceKitchenTour: {
  (deltaMs: number): (model: Model) => Model
  (model: Model, deltaMs: number): Model
} = Function.dual(2, (model: Model, deltaMs: number): Model =>
  Tour.match(model.kitchenTour, {
    Waiting: () =>
      isKitchenTourOn(model)
        ? UiStruct.evolve(model, { kitchenTour: () => Tour.Running() })
        : model,
    Running: () => {
      if (isFridgeTried(model)) {
        return UiStruct.evolve(model, {
          kitchenTour: () => Tour.Done({ ageMs: 0 }),
        })
      } else if (!isKitchenTourOn(model)) {
        return UiStruct.evolve(model, { kitchenTour: () => Tour.Over() })
      } else {
        return model
      }
    },
    Done: ({ ageMs }) =>
      UiStruct.evolve(model, {
        kitchenTour: () =>
          ageMs + deltaMs >= KITCHEN_DONE_MS
            ? Tour.Over()
            : Tour.Done({ ageMs: ageMs + deltaMs }),
      }),
    Over: () => model,
  }),
)

export const skipKitchenTour = (model: Model): Model =>
  UiStruct.evolve(withWorld(model, learnTimedBreaks), {
    kitchenTour: () => Tour.Over(),
  })

export const maybeKitchenMark = (model: Model): Option.Option<Vector> =>
  Option.flatMap(kitchenStepOf(model), step => {
    const level = levelOf(model)
    if (step === 'Boards') {
      return Option.map(exitBoxOf(level, KITCHEN_EXIT), box => ({
        x: Math.round((box.left + box.right) / 2),
        y: box.top,
      }))
    } else if (step === 'Fridge') {
      return Option.map(fridgeBoxOf(level), fridgeSpot)
    } else {
      return Option.none()
    }
  })
