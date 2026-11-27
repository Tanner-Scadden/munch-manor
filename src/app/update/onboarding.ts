import {
  isCaseCardBlocking,
  skipCaseCard,
} from '#features/onboarding/caseCard.ts'
import { endQuest } from '#features/onboarding/firstBreakQuest.ts'
import { skipKitchenTour } from '#features/onboarding/kitchenTour.ts'
import { skipDebutCard } from '#features/onboarding/onboarding.ts'
import { stepWhen } from '#shared/stepWhen.ts'

import { isDebutCardBlocking } from './play.ts'
import { unlockAudio } from './sound.ts'
import { combine, defineHandlers, modelStep } from './step.ts'

export const onboardingHandlers = defineHandlers({
  ClickedDebutCardButton: stepWhen(
    isDebutCardBlocking,
    combine([modelStep(skipDebutCard), unlockAudio]),
  ),

  ClickedCaseCardButton: stepWhen(
    isCaseCardBlocking,
    combine([modelStep(skipCaseCard), unlockAudio]),
  ),

  ClickedSkipQuestButton: combine([modelStep(endQuest), unlockAudio]),

  ClickedSkipKitchenTourButton: combine([
    modelStep(skipKitchenTour),
    unlockAudio,
  ]),
})
