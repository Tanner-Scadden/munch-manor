import { Function, Option } from 'effect'

import { PROFILE_DIALOG_ID } from '../domain/clientSchema'
import { hasUnseenLook } from '../domain/unlocks'
import { startingCallingOf } from '../features/heroes/callingPick'
import { Profile } from '../features/profile/block'
import type { ProfileProps } from '../features/profile/model'
import { tabOf } from '../features/profile/profile'
import { isPortrait } from '../render/screen'
import { closeButtonView } from '../ui/cornerButtons'
import { dialogShellView } from '../ui/dialog'
import { rankPlateView } from '../ui/rankBadgeView'
import { rankOf, totalPointsOf } from '../world/heroes/rank'
import type { ApplicationHtml, ApplicationViewBuilder } from './definition'
import { Message } from './message'
import type { Model } from './model'

export const profilePropsOf = (model: Model): ProfileProps => ({
  state: model.profile,
  appearance: model.appearance,
  calling: startingCallingOf(model),
  picked: model.calling,
  screenMs: model.screenMs,
  bought: model.boughtCosmetics,
  rank: model.rank,
  fresh: model.freshUnlocks,
  isLookNew: hasUnseenLook(
    rankOf(totalPointsOf(model.rank)),
    model.seenUnlocks,
  ),
  mastery: model.mastery,
  isPortrait: isPortrait(model),
  device: model.lastDevice,
  sync: {
    state: model.saving.syncState,
  },
  settings: {
    sound: model.settings.soundSetting,
    music: model.settings.musicSetting,
    shake: model.settings.shakeSetting,
    cursor: model.settings.cursorSetting,
    fullscreen: model.settings.fullscreen,
    rotation: model.settings.rotationSetting,
    rumble: model.settings.rumbleSetting,
    hasPad:
      model.lastDevice === 'Gamepad' || Option.isSome(model.input.maybeGamepad),
    recordRuns: model.settings.recordRuns,
    recordUnlock: model.recordUnlock,
    shareStats: model.settings.shareStats,
    screenFit: model.settings.screenFit,
    orientationLock: model.orientationLock,
  },
})

const profileComponentView = (
  model: Model,
  h: ApplicationViewBuilder,
): ApplicationHtml =>
  Profile(h, {
    key: 'profile-panel',
    props: profilePropsOf(model),
    onEmit: {
      SwitchedTab: ({ tab }) => Message.SwitchedProfileTab({ tab }),
      UpdatedNameDraft: ({ value }) =>
        Message.UpdatedProfileNameDraft({ value }),
      SubmittedName: () => Message.SubmittedProfileName(),
      BlurredNameInput: () => Message.BlurredProfileName(),
      RolledNameDice: () => Message.RolledProfileNameDice(),
      ClickedLinkDevice: () => Message.ClickedLinkDevice(),
      ClickedUseCode: () => Message.ClickedUseLinkCode(),
      UpdatedLinkCode: ({ value }) => Message.UpdatedLinkCode({ value }),
      SubmittedLinkCode: () => Message.SubmittedLinkCode(),
      ClickedCancelLink: () => Message.ClickedCancelLink(),
      CopiedLinkCode: () => Message.CopiedLinkCode(),
      ReadClipboard: ({ text, typed }) =>
        Message.ReadLinkClipboard({ text, typed }),
      ClickedSetting: ({ setting }) =>
        Message.ClickedProfileSetting({ setting }),
      ClickedResetTutorial: () => Message.ClickedResetTutorial(),
      ConfirmedTutorialReset: () => Message.ConfirmedTutorialReset(),
      CancelledTutorialReset: () => Message.CancelledTutorialReset(),
      ChosePropStyle: ({ style }) => Message.ChoseProfilePropStyle({ style }),
      ChoseLook: ({ part, value }) => Message.ChoseProfileLook({ part, value }),
      FlippedLook: ({ toggle }) => Message.FlippedProfileLook({ toggle }),
      RolledLookDice: () => Message.RolledProfileLookDice(),
      ClickedBuyLook: ({ part, value }) =>
        Message.ClickedBuyProfileLook({ part, value }),
    },
  })

export const profileDialogView: {
  (h: ApplicationViewBuilder): (model: Model) => ApplicationHtml
  (model: Model, h: ApplicationViewBuilder): ApplicationHtml
} = Function.dual(
  2,
  (model: Model, h: ApplicationViewBuilder): ApplicationHtml =>
    dialogShellView({
      h,
      id: PROFILE_DIALOG_ID,
      isOpen: model.profileDialog.isOpen,
      dialogClass: 'profile-dialog',
      backdropClass: 'profile-backdrop',
      panelClass: 'profile',
      isCentered: true,
      data: { tab: tabOf(model.profile), device: model.lastDevice },
      onClose: Message.ClosedDialog({ dialog: 'Profile' }),
      insides: parts => [
        parts.title(h.h2.class('sr-only')).children('Profile'),
        parts
          .description(h.p.class('sr-only'))
          .children('Your look, your name, your devices, and the settings.'),
        closeButtonView(
          {
            button: parts.close(h.button),
            className: 'panel-close',
            label: 'Close',
          },
          h,
        ),
        profileComponentView(model, h),
        rankPlateView(model, h),
      ],
    }),
)
