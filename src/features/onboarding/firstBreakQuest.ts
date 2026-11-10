import { Array, Function, Option, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import type { Model } from '../../app/model'
import { QuestTour } from '../../domain/clientSchema'
import { caseBoxOf } from '../../world/feats/caseSpots'
import { crateSpotOf } from '../../world/gear/crates'
import { levelOf } from '../../world/level/arena'
import { isCoop } from '../../world/party/party'
import { isPending, learn } from '../../world/run/lessons'
import {
  isDareTourBreak,
  maybeTutorialCase,
  tutorialKeySpotOf,
} from '../../world/run/tutorialRules'
import {
  CaseState,
  CrateStock,
  Phase,
  type Vector,
} from '../../world/schema/worldSchema'

// NOTE: the guided first break (docs/ESCAPE_PLAN.md, layer 16): a new
// player learns the dare by doing it, one step at a time, each taught at
// the spot where it happens, with a little tracker in a corner and an arrow
// bobbing over the spot. Grab the skeleton key lying in the middle of the
// dining room, take the Plank Pile from the dining room's crate (in this
// break it always holds one, src/world/gear/crates.ts), take the prize from
// the nearest display case (its feat was rigged to a few kills, so it sprang
// open in the practice wave, src/world/run/tutorialRules.ts), and look at
// the dare card on the HUD, which glows with an arrow and its one word.
// Then START WAVE pulses and the tracker ticks off and fades.
//
// It runs once per save: it starts in the open break before wave 2 while
// the dare tour lesson is pending, and ending it in any way (done, the
// tracker's skip button, or starting the wave) learns the lesson, saved.
// SKIP IT on the first-run card learns it too, and a tutorial reset brings
// it back. Never in co-op.
export type QuestStep = 'Key' | 'Trap' | 'Case' | 'Card'

export const QUEST_STEPS: Array.NonEmptyReadonlyArray<QuestStep> = [
  'Key',
  'Trap',
  'Case',
  'Card',
]

const QUEST_LOOK_MS = 2600
const QUEST_DONE_MS = 2600

const isQuestBreak = (model: Model): boolean =>
  Phase.isAnyOf(['Preparation'])(model.phase) && !isCoop(model)

const isKeyTaken = (model: Model): boolean => !isPending(model.lessons.dareKey)

const isTrapTaken = (model: Model): boolean =>
  Array.some(
    model.crates.crates,
    ({ room, stock }) =>
      room === 'Dining' && CrateStock.isAnyOf(['Taken'])(stock),
  )

// NOTE: with no case to open (a house with none), the step counts as done.
const isCaseTaken = (model: Model): boolean =>
  Option.match(maybeTutorialCase(model), {
    onNone: () => true,
    onSome: ({ state }) => CaseState.isAnyOf(['Emptied'])(state),
  })

const STEP_CHECKS: ReadonlyArray<
  readonly [QuestStep, (model: Model) => boolean]
> = [
  ['Key', isKeyTaken],
  ['Trap', isTrapTaken],
  ['Case', isCaseTaken],
]

// NOTE: the first step not done yet, in order; the card once all are.
const maybeOpenStep = (model: Model): Option.Option<QuestStep> =>
  pipe(
    STEP_CHECKS,
    Array.findFirst(([, isDone]) => !isDone(model)),
    Option.map(([step]) => step),
  )

export const questStepOf = (model: Model): Option.Option<QuestStep> =>
  QuestTour.match(model.firstBreakQuest, {
    Waiting: () => Option.none(),
    Running: () =>
      Option.orElse(maybeOpenStep(model), () => Option.some<QuestStep>('Card')),
    Looking: () => Option.some<QuestStep>('Card'),
    Done: () => Option.none(),
    Over: () => Option.none(),
  })

export const isQuestDone = (model: Model): boolean =>
  QuestTour.isAnyOf(['Done'])(model.firstBreakQuest)

// NOTE: the last step points at the HUD's dare card.
export const isQuestOnCard = (model: Model): boolean =>
  Option.contains(questStepOf(model), 'Card')

const learnDareTour = (model: Model): Model =>
  modifyFields(model, {
    lessons: lessons =>
      modifyFields(lessons, {
        dareTour: lesson => learn(lesson, model.elapsedMs),
      }),
  })

// NOTE: one frame of the quest: it starts once its break comes, points at
// the card once the key, the trap, and the case are done, ticks off after a
// moment on the card, ends if the wave starts first, and its tick fades.
export const advanceQuest: {
  (deltaMs: number): (model: Model) => Model
  (model: Model, deltaMs: number): Model
} = Function.dual(2, (model: Model, deltaMs: number): Model =>
  QuestTour.match(model.firstBreakQuest, {
    Waiting: () =>
      isDareTourBreak(model)
        ? modifyFields(model, { firstBreakQuest: () => QuestTour.Running() })
        : model,
    Running: () => {
      if (!isQuestBreak(model)) {
        return endQuest(model)
      } else if (Option.isNone(maybeOpenStep(model))) {
        return modifyFields(model, {
          firstBreakQuest: () => QuestTour.Looking({ ageMs: 0 }),
        })
      } else {
        return model
      }
    },
    Looking: ({ ageMs }) => {
      if (!isQuestBreak(model)) {
        return endQuest(model)
      } else if (ageMs + deltaMs >= QUEST_LOOK_MS) {
        return modifyFields(learnDareTour(model), {
          firstBreakQuest: () => QuestTour.Done({ ageMs: 0 }),
        })
      } else {
        return modifyFields(model, {
          firstBreakQuest: () => QuestTour.Looking({ ageMs: ageMs + deltaMs }),
        })
      }
    },
    Done: ({ ageMs }) =>
      modifyFields(model, {
        firstBreakQuest: () =>
          ageMs + deltaMs >= QUEST_DONE_MS
            ? QuestTour.Over()
            : QuestTour.Done({ ageMs: ageMs + deltaMs }),
      }),
    Over: () => model,
  }),
)

// NOTE: the skip button, or the wave starting first: the tour is over for
// this save.
export const endQuest = (model: Model): Model =>
  QuestTour.isAnyOf(['Over'])(model.firstBreakQuest)
    ? model
    : modifyFields(learnDareTour(model), {
        firstBreakQuest: () => QuestTour.Over(),
      })

// NOTE: an arrow bobs over where the step happens: the key on the floor,
// the dining room's crate, and the case's top. The card's arrow is the
// HUD's (src/features/dare/dareCard.ts).
export const maybeQuestMark = (model: Model): Option.Option<Vector> =>
  Option.flatMap(questStepOf(model), step => {
    const level = levelOf(model)
    if (step === 'Key') {
      return Option.some(tutorialKeySpotOf(model))
    } else if (step === 'Trap') {
      return Option.some(crateSpotOf(level, 'Dining'))
    } else if (step === 'Case') {
      return Option.map(maybeTutorialCase(model), displayCase => {
        const box = caseBoxOf(level, displayCase)
        return { x: Math.round((box.left + box.right) / 2), y: box.top }
      })
    } else {
      return Option.none()
    }
  })
