import { Schema } from 'effect'

import { UiSchema } from '@effect/ui'
import { PickedMode, RoomDifficulty } from '@munch/netcode'
import { LobbyEvent, QuickPlayEvent, RoomEvent } from '@munch/netcode/browser'

import { CodeCopy, CoopProblem, NudgeReason, Share } from '#domain/coopRoom.ts'
import { Calling } from '#shared/records/playerData.ts'
import { Modifier } from '#world/run/modifiers.ts'

export const coopCases = {
  ClickedCoopQuickPlayButton: {},
  ClickedCoopCodeButton: {},
  ClickedCoopCreateButton: {},
  ClickedCoopBackButton: {},
  ClickedCoopCloseButton: {},
  UpdatedCoopCode: { value: Schema.String },
  SubmittedCoopCode: {},
  SucceededRequestRoom: { code: Schema.String, slot: Schema.Finite },
  FailedRequestRoom: { problem: CoopProblem },
  ReceivedQuickPlayEvent: { event: QuickPlayEvent },
  ClickedCoopAcceptOfferButton: {},
  ClickedCoopKeepWaitingButton: {},
  ClickedCoopCancelQueueButton: {},
  ReceivedLobbyEvent: { event: LobbyEvent },
  ReceivedRoomEvent: { event: RoomEvent, atMs: Schema.Finite },
  CompletedSendRoomFrames: { bytes: Schema.Array(Schema.Finite) },
  ClickedCoopReadyButton: {},
  ClickedCoopKickButton: { playerId: Schema.String },
  ClickedCoopModePick: { mode: PickedMode },
  ClickedCoopDifficultyPick: { difficulty: RoomDifficulty },
  ClickedCoopModifierPick: { modifier: Modifier },
  ClickedCoopEasyBreakPick: {},
  ClickedCoopDareMarkPick: { mark: Schema.Finite },
  ClickedCoopCallingPill: {},
  ClickedCoopPickNudge: { reason: NudgeReason },
  ClickedCoopNameButton: {},
  UpdatedCoopNameDraft: { value: Schema.String },
  SubmittedCoopName: {},
  ClickedCoopNameDice: {},
  ClickedCoopNameCancel: {},
  ClickedCoopLeaveButton: {},
  CompletedLeaveRoom: {},
  ClickedCoopShareButton: {},
  CompletedShareRoomLink: { share: Share },
  ClickedCoopRoomCode: {},
  CompletedCopyRoomCode: { copy: CodeCopy },
  PickedCoopHero: { calling: Calling },
  RequestedBuyCoopHero: { calling: Calling },
  RequestedCloseCoopHeroPicker: {},
}

export const CoopMessage = UiSchema.TaggedEnum(coopCases)
export type CoopMessage = typeof CoopMessage.Type

export const CoopNotice = UiSchema.TaggedEnum({
  ClosedCoop: {},
  NeededNewerBuild: {},
  LeftRoom: {},
  ChoseCalling: { calling: Calling },
  ChoseName: { name: Schema.String },
  BoughtCalling: { calling: Calling },
})
export type CoopNotice = typeof CoopNotice.Type
