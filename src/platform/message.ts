import { Schema } from 'effect'

import { UiSchema } from '@effect/ui'

import { DayStamp } from '#shared/records/dayStamp.ts'
import { RecordUnlock } from '#shared/records/playerData.ts'

import {
  FullscreenSetting,
  InstallOffer,
  InstallOutcome,
  OrientationLock,
  PageVisibility,
  ScreenFit,
} from './deviceSchema.ts'
import { PlayerChange, SyncState } from './save/playerSync.ts'
import { PlayerSave } from './save/save.ts'

export const pageCases = {
  BlurredWindow: {},
  FocusedWindow: {},
  ChangedPageVisibility: { visibility: PageVisibility },
  RestoredPageFromCache: {},
}

export const versionCases = {
  TickedUpdateCheck: {},
  CompletedFetchBuild: { build: Schema.String },
  FailedFetchBuild: { reason: Schema.String },
  ClickedUpdateButton: {},
  CompletedWaitForUnwrap: {},
  CompletedReadUpdateMarker: { maybeBuild: Schema.Option(Schema.String) },
  ClickedUpdateGreetingNewsButton: {},
  FailedReloadPage: { reason: Schema.String },
}
export const VersionMessage = UiSchema.TaggedEnum(versionCases)

export const deviceCases = {
  ClickedFullscreenButton: {},
  CompletedSetFullscreen: { fullscreen: FullscreenSetting },
  ChangedFullscreen: { fullscreen: FullscreenSetting },
  CompletedDetectScreenFit: { screenFit: ScreenFit },
  CompletedDetectOrientationLock: { orientationLock: OrientationLock },
}
export const DeviceMessage = UiSchema.TaggedEnum(deviceCases)
export type DeviceMessage = typeof DeviceMessage.Type

export const installCases = {
  ClickedInstallButton: {},
  ChangedInstallOffer: { installOffer: InstallOffer },
  CompletedShowInstallPrompt: { outcome: InstallOutcome },
}
export const InstallMessage = UiSchema.TaggedEnum(installCases)

export const loadCases = {
  CompletedLoadStyles: {},
  CompletedLoadFonts: {},
  FailedLoadFonts: { reason: Schema.String },
  CompletedAwaitFirstFrame: {},
  CompletedDecodeSprites: {},
  CompletedHideSplash: {},
}
export const LoadMessage = UiSchema.TaggedEnum(loadCases)

export const saveCases = {
  CompletedLoadSave: { maybeSave: Schema.Option(PlayerSave) },
  FailedLoadSave: { reason: Schema.String },
  CompletedWriteSave: {},
  FailedWriteSave: {
    reason: Schema.String,
    changes: Schema.Array(PlayerChange),
  },
  UpdatedSyncedSave: { save: PlayerSave },
  CompletedReloadSyncedSave: { maybeSave: Schema.Option(PlayerSave) },
  UpdatedSyncStatus: { state: SyncState },
}
export const SaveMessage = UiSchema.TaggedEnum(saveCases)

export const analyticsCases = {
  CompletedGenerateVisitId: { visitId: Schema.String },
}

export const dayCases = {
  ChangedToday: { day: DayStamp },
}

export const recordingCases = {
  CompletedReadRecordUnlock: { unlock: RecordUnlock },
}
