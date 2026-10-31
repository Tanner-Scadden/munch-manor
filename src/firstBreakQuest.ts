import { Array, Option, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { levelOf } from './arena'
import { Tour } from './clientSchema'
import { isPending } from './lessons'
import type { Model } from './model'
import { isCoop } from './party'
import { isBrowsing, isShopOpenFor } from './shop'
import { barricadedDoors } from './traps'
import { type DoorId, TrapHint, type Vector } from './worldSchema'

// NOTE: the guided first break, from playtesters who wanted the game to walk
// them to the shop after the first wave, as other games do. One step at a
// time, each taught at the spot where it happens, with a little tracker in
// a corner: walk to Rattles' stall, buy a Plank Pile (free this once, see
// isFirstPlankFree in src/shop.ts), and place it in a doorway. Then START
// WAVE pulses and the tracker ticks off and fades.
//
// It runs once per save: it starts only in a break where the shop is open
// while the shop lesson is still pending and no trap was ever bought, both
// already saved, so a player who has shopped before never sees it and a
// tutorial reset brings it back. Never in co-op. It is skippable: the
// tracker's skip button, or starting the wave, ends it.
export type QuestStep = 'Shop' | 'Buy' | 'Place'

export const QUEST_STEPS: Array.NonEmptyReadonlyArray<QuestStep> = [
  'Shop',
  'Buy',
  'Place',
]

const QUEST_DONE_MS = 2600

const isQuestBreak = (model: Model): boolean =>
  isShopOpenFor(model.phase) && !isCoop(model)

const isQuestDue = (model: Model): boolean =>
  isQuestBreak(model) &&
  isPending(model.lessons.shop) &&
  TrapHint.isAnyOf(['Unseen'])(model.trapHint)

export const questStepOf = (model: Model): Option.Option<QuestStep> => {
  if (!Tour.isAnyOf(['Running'])(model.firstBreakQuest)) {
    return Option.none()
  } else if (TrapHint.isAnyOf(['Showing'])(model.trapHint)) {
    return Option.some('Place')
  } else if (isBrowsing(model.shop)) {
    return Option.some('Buy')
  } else {
    return Option.some('Shop')
  }
}

export const isQuestDone = (model: Model): boolean =>
  Tour.isAnyOf(['Done'])(model.firstBreakQuest)

// NOTE: one frame of the quest: it starts once its break comes, finishes
// once the Plank Pile is placed, ends if the wave starts first, and its
// tick fades after a moment.
export const advanceQuest = (model: Model, deltaMs: number): Model =>
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
  })

export const endQuest = (model: Model): Model =>
  Tour.isAnyOf(['Over'])(model.firstBreakQuest)
    ? model
    : modifyFields(model, { firstBreakQuest: () => Tour.Over() })

// NOTE: in the Place step an arrow bobs over the nearest open doorway, the
// sensible spot for the Plank Pile.
export const maybeQuestDoor = (model: Model): Option.Option<Vector> => {
  if (!Option.contains(questStepOf(model), 'Place')) {
    return Option.none()
  }
  const level = levelOf(model)
  const boarded = barricadedDoors(model.traps)
  return pipe(
    level.doorIds,
    Array.filter((door: DoorId) => !Array.contains(boarded, door)),
    Array.map(door => level.doors[door].center),
    Array.sort((first: Vector, second: Vector) =>
      Math.hypot(first.x - model.player.x, first.y - model.player.y) -
        Math.hypot(second.x - model.player.x, second.y - model.player.y) <
      0
        ? -1
        : 1,
    ),
    Array.head,
  )
}
