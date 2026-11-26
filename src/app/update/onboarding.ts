import {
  isCaseCardBlocking,
  skipCaseCard,
} from '../../features/onboarding/caseCard'
import { endQuest } from '../../features/onboarding/firstBreakQuest'
import { skipKitchenTour } from '../../features/onboarding/kitchenTour'
import { skipDebutCard } from '../../features/onboarding/onboarding'
import { stepWhen } from '../../shared/stepWhen'
import { isDebutCardBlocking } from './play'
import { unlockAudio } from './sound'
import { combine, defineHandlers, modelStep } from './step'

// NOTE: the new zombie card's button, the display case card's, and the
// skips (src/features/onboarding/message.ts).
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
