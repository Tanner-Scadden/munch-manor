import { UiSchema } from '@effect/ui'

export const whatsNewCases = {
  ClickedOlderNewsButton: {},
  ClickedNewerNewsButton: {},
}
export const WhatsNewMessage = UiSchema.TaggedEnum(whatsNewCases)
export type WhatsNewMessage = typeof WhatsNewMessage.Type
