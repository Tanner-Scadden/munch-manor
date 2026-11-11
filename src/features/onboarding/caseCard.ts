import { Array, Function, Option, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

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

// The display case's first-time card (owner's playtest, 2026-11-10: "Need
// more explanation what the chests are"): the first time a player walks up
// to a display case in a break, a card like the new zombie card shows that
// case's feat, its prize behind the glass, and one short line, with a
// button to put it away. Once per save: putting it away, or its clock
// running out, learns the `displayCase` lesson, saved. A case first met
// mid-wave waits for the next break and the next walk up to one.
//
// Alone the break waits under it, as the new zombie card holds a wave; never
// in co-op, where the new zombie card never shows either. It keeps out of
// the other teaching's way: the dare card in your pocket, the practice gate,
// the kitchen tour, and the guided first break, which raises it only at its
// own Case step, as the player walks up to the case it points at.

export const CASE_CARD_MIN_MS = 700
export const CASE_CARD_MS = 6000
const CASE_CARD_NEAR_PX = 26

const isQuestQuiet = (model: Model): boolean =>
  QuestTour.match(model.firstBreakQuest, {
    Waiting: () => true,
    Running: () => Option.contains(questStepOf(model), 'Case'),
    Looking: () => false,
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

// NOTE: the case standing nearest the player, within a step of its foot.
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

// NOTE: alone the break waits while the card is up.
export const isCaseCardBlocking = (model: Model): boolean =>
  isCaseCardUp(model) &&
  Phase.isAnyOf(['Preparation'])(model.phase) &&
  !isCoop(model)

const finishCaseCard = (model: Model): Model =>
  modifyFields(model, {
    caseCard: () => CaseCard.Hidden(),
    lessons: lessons =>
      modifyFields(lessons, {
        displayCase: lesson => learn(lesson, model.elapsedMs),
      }),
  })

// NOTE: one frame of the card while the game runs: it comes up as the
// player reaches a case in a break, and a card the break left behind (the
// wave started under it) is put away, learned.
export const advanceCaseCard = (model: Model): Model =>
  CaseCard.match(model.caseCard, {
    Hidden: () =>
      isCaseCardDue(model)
        ? Option.match(maybeCaseNear(model), {
            onNone: () => model,
            onSome: ({ id }) =>
              modifyFields(model, {
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
        : modifyFields(model, {
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

// NOTE: the case the card is about, while it is up.
export const maybeCardCase = (model: Model): Option.Option<DisplayCase> =>
  CaseCard.match(model.caseCard, {
    Hidden: () => Option.none(),
    Showing: ({ caseId }) =>
      Array.findFirst(model.cases, ({ id }) => id === caseId),
  })
