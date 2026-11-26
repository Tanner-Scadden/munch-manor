import { Array, Function, Option, pipe } from 'effect'

import { UiStruct } from '@effect/ui'

import type { Model } from '../../app/model'
import { CaseCard, PocketCard, QuestTour } from '../../domain/clientSchema'
import { caseFootOf, isCaseShown } from '../../world/feats/caseSpots'
import { levelOf } from '../../world/level/arena'
import { focusOf, isCoop } from '../../world/party/party'
import { isPending, isPracticeGateHeld, learn } from '../../world/run/lessons'
import { isKitchenTourOn } from '../../world/run/tutorialRules'
import { type DisplayCase, Phase } from '../../world/schema/worldSchema'
import { distanceBetween } from '../../world/step/geometry'
import { questStepOf } from './firstBreakQuest'

export const CASE_CARD_MIN_MS = 700
export const CASE_CARD_MS = 6000
const CASE_CARD_NEAR_PX = 26

const isQuestQuiet = (model: Model): boolean =>
  QuestTour.match(model.firstBreakQuest, {
    Waiting: () => true,
    Running: () => Option.contains(questStepOf(model), 'Case'),
    Looking: () => false,
    Starting: () => false,
    Done: () => true,
    Over: () => true,
  })

const isCaseCardDue = (model: Model): boolean =>
  !isCoop(model) &&
  Phase.isAnyOf(['Preparation'])(model.phase) &&
  isPending(model.lessons.displayCase) &&
  PocketCard.isAnyOf(['Pocketed'])(model.pocketCard) &&
  !isPracticeGateHeld(model) &&
  !isKitchenTourOn(model) &&
  isQuestQuiet(model)

const maybeCaseNear = (model: Model): Option.Option<DisplayCase> => {
  const level = levelOf(model)
  const { player } = focusOf(model)
  return pipe(
    model.cases,
    Array.filter(
      displayCase =>
        isCaseShown(level, displayCase) &&
        distanceBetween(caseFootOf(level, displayCase), player) <=
          CASE_CARD_NEAR_PX,
    ),
    Array.head,
  )
}

export const isCaseCardUp = (model: Model): boolean =>
  CaseCard.isAnyOf(['Showing'])(model.caseCard)

export const isCaseCardBlocking = (model: Model): boolean =>
  isCaseCardUp(model) &&
  Phase.isAnyOf(['Preparation'])(model.phase) &&
  !isCoop(model)

const finishCaseCard = (model: Model): Model =>
  UiStruct.evolve(model, {
    caseCard: () => CaseCard.Hidden(),
    lessons: lessons =>
      UiStruct.evolve(lessons, {
        displayCase: lesson => learn(lesson, model.elapsedMs),
      }),
  })

export const advanceCaseCard = (model: Model): Model =>
  CaseCard.match(model.caseCard, {
    Hidden: () =>
      isCaseCardDue(model)
        ? Option.match(maybeCaseNear(model), {
            onNone: () => model,
            onSome: ({ id }) =>
              UiStruct.evolve(model, {
                caseCard: () => CaseCard.Showing({ caseId: id, ageMs: 0 }),
              }),
          })
        : model,
    Showing: () =>
      Phase.isAnyOf(['Preparation'])(model.phase)
        ? model
        : finishCaseCard(model),
  })

export const ageCaseCard: {
  (deltaMs: number): (model: Model) => Model
  (model: Model, deltaMs: number): Model
} = Function.dual(2, (model: Model, deltaMs: number): Model =>
  CaseCard.match(model.caseCard, {
    Hidden: () => model,
    Showing: ({ caseId, ageMs }) =>
      ageMs + deltaMs >= CASE_CARD_MS
        ? finishCaseCard(model)
        : UiStruct.evolve(model, {
            caseCard: () =>
              CaseCard.Showing({ caseId, ageMs: ageMs + deltaMs }),
          }),
  }),
)

export const canSkipCaseCard = (model: Model): boolean =>
  CaseCard.match(model.caseCard, {
    Hidden: () => false,
    Showing: ({ ageMs }) => ageMs >= CASE_CARD_MIN_MS,
  })

export const skipCaseCard = (model: Model): Model =>
  canSkipCaseCard(model) ? finishCaseCard(model) : model

export const maybeCardCase = (model: Model): Option.Option<DisplayCase> =>
  CaseCard.match(model.caseCard, {
    Hidden: () => Option.none(),
    Showing: ({ caseId }) =>
      Array.findFirst(model.cases, ({ id }) => id === caseId),
  })
