import { endQuest } from '../../features/onboarding/firstBreakQuest'
import { skipKitchenTour } from '../../features/onboarding/kitchenTour'
import { skipDebutCard } from '../../features/onboarding/onboarding'
import { stepWhen } from '../../shared/stepWhen'
import { isDebutCardBlocking } from './play'
import { unlockAudio } from './sound'
import { defineHandlers } from './step'

// NOTE: the new zombie card's button and the skips (./message.ts).
export const onboardingHandlers = defineHandlers({
  ClickedDebutCardButton: model =>
    stepWhen(isDebutCardBlocking, stepModel =>
      unlockAudio(skipDebutCard(stepModel)),
    )(model),

  ClickedSkipQuestButton: model => unlockAudio(endQuest(model)),

  ClickedSkipKitchenTourButton: model => unlockAudio(skipKitchenTour(model)),
})
