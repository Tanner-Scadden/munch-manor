import { Array, Function, Option, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import type { Model } from '../../app/model'
import { QuestTour } from '../../domain/clientSchema'
import { caseBoxOf } from '../../world/feats/caseSpots'
import { heldKeys } from '../../world/keys/keys'
import { distanceToBox, levelOf } from '../../world/level/arena'
import {
  type Padlock,
  hasOpenedBoards,
  isExitOfferOpenFor,
  maybeCheapestPadlock,
  padlockMarkOf,
} from '../../world/level/exits'
import { focusOf, isCoop } from '../../world/party/party'
import { isPending, learn } from '../../world/run/lessons'
import {
  isDareTourBreak,
  maybeTutorialCase,
  tutorialKeySpotOf,
} from '../../world/run/tutorialRules'
import { CaseState, Phase, type Vector } from '../../world/schema/worldSchema'
import { kitchenStepOf } from './kitchenTour'
import { isRattlesTalking } from './rattlesIntro'

// NOTE: the guided first break (docs/ESCAPE_PLAN.md, layer 16): a new
// player learns the dare by doing it, one step at a time, each taught at
// the spot where it happens, with a little tracker in a corner and an arrow
// bobbing over the spot. Grab the skeleton key lying in the middle of the
// dining room, walk up to the padlock that asks the fewest keys, where the
// keys held and the keys it asks show beside it (the owner's playtest,
// 2026-11-10: "guide me to the key"; the boards are not for sale until a
// later break, so the step is seeing what keys are for, not opening it),
// take the prize from the nearest display case (its feat was rigged to a
// few kills, so it sprang open in the practice wave,
// src/world/run/tutorialRules.ts), and look at the dare card on the HUD,
// which glows with an arrow and its one word. Then START WAVE pulses and the
// tracker ticks off and fades. The dining room crate still holds a Plank
// Pile in this break (src/world/gear/crates.ts), found without a step.
//
// It runs once per save: it starts in the open break before wave 2 while
// the dare tour lesson is pending, once Rattles has said hello
// (src/features/onboarding/rattlesIntro.ts), and ending it in any way (done, the
// tracker's skip button, or starting the wave) learns the lesson, saved.
// SKIP IT on the first-run card learns it too, and a tutorial reset brings
// it back. Never in co-op.
export type QuestStep = 'Key' | 'Lock' | 'Case' | 'Card'

export const QUEST_STEPS: Array.NonEmptyReadonlyArray<QuestStep> = [
  'Key',
  'Lock',
  'Case',
  'Card',
]

// NOTE: how close to a padlock's boards counts as having walked up to it.
const LOCK_SEEN_PX = 24

const QUEST_LOOK_MS = 2600
const QUEST_DONE_MS = 2600

const isQuestBreak = (model: Model): boolean =>
  Phase.isAnyOf(['Preparation'])(model.phase) && !isCoop(model)

const isKeyTaken = (model: Model): boolean => !isPending(model.lessons.dareKey)

// NOTE: the padlock the step points at, the cheapest from where the player
// stands.
export const maybeQuestPadlock = (model: Model): Option.Option<Padlock> =>
  maybeCheapestPadlock(model, focusOf(model).player)

const isNearPadlock = (model: Model): boolean =>
  Option.exists(
    maybeQuestPadlock(model),
    ({ box }) => distanceToBox(focusOf(model).player, box) <= LOCK_SEEN_PX,
  )

// NOTE: walked up to once, or any boards already open, the step stays done.
// With no padlock left to point at, it counts as done too.
const isLockSeen = (model: Model): boolean =>
  QuestTour.matchOrElse(
    model.firstBreakQuest,
    { Running: running => running.isLockSeen },
    () => false,
  ) ||
  hasOpenedBoards(model) ||
  Option.isNone(maybeQuestPadlock(model))

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
  ['Lock', isLockSeen],
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

// NOTE: the padlock step remembers the player walked up to it.
const noteLockSeen = (model: Model): Model =>
  Option.contains(maybeOpenStep(model), 'Lock') && isNearPadlock(model)
    ? modifyFields(model, {
        firstBreakQuest: () => QuestTour.Running({ isLockSeen: true }),
      })
    : model

// NOTE: one frame of the quest: it starts once its break comes and Rattles
// has said hello, points at the card once the key, the padlock, and the case
// are done, ticks off after a moment on the card, ends if the wave starts
// first, and its tick fades.
export const advanceQuest: {
  (deltaMs: number): (model: Model) => Model
  (model: Model, deltaMs: number): Model
} = Function.dual(2, (model: Model, deltaMs: number): Model =>
  QuestTour.match(model.firstBreakQuest, {
    Waiting: () =>
      isDareTourBreak(model) && !isRattlesTalking(model)
        ? modifyFields(model, {
            firstBreakQuest: () => QuestTour.Running({ isLockSeen: false }),
          })
        : model,
    Running: () => {
      if (!isQuestBreak(model)) {
        return endQuest(model)
      }
      const noted = noteLockSeen(model)
      return Option.isNone(maybeOpenStep(noted))
        ? modifyFields(noted, {
            firstBreakQuest: () => QuestTour.Looking({ ageMs: 0 }),
          })
        : noted
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
// the padlock's boards, and the case's top. The card's arrow is the HUD's
// (src/features/dare/dareCard.ts).
export const maybeQuestMark = (model: Model): Option.Option<Vector> =>
  Option.flatMap(questStepOf(model), step => {
    const level = levelOf(model)
    if (step === 'Key') {
      return Option.some(tutorialKeySpotOf(model))
    } else if (step === 'Lock') {
      return Option.map(maybeQuestPadlock(model), padlockMarkOf)
    } else if (step === 'Case') {
      return Option.map(maybeTutorialCase(model), displayCase => {
        const box = caseBoxOf(level, displayCase)
        return { x: Math.round((box.left + box.right) / 2), y: box.top }
      })
    } else {
      return Option.none()
    }
  })

export type LockProgress = Readonly<{
  box: Padlock['box']
  held: number
  price: number
}>

// NOTE: on the padlock step, the keys on the ring and the keys the padlock
// asks, shown beside it, so a player short of keys sees how far to go.
export const maybeLockProgress = (model: Model): Option.Option<LockProgress> =>
  Option.contains(questStepOf(model), 'Lock')
    ? Option.map(maybeQuestPadlock(model), ({ box, price }) => ({
        box,
        held: heldKeys(model),
        price,
      }))
    : Option.none()

// THE PADLOCK NUDGE

// NOTE: outside the tour, for a player who skipped it or came back from
// before the escape: in a break when the boards are for sale, while no
// boards have opened this run, and the ring holds the keys the cheapest
// padlock asks, an arrow pulses gently over it. No words.
export const maybePadlockNudge = (model: Model): Option.Option<Vector> =>
  Phase.isAnyOf(['Preparation'])(model.phase) &&
  isExitOfferOpenFor(model.phase) &&
  Option.isNone(questStepOf(model)) &&
  Option.isNone(kitchenStepOf(model)) &&
  !hasOpenedBoards(model)
    ? pipe(
        maybeQuestPadlock(model),
        Option.filter(({ price }) => price > 0 && price <= heldKeys(model)),
        Option.map(padlockMarkOf),
      )
    : Option.none()
