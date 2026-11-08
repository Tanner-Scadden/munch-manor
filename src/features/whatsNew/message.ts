import { defineMessageUnion } from 'foldkit/message'

// NOTE: What's New's page turns (src/features/whatsNew/whatsNewView.ts),
// handled in src/features/home/update.ts with the other panels.
export const whatsNewCases = {
  ClickedOlderNewsButton: {},
  ClickedNewerNewsButton: {},
}
export const WhatsNewMessage = defineMessageUnion(whatsNewCases)
export type WhatsNewMessage = typeof WhatsNewMessage.Type
