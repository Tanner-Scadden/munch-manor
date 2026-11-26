import { Schema } from 'effect'

import { UiSchema } from '@effect/ui'

import { LookPart } from '../../domain/looks'
import { LinkProblem } from '../../platform/playerSync'
import { PropStyle } from '../../shared/playerData'
import { LookToggle } from './blocks/look/lookSchema'
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
  'Rumble',
  'ShareStats',
  'RecordRuns',
])
export type SettingTile = typeof SettingTile.Type

// NOTE: the Profile component's own facts: a tab, the name field and its
// dice, the link flow's buttons and field, the code copied and the
// clipboard read (its Mounts, linkClipboard.ts), a tile, the tutorial
// reset, a prop style, and the Look tab's events passed up. A tab comes
// from ui-kit's Tabs as a string, read back to its literal in the update.
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

// NOTE: what happened in the Profile, for the root to act on. The root owns
// the panel's state (the tab, the draft, the link flow, the tutorial reset,
// the try-on) and what the game reads (the name, the settings, the look,
// the Bones), so every one of them goes up, and the root answers by the
// props. The dice draw from the root's seeded generator.
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

// NOTE: the root's Messages from the Profile, joined into the root's union
// (src/app/message.ts): each of its events, and the device link Commands'
// answers. Their handlers are `profileHandlers` in
// src/app/update/profile.ts.
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

// NOTE: the Profile's root Messages as their own union, for the device link
// Commands' `success`.
export const ProfileMessage = UiSchema.TaggedEnum(profileCases)
export type ProfileMessage = typeof ProfileMessage.Type
