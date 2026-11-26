import { Schema } from 'effect'

import { UiSchema } from '@effect/ui'

import { soundCases } from '#audio/message.ts'
import { FriendsDare } from '#domain/beatLink.ts'
import { coopCases } from '#features/coop/message.ts'
import { endCases } from '#features/end/message.ts'
import { homeCases } from '#features/home/message.ts'
import { lobbyCases } from '#features/lobby/message.ts'
import { helpCases } from '#features/menus/message.ts'
import { missionCases } from '#features/missions/message.ts'
import { MunchopediaPage } from '#features/munchopedia/model.ts'
import { onboardingCases } from '#features/onboarding/message.ts'
import { profileCases } from '#features/profile/message.ts'
import { whatsNewCases } from '#features/whatsNew/message.ts'
import { inputCases, runButtonCases } from '#input/message.ts'
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
} from '#platform/message.ts'
import { ZombieKind } from '#world/schema/worldSchema.ts'

import { DialogName } from './menus/rootDialog.ts'

export const frameCases = {
  TickedFrame: { deltaTime: Schema.Finite },
  TickedRoomFrame: { nowMs: Schema.Finite },
  CompletedGenerateSeed: { seed: Schema.Finite },
  CompletedDetectLocalPlayers: { count: Schema.Finite },
  CompletedReadRoomLink: { maybeCode: Schema.Option(Schema.String) },
  CompletedReadBeatLink: { maybeDare: Schema.Option(FriendsDare) },
}

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
