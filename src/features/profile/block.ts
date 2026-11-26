import { Array, Option, Schema } from 'effect'

import { Html } from '@effect/ui/html'

import { Events, Message } from './message'
import { ProfileProps } from './model'
import { PROFILE_TABS } from './profile'
import { profileView } from './view'

const tabNamed = (value: string) =>
  Array.findFirst(PROFILE_TABS, tab => tab === value)

export const Profile = Html.component({
  name: 'Profile',
  props: ProfileProps,
  model: Schema.Struct({}),
  message: Message,
  events: Events,
}).make({
  init: () => ({}),
  update: {
    SelectedTab: ($, { value }) =>
      Option.match(tabNamed(value), {
        onNone: () => $.model,
        onSome: tab => $.emit(Events.SwitchedTab({ tab })),
      }),
    UpdatedNameDraft: ($, { value }) =>
      $.emit(Events.UpdatedNameDraft({ value })),
    SubmittedName: $ => $.emit(Events.SubmittedName()),
    BlurredNameInput: $ => $.emit(Events.BlurredNameInput()),
    ClickedNameDiceButton: $ => $.emit(Events.RolledNameDice()),
    ClickedLinkDeviceButton: $ => $.emit(Events.ClickedLinkDevice()),
    ClickedUseCodeButton: $ => $.emit(Events.ClickedUseCode()),
    UpdatedLinkCode: ($, { value }) =>
      $.emit(Events.UpdatedLinkCode({ value })),
    SubmittedLinkCode: $ => $.emit(Events.SubmittedLinkCode()),
    ClickedCancelLinkButton: $ => $.emit(Events.ClickedCancelLink()),
    SucceededCopyLinkCode: $ => $.emit(Events.CopiedLinkCode()),
    SucceededReadClipboard: ($, { text, typed }) =>
      $.emit(Events.ReadClipboard({ text, typed })),
    ClickedSettingTile: ($, { setting }) =>
      $.emit(Events.ClickedSetting({ setting })),
    ClickedResetTutorialButton: $ => $.emit(Events.ClickedResetTutorial()),
    ClickedConfirmResetTutorialButton: $ =>
      $.emit(Events.ConfirmedTutorialReset()),
    ClickedCancelResetTutorialButton: $ =>
      $.emit(Events.CancelledTutorialReset()),
    ClickedPropStyle: ($, { style }) =>
      $.emit(Events.ChosePropStyle({ style })),
    ChoseLook: ($, { part, value }) =>
      $.emit(Events.ChoseLook({ part, value })),
    FlippedLook: ($, { toggle }) => $.emit(Events.FlippedLook({ toggle })),
    RolledLookDice: $ => $.emit(Events.RolledLookDice()),
    ClickedBuyLook: ($, { part, value }) =>
      $.emit(Events.ClickedBuyLook({ part, value })),
  },
  view: h => profileView(h.props, h),
})
