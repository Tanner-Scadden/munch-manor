import { Schema } from 'effect'
import { defineMessageUnion } from 'foldkit/message'

import { PickedMode, RoomDifficulty } from '@munch/netcode'
import { LobbyEvent, QuickPlayEvent, RoomEvent } from '@munch/netcode/browser'

import { Modifier } from '../modifiers'
import { Calling, SavedBoughtCosmetics } from '../playerData'
import { SeatAction } from '../stepWorld'
import { Bullet } from '../worldSchema'
import { CodeCopy, CoopProblem, NudgeReason, Share } from './model'

// NOTE: this client's controls for one room frame, the shape of netcode's
// PlayerInput. PlayerInput's own Schema checks each field's wire range, and
// a Message's payload goes through its Schema when it is built, so a stray
// aim beyond the range would throw on every frame. The session packs the
// input for the wire itself, so the Message carries plain numbers.
const Controls = Schema.Struct({
  moveX: Schema.Finite,
  moveY: Schema.Finite,
  aimX: Schema.Finite,
  aimY: Schema.Finite,
  buttons: Schema.Finite,
  action: Schema.Finite,
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
  RequestedOpen: {
    name: Schema.String,
    maybeCode: Schema.Option(Schema.String),
    look: Schema.String,
    rank: Schema.Finite,
    calling: Calling,
    rngState: Schema.Finite,
    bought: SavedBoughtCosmetics,
    bones: Schema.Finite,
  },
  RequestedBoughtHero: {
    calling: Calling,
    bought: SavedBoughtCosmetics,
    bones: Schema.Finite,
  },
  RequestedPressKey: { code: Schema.String },
  RequestedReleaseKey: { code: Schema.String },
  RequestedTickRoom: {
    controls: Controls,
    nowMs: Schema.Finite,
    isPictureHeld: Schema.Boolean,
  },
  RequestedPressAction: { action: SeatAction },
  RequestedToggleReady: {},
  RequestedLeave: {},
  RequestedKeepTracers: {
    tracers: Schema.Array(Bullet),
    fired: Schema.Finite,
    looked: Schema.Finite,
    confirmed: Schema.Finite,
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
  ChoseName: { name: Schema.String },
  BoughtCalling: { calling: Calling },
})
export type OutMessage = typeof OutMessage.Type
