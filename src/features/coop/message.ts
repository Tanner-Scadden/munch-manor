import { Schema } from 'effect'
import { defineMessageUnion } from 'foldkit/message'

import { PickedMode, RoomDifficulty } from '@munch/netcode'
import { LobbyEvent, QuickPlayEvent, RoomEvent } from '@munch/netcode/browser'

import { Calling } from '../../shared/playerData'
import { Modifier } from '../../world/run/modifiers'
import { CodeCopy, CoopProblem, NudgeReason, Share } from './model'

// MESSAGE

// NOTE: co-op's own facts. The parent's requests are its InMessages
// (inMessage.ts).
export const Message = defineMessageUnion({
  ClickedQuickPlayButton: {},
  ClickedCodeButton: {},
  ClickedCreateButton: {},
  ClickedBackButton: {},
  ClickedCloseButton: {},
  UpdatedCode: { value: Schema.String },
  SubmittedCode: {},
  SucceededRequestRoom: { code: Schema.String, slot: Schema.Finite },
  FailedRequestRoom: { problem: CoopProblem },
  ReceivedQuickPlayEvent: { event: QuickPlayEvent },
  ClickedAcceptOfferButton: {},
  ClickedKeepWaitingButton: {},
  ClickedCancelQueueButton: {},
  CompletedAnswerOffer: {},
  CompletedCancelQuickPlay: {},
  ReceivedLobbyEvent: { event: LobbyEvent },
  ReceivedRoomEvent: { event: RoomEvent, atMs: Schema.Finite },
  CompletedSendRoomFrames: { bytes: Schema.Array(Schema.Finite) },
  ClickedReadyButton: {},
  ClickedKickButton: { playerId: Schema.String },
  ClickedModePick: { mode: PickedMode },
  ClickedDifficultyPick: { difficulty: RoomDifficulty },
  ClickedModifierPick: { modifier: Modifier },
  ClickedCallingPill: {},
  ClickedCallingPick: { calling: Calling },
  ClickedCallingDone: {},
  ClickedBuyCallingButton: {},
  ClickedPickNudge: { reason: NudgeReason },
  ClickedNameButton: {},
  UpdatedNameDraft: { value: Schema.String },
  SubmittedName: {},
  ClickedNameDice: {},
  ClickedNameCancel: {},
  CompletedChangeLobby: {},
  FailedChangeLobby: { problem: CoopProblem },
  ClickedLeaveButton: {},
  CompletedLeaveRoom: {},
  CompletedResyncRoom: {},
  ClickedShareButton: {},
  CompletedShareRoomLink: { share: Share },
  ClickedRoomCode: {},
  CompletedCopyRoomCode: { copy: CodeCopy },
  CompletedRememberRoom: {},
  CompletedFocusCoopElement: {},
})
export type Message = typeof Message.Type

// OUT MESSAGE

// NOTE: `LeftRoom` says a delivered Message dropped the room, so the
// parent can go home from a run the room left behind.
export const OutMessage = defineMessageUnion({
  ClosedCoop: {},
  NeededNewerBuild: {},
  LeftRoom: {},
  ChoseCalling: { calling: Calling },
  ChoseName: { name: Schema.String },
  BoughtCalling: { calling: Calling },
})
export type OutMessage = typeof OutMessage.Type
