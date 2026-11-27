import { UiSchema } from '@effect/ui'

import { ShareOutcome, ShareSheet } from './share.ts'

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
