import { stepWhen } from '../../app/stepWhen'
import { isDebutCardBlocking } from '../../app/update/play'
import { unlockAudio } from '../../app/update/sound'
import { defineHandlers } from '../../app/update/step'
import { endQuest } from './firstBreakQuest'
import { skipKitchenTour } from './kitchenTour'
import { skipDebutCard } from './onboarding'

// NOTE: the new zombie card's button and the skips (./message.ts).
export const onboardingHandlers = defineHandlers({
  ClickedDebutCardButton: model =>
    stepWhen(isDebutCardBlocking, stepModel =>
      unlockAudio(skipDebutCard(stepModel)),
    )(model),

  ClickedSkipQuestButton: model => unlockAudio(endQuest(model)),

  ClickedSkipKitchenTourButton: model => unlockAudio(skipKitchenTour(model)),
})
