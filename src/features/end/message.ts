import { Schema } from 'effect'
import { defineMessageUnion } from 'foldkit/message'

import { ShareOutcome, ShareSheet } from './share'

// NOTE: the end of a run: the end card's buttons and SHARE. Their handlers
// are in ./update.ts.
export const endCases = {
  ClickedRetryButton: {},
  ClickedShareButton: {},
  ClickedRunItBackButton: {},
  ClickedRoomLobbyButton: {},
  ClickedLeaveRoomButton: {},
  SettledShare: { outcome: ShareOutcome },
  CompletedSendShareEvent: {},
  FailedSendShareEvent: { reason: Schema.String },
  CompletedDetectShareSheet: { shareSheet: ShareSheet },
}
export const EndMessage = defineMessageUnion(endCases)
export type EndMessage = typeof EndMessage.Type
