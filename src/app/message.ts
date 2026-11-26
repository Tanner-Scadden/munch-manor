import { Schema } from 'effect'

import { UiSchema } from '@effect/ui'

import { soundCases } from '../audio/message'
import { FriendsDare } from '../domain/beatLink'
import { coopCases } from '../features/coop/message'
import { endCases } from '../features/end/message'
import { homeCases } from '../features/home/message'
import { lobbyCases } from '../features/lobby/message'
import { helpCases } from '../features/menus/message'
import { missionCases } from '../features/missions/message'
import { MunchopediaPage } from '../features/munchopedia/model'
import { onboardingCases } from '../features/onboarding/message'
import { profileCases } from '../features/profile/message'
import { whatsNewCases } from '../features/whatsNew/message'
import { inputCases, runButtonCases } from '../input/message'
import {
  analyticsCases,
  dayCases,
  deviceCases,
  installCases,
  loadCases,
  pageCases,
  recordingCases,
  saveCases,
  versionCases,
} from '../platform/message'
import { ZombieKind } from '../world/schema/worldSchema'

export const frameCases = {
  TickedFrame: { deltaTime: Schema.Finite },
  TickedRoomFrame: { nowMs: Schema.Finite },
  CompletedGenerateSeed: { seed: Schema.Finite },
  CompletedDetectLocalPlayers: { count: Schema.Finite },
  CompletedReadRoomLink: { maybeCode: Schema.Option(Schema.String) },
  CompletedReadBeatLink: { maybeDare: Schema.Option(FriendsDare) },
}

export const DialogName = Schema.Literals([
  'Profile',
  'Panel',
  'Hand',
  'HomeScreenSteps',
  'UpdateGreeting',
])
export type DialogName = typeof DialogName.Type

export const dialogCases = {
  ClosedDialog: { dialog: DialogName },
  OpenedMunchopediaEntry: { kind: ZombieKind },
  ChangedMunchopediaPage: { page: MunchopediaPage },
}

export const Message = UiSchema.TaggedEnum({
  ...frameCases,
  ...dialogCases,
  ...inputCases,
  ...runButtonCases,
  ...pageCases,
  ...versionCases,
  ...deviceCases,
  ...installCases,
  ...loadCases,
  ...saveCases,
  ...analyticsCases,
  ...dayCases,
  ...recordingCases,
  ...soundCases,
  ...homeCases,
  ...helpCases,
  ...whatsNewCases,
  ...endCases,
  ...onboardingCases,
  ...profileCases,
  ...missionCases,
  ...lobbyCases,
  ...coopCases,
})
export type Message = typeof Message.Type

export type TickedFrame = typeof Message.cases.TickedFrame.Type
export type PressedKey = typeof Message.cases.PressedKey.Type
export type PressedMetaKey = typeof Message.cases.PressedMetaKey.Type
export type MissedKeyDown = typeof Message.cases.MissedKeyDown.Type
export type BlurredWindow = typeof Message.cases.BlurredWindow.Type
export type FocusedWindow = typeof Message.cases.FocusedWindow.Type
export type ChangedPageVisibility =
  typeof Message.cases.ChangedPageVisibility.Type
export type RestoredPageFromCache =
  typeof Message.cases.RestoredPageFromCache.Type
export type ReleasedPointer = typeof Message.cases.ReleasedPointer.Type
export type CancelledPointer = typeof Message.cases.CancelledPointer.Type
export type ChangedTouches = typeof Message.cases.ChangedTouches.Type
export type MeasuredGameSurface = typeof Message.cases.MeasuredGameSurface.Type
export type TappedWithTouch = typeof Message.cases.TappedWithTouch.Type
export type SettledShare = typeof Message.cases.SettledShare.Type
export type PressedPointer = typeof Message.cases.PressedPointer.Type
