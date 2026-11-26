import { UiSchema } from '@effect/ui'

import { ShareOutcome, ShareSheet } from './share'

// NOTE: the end of a run: the end card's buttons and SHARE. Their handlers
// are in src/app/update/end.ts.
export const endCases = {
  ClickedRetryButton: {},
  ClickedShareButton: {},
  ClickedPlayAgainButton: {},
  ClickedRoomLobbyButton: {},
  ClickedLeaveRoomButton: {},
  SettledShare: { outcome: ShareOutcome },
  CompletedDetectShareSheet: { shareSheet: ShareSheet },
}
export const EndMessage = UiSchema.TaggedEnum(endCases)
export type EndMessage = typeof EndMessage.Type
