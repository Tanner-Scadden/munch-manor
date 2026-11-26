import { Array, Function, Option, pipe } from 'effect'

import { UiStruct } from '@effect/ui'

import type { Model } from '../../app/model'
import { QuestTour } from '../../domain/clientSchema'
import { caseBoxOf } from '../../world/feats/caseSpots'
import { heldKeys } from '../../world/keys/keys'
import { levelOf } from '../../world/level/arena'
import {
  type Padlock,
  hasOpenedBoards,
  isExitOfferOpenFor,
  maybeCheapestPadlock,
  padlockMarkOf,
} from '../../world/level/exits'
import { distanceToBox } from '../../world/level/tileGrid'
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

export type QuestStep = 'Key' | 'Lock' | 'Case' | 'Card' | 'Start'

export const QUEST_STEPS: Array.NonEmptyReadonlyArray<QuestStep> = [
  'Key',
  'Lock',
  'Case',
  'Card',
  'Start',
]

const LOCK_SEEN_PX = 24

const QUEST_LOOK_MS = 2600
const QUEST_DONE_MS = 2600

const isQuestBreak = (model: Model): boolean =>
  Phase.isAnyOf(['Preparation'])(model.phase) && !isCoop(model)

const isKeyTaken = (model: Model): boolean => !isPending(model.lessons.dareKey)

export const maybeQuestPadlock = (model: Model): Option.Option<Padlock> =>
  maybeCheapestPadlock(model, focusOf(model).player)

const isNearPadlock = (model: Model): boolean =>
  Option.exists(
    maybeQuestPadlock(model),
    ({ box }) => distanceToBox(focusOf(model).player, box) <= LOCK_SEEN_PX,
  )

const isLockSeen = (model: Model): boolean =>
  QuestTour.matchOrElse(
    model.firstBreakQuest,
    { Running: running => running.isLockSeen },
    () => false,
  ) ||
  hasOpenedBoards(model) ||
  Option.isNone(maybeQuestPadlock(model))

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
    Starting: () => Option.some<QuestStep>('Start'),
    Done: () => Option.none(),
    Over: () => Option.none(),
  })

export const isQuestDone = (model: Model): boolean =>
  QuestTour.isAnyOf(['Done'])(model.firstBreakQuest)

export const isQuestOnCard = (model: Model): boolean =>
  Option.contains(questStepOf(model), 'Card')

export const isQuestOnStart = (model: Model): boolean =>
  Option.contains(questStepOf(model), 'Start')

const learnDareTour = (model: Model): Model =>
  UiStruct.evolve(model, {
    lessons: lessons =>
      UiStruct.evolve(lessons, {
        dareTour: lesson => learn(lesson, model.elapsedMs),
      }),
  })

const noteLockSeen = (model: Model): Model =>
  Option.contains(maybeOpenStep(model), 'Lock') && isNearPadlock(model)
    ? UiStruct.evolve(model, {
        firstBreakQuest: () => QuestTour.Running({ isLockSeen: true }),
      })
    : model

export const advanceQuest: {
  (deltaMs: number): (model: Model) => Model
  (model: Model, deltaMs: number): Model
} = Function.dual(2, (model: Model, deltaMs: number): Model =>
  QuestTour.match(model.firstBreakQuest, {
    Waiting: () =>
      isDareTourBreak(model) && !isRattlesTalking(model)
        ? UiStruct.evolve(model, {
            firstBreakQuest: () => QuestTour.Running({ isLockSeen: false }),
          })
        : model,
    Running: () => {
      if (!isQuestBreak(model)) {
        return endQuest(model)
      }
      const noted = noteLockSeen(model)
      return Option.isNone(maybeOpenStep(noted))
        ? UiStruct.evolve(noted, {
            firstBreakQuest: () => QuestTour.Looking({ ageMs: 0 }),
          })
        : noted
    },
    Looking: ({ ageMs }) => {
      if (!isQuestBreak(model)) {
        return endQuest(model)
      } else if (ageMs + deltaMs >= QUEST_LOOK_MS) {
        return UiStruct.evolve(model, {
          firstBreakQuest: () => QuestTour.Starting(),
        })
      } else {
        return UiStruct.evolve(model, {
          firstBreakQuest: () => QuestTour.Looking({ ageMs: ageMs + deltaMs }),
        })
      }
    },
    Starting: () =>
      isQuestBreak(model)
        ? model
        : UiStruct.evolve(learnDareTour(model), {
            firstBreakQuest: () => QuestTour.Done({ ageMs: 0 }),
          }),
    Done: ({ ageMs }) =>
      UiStruct.evolve(model, {
        firstBreakQuest: () =>
          ageMs + deltaMs >= QUEST_DONE_MS
            ? QuestTour.Over()
            : QuestTour.Done({ ageMs: ageMs + deltaMs }),
      }),
    Over: () => model,
  }),
)

export const endQuest = (model: Model): Model =>
  QuestTour.isAnyOf(['Over'])(model.firstBreakQuest)
    ? model
    : UiStruct.evolve(learnDareTour(model), {
        firstBreakQuest: () => QuestTour.Over(),
      })

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

export const maybeLockProgress = (model: Model): Option.Option<LockProgress> =>
  Option.contains(questStepOf(model), 'Lock')
    ? Option.map(maybeQuestPadlock(model), ({ box, price }) => ({
        box,
        held: heldKeys(model),
        price,
      }))
    : Option.none()

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

export const maybePadlockPointer = (model: Model): Option.Option<Vector> =>
  isQuestBreak(model) &&
  isExitOfferOpenFor(model.phase) &&
  Option.isNone(questStepOf(model)) &&
  Option.isNone(kitchenStepOf(model)) &&
  !isNearPadlock(model)
    ? pipe(
        maybeQuestPadlock(model),
        Option.filter(({ price }) => price > 0 && price <= heldKeys(model)),
        Option.map(padlockMarkOf),
      )
    : Option.none()
