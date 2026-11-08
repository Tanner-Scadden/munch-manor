import { defineMessageUnion } from 'foldkit/message'

// NOTE: the new zombie card's button and the skips of the guided first
// break and the kitchen tour. Their handlers are in ./update.ts.
export const onboardingCases = {
  ClickedDebutCardButton: {},
  ClickedSkipQuestButton: {},
  ClickedSkipKitchenTourButton: {},
}
export const OnboardingMessage = defineMessageUnion(onboardingCases)
export type OnboardingMessage = typeof OnboardingMessage.Type
