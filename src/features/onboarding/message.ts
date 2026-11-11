import { defineMessageUnion } from 'foldkit/message'

// NOTE: the new zombie card's button, the display case card's, and the skips of the guided first
// break and the kitchen tour. Their handlers are in ./update.ts.
export const onboardingCases = {
  ClickedDebutCardButton: {},
  ClickedCaseCardButton: {},
  ClickedSkipQuestButton: {},
  ClickedSkipKitchenTourButton: {},
}
export const OnboardingMessage = defineMessageUnion(onboardingCases)
export type OnboardingMessage = typeof OnboardingMessage.Type
