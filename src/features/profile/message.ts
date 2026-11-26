import { Schema } from 'effect'

import { UiSchema } from '@effect/ui'

import { LookPart } from '#domain/looks.ts'
import { LinkProblem } from '#platform/save/playerSync.ts'
import { PropStyle } from '#shared/records/playerData.ts'

import { LookToggle } from './blocks/look/lookSchema.ts'
import { ProfileTab } from './model.ts'

export const SettingTile = Schema.Literals([
  'Sound',
  'Music',
  'Shake',
  'Cursor',
  'Fullscreen',
  'Rotation',
  'Rumble',
  'ShareStats',
  'RecordRuns',
])
export type SettingTile = typeof SettingTile.Type

export const Message = UiSchema.TaggedEnum({
  SelectedTab: { value: Schema.String },
  UpdatedNameDraft: { value: Schema.String },
  SubmittedName: {},
  BlurredNameInput: {},
  ClickedNameDiceButton: {},
  ClickedLinkDeviceButton: {},
  ClickedUseCodeButton: {},
  UpdatedLinkCode: { value: Schema.String },
  SubmittedLinkCode: {},
  ClickedCancelLinkButton: {},
  SucceededCopyLinkCode: {},
  SucceededReadClipboard: { text: Schema.String, typed: Schema.String },
  ClickedSettingTile: { setting: SettingTile },
  ClickedResetTutorialButton: {},
  ClickedConfirmResetTutorialButton: {},
  ClickedCancelResetTutorialButton: {},
  ClickedPropStyle: { style: PropStyle },
  ChoseLook: { part: LookPart, value: Schema.String },
  FlippedLook: { toggle: LookToggle },
  RolledLookDice: {},
  ClickedBuyLook: { part: LookPart, value: Schema.String },
})
export type Message = typeof Message.Type

export const Events = UiSchema.TaggedEnum({
  SwitchedTab: { tab: ProfileTab },
  UpdatedNameDraft: { value: Schema.String },
  SubmittedName: {},
  BlurredNameInput: {},
  RolledNameDice: {},
  ClickedLinkDevice: {},
  ClickedUseCode: {},
  UpdatedLinkCode: { value: Schema.String },
  SubmittedLinkCode: {},
  ClickedCancelLink: {},
  CopiedLinkCode: {},
  ReadClipboard: { text: Schema.String, typed: Schema.String },
  ClickedSetting: { setting: SettingTile },
  ClickedResetTutorial: {},
  ConfirmedTutorialReset: {},
  CancelledTutorialReset: {},
  ChosePropStyle: { style: PropStyle },
  ChoseLook: { part: LookPart, value: Schema.String },
  FlippedLook: { toggle: LookToggle },
  RolledLookDice: {},
  ClickedBuyLook: { part: LookPart, value: Schema.String },
})
export type Events = typeof Events.Type

export const profileCases = {
  SwitchedProfileTab: { tab: ProfileTab },
  UpdatedProfileNameDraft: { value: Schema.String },
  SubmittedProfileName: {},
  BlurredProfileName: {},
  RolledProfileNameDice: {},
  ClickedLinkDevice: {},
  ClickedUseLinkCode: {},
  UpdatedLinkCode: { value: Schema.String },
  SubmittedLinkCode: {},
  ClickedCancelLink: {},
  CopiedLinkCode: {},
  ReadLinkClipboard: { text: Schema.String, typed: Schema.String },
  SucceededRequestLinkCode: { code: Schema.String },
  FailedRequestLinkCode: { problem: LinkProblem },
  SucceededRedeemLinkCode: {},
  FailedRedeemLinkCode: { problem: LinkProblem },
  ClickedProfileSetting: { setting: SettingTile },
  ClickedResetTutorial: {},
  ConfirmedTutorialReset: {},
  CancelledTutorialReset: {},
  ChoseProfileLook: { part: LookPart, value: Schema.String },
  FlippedProfileLook: { toggle: LookToggle },
  RolledProfileLookDice: {},
  ClickedBuyProfileLook: { part: LookPart, value: Schema.String },
  ChoseProfilePropStyle: { style: PropStyle },
}

export const ProfileMessage = UiSchema.TaggedEnum(profileCases)
export type ProfileMessage = typeof ProfileMessage.Type
