import { Schema } from 'effect'
import { defineMessageUnion } from 'foldkit/message'

import { PickedMode, RoomDifficulty } from '@munch/netcode'
import { LobbyEvent, QuickPlayEvent, RoomEvent } from '@munch/netcode/browser'

import { Calling } from '../playerData'
import { SeatAction } from '../stepWorld'
import { Bullet } from '../worldSchema'
import { CodeCopy, CoopProblem, Share } from './model'

// NOTE: this client's controls for one room frame, the shape of netcode's
// PlayerInput. PlayerInput's own Schema checks each field's wire range, and
// a Message's payload goes through its Schema when it is built, so a stray
// aim beyond the range would throw on every frame. The session packs the
// input for the wire itself, so the Message carries plain numbers.
const Controls = Schema.Struct({
  moveX: Schema.Number,
  moveY: Schema.Number,
  aimX: Schema.Number,
  aimY: Schema.Number,
  buttons: Schema.Number,
  action: Schema.Number,
})
type Controls = typeof Controls.Type

// MESSAGE

export const Message = defineMessageUnion({
  ClickedQuickPlayButton: {},
  ClickedCodeButton: {},
  ClickedCreateButton: {},
  ClickedBackButton: {},
  ClickedCloseButton: {},
  UpdatedCode: { value: Schema.String },
  SubmittedCode: {},
  SucceededRequestRoom: { code: Schema.String, slot: Schema.Number },
  FailedRequestRoom: { problem: CoopProblem },
  ReceivedQuickPlayEvent: { event: QuickPlayEvent },
  ClickedAcceptOfferButton: {},
  ClickedKeepWaitingButton: {},
  ClickedCancelQueueButton: {},
  CompletedAnswerOffer: {},
  CompletedCancelQuickPlay: {},
  ReceivedLobbyEvent: { event: LobbyEvent },
  ReceivedRoomEvent: { event: RoomEvent, atMs: Schema.Number },
  CompletedSendRoomFrames: { bytes: Schema.Array(Schema.Number) },
  ClickedReadyButton: {},
  ClickedKickButton: { playerId: Schema.String },
  ClickedModePick: { mode: PickedMode },
  ClickedDifficultyPick: { difficulty: RoomDifficulty },
  ClickedCallingPill: {},
  ClickedCallingPick: { calling: Calling },
  ClickedCallingDone: {},
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
  RequestedOpen: {
    name: Schema.String,
    maybeCode: Schema.Option(Schema.String),
    look: Schema.String,
    rank: Schema.Number,
    calling: Calling,
  },
  RequestedPressKey: { code: Schema.String },
  RequestedReleaseKey: { code: Schema.String },
  RequestedTickRoom: {
    controls: Controls,
    nowMs: Schema.Number,
    isPictureHeld: Schema.Boolean,
  },
  RequestedPressAction: { action: SeatAction },
  RequestedToggleReady: {},
  RequestedLeave: {},
  RequestedKeepTracers: {
    tracers: Schema.Array(Bullet),
    fired: Schema.Number,
    looked: Schema.Number,
    confirmed: Schema.Number,
  },
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
})
export type OutMessage = typeof OutMessage.Type
