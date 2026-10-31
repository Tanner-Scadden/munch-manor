import { Option } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { levelOf } from './arena'
import { Tour } from './clientSchema'
import { KITCHEN_EXIT, exitBoxOf } from './exits'
import { isKitchenOpen } from './kitchen'
import { fridgeBoxOf, fridgeSpot } from './leftovers'
import { learnTimedBreaks } from './lessons'
import type { Model } from './model'
import { isFridgeTried, isKitchenTourOn } from './tutorialRules'
import { withWorld } from './world'
import { FridgeDoor, type Vector } from './worldSchema'

// NOTE: chapter 2 of the guided tutorial, from the owner (2026-10-30): in a
// new save's first timed break, when the kitchen's boards first go on
// sale, the break clock holds still and the game walks the player through
// the kitchen and the Mystery Leftovers fridge, each step at its spot. Buy
// the boards (free), pull the fridge (free, and always a weapon), then take
// the prize or leave it. Once the fridge has been tried the clock runs on,
// the tracker ticks off and fades. The rules that change the game (the held
// clock, the free boards and pull, the weapon) are the World's, in
// src/tutorialRules.ts; this is the client's tracker and markers.
//
// It runs once per save: it is on only while the timed breaks lesson is
// pending, which is learned when that break ends and saved, so a tutorial
// reset brings it back. Never in co-op. The tracker's skip button learns
// the lesson at once, which ends it and lets the clock run.
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

export const advanceKitchenTour = (model: Model, deltaMs: number): Model =>
  Tour.match(model.kitchenTour, {
    Waiting: () =>
      isKitchenTourOn(model)
        ? modifyFields(model, { kitchenTour: () => Tour.Running() })
        : model,
    Running: () => {
      if (isFridgeTried(model)) {
        return modifyFields(model, {
          kitchenTour: () => Tour.Done({ ageMs: 0 }),
        })
      } else if (!isKitchenTourOn(model)) {
        return modifyFields(model, { kitchenTour: () => Tour.Over() })
      } else {
        return model
      }
    },
    Done: ({ ageMs }) =>
      modifyFields(model, {
        kitchenTour: () =>
          ageMs + deltaMs >= KITCHEN_DONE_MS
            ? Tour.Over()
            : Tour.Done({ ageMs: ageMs + deltaMs }),
      }),
    Over: () => model,
  })

// NOTE: skipping learns the timed breaks lesson, which ends the tour's
// rules in the World: the clock runs and prices are back.
export const skipKitchenTour = (model: Model): Model =>
  modifyFields(withWorld(model, learnTimedBreaks), {
    kitchenTour: () => Tour.Over(),
  })

// NOTE: where the step's marker points: the boards, then the fridge. While
// the prize floats the TAKE ring and the choice bubble do the teaching.
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
