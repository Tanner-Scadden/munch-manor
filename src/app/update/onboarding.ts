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
import { defineHandlers } from './step'

// NOTE: the new zombie card's button, the display case card's, and the
// skips (src/features/onboarding/message.ts).
export const onboardingHandlers = defineHandlers({
  ClickedDebutCardButton: model =>
    stepWhen(isDebutCardBlocking, stepModel =>
      unlockAudio(skipDebutCard(stepModel)),
    )(model),

  ClickedCaseCardButton: model =>
    stepWhen(isCaseCardBlocking, stepModel =>
      unlockAudio(skipCaseCard(stepModel)),
    )(model),

  ClickedSkipQuestButton: model => unlockAudio(endQuest(model)),

  ClickedSkipKitchenTourButton: model => unlockAudio(skipKitchenTour(model)),
})
