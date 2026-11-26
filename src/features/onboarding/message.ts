import { UiSchema } from '@effect/ui'

export const onboardingCases = {
  ClickedDebutCardButton: {},
  ClickedCaseCardButton: {},
  ClickedSkipQuestButton: {},
  ClickedSkipKitchenTourButton: {},
}
export const OnboardingMessage = UiSchema.TaggedEnum(onboardingCases)
export type OnboardingMessage = typeof OnboardingMessage.Type
