import { UiSchema } from '@effect/ui'

// NOTE: What's New's page turns (src/features/whatsNew/whatsNewView.ts),
// handled in src/app/update/home.ts with the other panels.
export const whatsNewCases = {
  ClickedOlderNewsButton: {},
  ClickedNewerNewsButton: {},
}
export const WhatsNewMessage = UiSchema.TaggedEnum(whatsNewCases)
export type WhatsNewMessage = typeof WhatsNewMessage.Type
