import { Schema } from 'effect'

import { UiSchema } from '@effect/ui'
import { PickedMode, RoomDifficulty } from '@munch/netcode'
import { LobbyEvent, QuickPlayEvent, RoomEvent } from '@munch/netcode/browser'

import {
  CodeCopy,
  CoopProblem,
  NudgeReason,
  Share,
} from '../../domain/coopRoom'
import { Calling } from '../../shared/playerData'
import { Modifier } from '../../world/run/modifiers'

// MESSAGE

// NOTE: co-op's facts, a group of the root's Messages (src/app/message.ts).
// Co-op is the root's own state (`coop`), so its handlers are root handlers
// (src/app/update/coop.ts). A control's Message names co-op, as it sits in
// the root's one union beside the other screens' buttons.
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
  // NOTE: the hero picker's events over co-op's lobby (src/features/heroes/).
  PickedCoopHero: { calling: Calling },
  RequestedBuyCoopHero: { calling: Calling },
  RequestedCloseCoopHeroPicker: {},
}

export const CoopMessage = UiSchema.TaggedEnum(coopCases)
export type CoopMessage = typeof CoopMessage.Type

// NOTICE

// NOTE: what one of co-op's rules tells the rest of the root, which answers
// it with its own Steps (src/app/update/coop.ts): co-op closed, the room
// needs a newer build, the room was dropped (so a run it left goes home), a
// hero or a name chosen in the lobby (the player's everywhere), and a hero
// to buy with the Bones.
export const CoopNotice = UiSchema.TaggedEnum({
  ClosedCoop: {},
  NeededNewerBuild: {},
  LeftRoom: {},
  ChoseCalling: { calling: Calling },
  ChoseName: { name: Schema.String },
  BoughtCalling: { calling: Calling },
})
export type CoopNotice = typeof CoopNotice.Type
