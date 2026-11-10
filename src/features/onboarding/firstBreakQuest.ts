import { Array, Function, Option, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import type { Model } from '../../app/model'
import { Tour } from '../../domain/clientSchema'
import { areCratesOpen, crateSpotOf } from '../../world/gear/crates'
import { barricadedDoors } from '../../world/gear/traps'
import { levelOf } from '../../world/level/arena'
import { focusOf, isCoop } from '../../world/party/party'
import { isPending } from '../../world/run/lessons'
import {
  type DoorId,
  TrapHint,
  type Vector,
} from '../../world/schema/worldSchema'

// NOTE: the guided first break, from playtesters who wanted the game to walk
// them through the first break, as other games do. One step at a time, each
// taught at the spot where it happens, with a little tracker in a corner:
// grab the Plank Pile from the dining room's trap crate (in this break it
// always holds one, see src/world/gear/crates.ts), and place it in a doorway. Then
// START WAVE pulses and the tracker ticks off and fades. A later layer of
// docs/ESCAPE_PLAN.md rewrites the tutorial.
//
// It runs once per save: it starts only in the first break with a trap
// crate open while the open break lesson is still pending and no trap was
// ever placed, all saved, so a player who has played past it, or who
// skipped the tutorial on the first-run card, never sees it and a tutorial
// reset brings it back. (The saved shop lesson gated it too, until the shop
// went in docs/ESCAPE_PLAN.md layer 7; it is kept in the save, unread.) Never in co-op. It is skippable: the
// tracker's skip button, or starting the wave, ends it.
export type QuestStep = 'Grab' | 'Place'

export const QUEST_STEPS: Array.NonEmptyReadonlyArray<QuestStep> = [
  'Grab',
  'Place',
]

const QUEST_DONE_MS = 2600

const isQuestBreak = (model: Model): boolean =>
  areCratesOpen(model) && !isCoop(model)

const isQuestDue = (model: Model): boolean =>
  isQuestBreak(model) &&
  isPending(model.lessons.openBreak) &&
  TrapHint.isAnyOf(['Unseen'])(model.trapHint)

export const questStepOf = (model: Model): Option.Option<QuestStep> => {
  if (!Tour.isAnyOf(['Running'])(model.firstBreakQuest)) {
    return Option.none()
  } else if (TrapHint.isAnyOf(['Showing'])(model.trapHint)) {
    return Option.some('Place')
  } else {
    return Option.some('Grab')
  }
}

export const isQuestDone = (model: Model): boolean =>
  Tour.isAnyOf(['Done'])(model.firstBreakQuest)

// NOTE: one frame of the quest: it starts once its break comes, finishes
// once the Plank Pile is placed, ends if the wave starts first, and its
// tick fades after a moment.
export const advanceQuest: {
  (deltaMs: number): (model: Model) => Model
  (model: Model, deltaMs: number): Model
} = Function.dual(2, (model: Model, deltaMs: number): Model =>
  Tour.match(model.firstBreakQuest, {
    Waiting: () =>
      isQuestDue(model)
        ? modifyFields(model, {
            firstBreakQuest: () => Tour.Running(),
          })
        : model,
    Running: () => {
      if (TrapHint.isAnyOf(['Seen'])(model.trapHint)) {
        return modifyFields(model, {
          firstBreakQuest: () => Tour.Done({ ageMs: 0 }),
        })
      } else if (!isQuestBreak(model)) {
        return endQuest(model)
      } else {
        return model
      }
    },
    Done: ({ ageMs }) =>
      modifyFields(model, {
        firstBreakQuest: () =>
          ageMs + deltaMs >= QUEST_DONE_MS
            ? Tour.Over()
            : Tour.Done({ ageMs: ageMs + deltaMs }),
      }),
    Over: () => model,
  }),
)

export const endQuest = (model: Model): Model =>
  Tour.isAnyOf(['Over'])(model.firstBreakQuest)
    ? model
    : modifyFields(model, { firstBreakQuest: () => Tour.Over() })

// NOTE: an arrow bobs over where the step happens: the dining room's crate to
// grab from, then the nearest open doorway, the sensible spot for the Plank
// Pile.
export const maybeQuestMark = (model: Model): Option.Option<Vector> =>
  Option.flatMap(questStepOf(model), step =>
    step === 'Grab'
      ? Option.some(crateSpotOf(levelOf(model), 'Dining'))
      : maybeQuestDoor(model),
  )

const maybeQuestDoor = (model: Model): Option.Option<Vector> => {
  const level = levelOf(model)
  const boarded = barricadedDoors(model.traps)
  return pipe(
    level.doorIds,
    Array.filter((door: DoorId) => !Array.contains(boarded, door)),
    Array.map(door => level.doors[door].center),
    Array.sort((first: Vector, second: Vector) =>
      Math.hypot(
        first.x - focusOf(model).player.x,
        first.y - focusOf(model).player.y,
      ) -
        Math.hypot(
          second.x - focusOf(model).player.x,
          second.y - focusOf(model).player.y,
        ) <
      0
        ? -1
        : 1,
    ),
    Array.head,
  )
}
