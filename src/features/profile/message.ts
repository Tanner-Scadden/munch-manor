import { Schema } from 'effect'
import { defineMessageUnion } from 'foldkit/message'

import { LinkProblem } from '../../platform/playerSync'
import { LookPart, LookToggle } from './blocks/look/lookSchema'
import { ProfileTab } from './model'

// NOTE: the Settings tab's tiles and the Account tab's STATS tile. The
// settings are the root's, so a tile only says it was clicked.
export const SettingTile = Schema.Literals([
  'Sound',
  'Music',
  'Shake',
  'Cursor',
  'Fullscreen',
  'Rotation',
  'ShareStats',
])
export type SettingTile = typeof SettingTile.Type

// NOTE: the Profile's own facts. The root's requests are its InMessages
// (inMessage.ts).
export const Message = defineMessageUnion({
  UpdatedNameDraft: { value: Schema.String },
  SubmittedName: {},
  BlurredNameInput: {},
  ClickedNameDiceButton: {},
  ClickedLinkDeviceButton: {},
  SucceededRequestLinkCode: { code: Schema.String },
  FailedRequestLinkCode: { problem: LinkProblem },
  ClickedUseCodeButton: {},
  UpdatedLinkCode: { value: Schema.String },
  SubmittedLinkCode: {},
  SucceededRedeemLinkCode: {},
  FailedRedeemLinkCode: { problem: LinkProblem },
  ClickedCancelLinkButton: {},
  ClickedSettingTile: { setting: SettingTile },
  ClickedResetTutorialButton: {},
  ClickedConfirmResetTutorialButton: {},
  ClickedCancelResetTutorialButton: {},
  CompletedFocusTutorialReset: {},
  CompletedFocusLookOption: {},
})
export type Message = typeof Message.Type

// NOTE: what happened in the Profile that the root acts on: the name kept
// (each with the name, cleaned), the dice, a setting's tile, the tutorial
// reset, the link flow's moments (for their sounds), and the Look tab's
// picks, which change the root's look and Bones. A pick's outcome comes back
// as `InformedOfLookOutcome`, and a dice name as `InformedOfRolledName`.
export const OutMessage = defineMessageUnion({
  SwitchedTab: { tab: ProfileTab, name: Schema.String },
  KeptName: { name: Schema.String },
  SubmittedName: { name: Schema.String },
  RolledNameDice: { current: Schema.String },
  ClickedSetting: { setting: SettingTile },
  ConfirmedTutorialReset: {},
  ShowedLinkCode: {},
  LinkedDevice: {},
  ChoseLook: { part: LookPart, value: Schema.String },
  FlippedLook: { toggle: LookToggle },
  RolledLookDice: {},
  ClickedBuyLook: { part: LookPart, value: Schema.String },
})
export type OutMessage = typeof OutMessage.Type
