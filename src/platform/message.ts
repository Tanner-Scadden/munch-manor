import { Schema } from 'effect'

import { UiSchema } from '@effect/ui'

import { DayStamp } from '../shared/dayStamp'
import { RecordUnlock } from '../shared/playerData'
import {
  FullscreenSetting,
  InstallOffer,
  InstallOutcome,
  OrientationLock,
  PageVisibility,
  ScreenFit,
} from './deviceSchema'
import {
  PlayerChange,
  PlayerScopeStatus,
  RunSettled,
  SyncState,
} from './playerSync'
import { PlayerSave } from './save'

// The root's Messages from the browser and the Worker, by what they are
// about. src/app/message.ts joins them into the root's Message union.

// NOTE: the page itself: focus, visibility, and a restore from the back and
// forward cache. Their handlers are in src/app/update/input.ts.
export const pageCases = {
  BlurredWindow: {},
  FocusedWindow: {},
  ChangedPageVisibility: { visibility: PageVisibility },
  RestoredPageFromCache: {},
}

// NOTE: the build check, the update gift and its greeting, the reload, and
// the service worker (src/app/update/version.ts).
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

// NOTE: the device: full screen, how the screen fits, and the rotation lock
// (src/app/update/fullscreen.ts).
export const deviceCases = {
  ClickedFullscreenButton: {},
  CompletedSetFullscreen: { fullscreen: FullscreenSetting },
  ChangedFullscreen: { fullscreen: FullscreenSetting },
  CompletedDetectScreenFit: { screenFit: ScreenFit },
  CompletedDetectOrientationLock: { orientationLock: OrientationLock },
}
export const DeviceMessage = UiSchema.TaggedEnum(deviceCases)
export type DeviceMessage = typeof DeviceMessage.Type

// NOTE: installing the game: the install tile and Chrome's prompt, handled
// with the home menu (src/app/update/home.ts).
export const installCases = {
  ClickedInstallButton: {},
  ChangedInstallOffer: { installOffer: InstallOffer },
  CompletedShowInstallPrompt: { outcome: InstallOutcome },
}
export const InstallMessage = UiSchema.TaggedEnum(installCases)

// NOTE: the loading splash's load steps (src/app/update/save.ts).
export const loadCases = {
  CompletedLoadStyles: {},
  CompletedLoadFonts: {},
  FailedLoadFonts: { reason: Schema.String },
  CompletedAwaitFirstFrame: {},
  CompletedDecodeSprites: {},
  CompletedHideSplash: {},
}
export const LoadMessage = UiSchema.TaggedEnum(loadCases)

// NOTE: the save and sync (src/app/update/save.ts).
export const saveCases = {
  CompletedLoadSave: { maybeSave: Schema.Option(PlayerSave) },
  FailedLoadSave: { reason: Schema.String },
  CompletedWriteSave: {},
  CompletedWriteSaveWithRun: { runId: Schema.String },
  FailedWriteSave: {
    reason: Schema.String,
    changes: Schema.Array(PlayerChange),
  },
  UpdatedSyncedSave: { save: PlayerSave },
  CompletedReloadSyncedSave: { maybeSave: Schema.Option(PlayerSave) },
  UpdatedSyncStatus: { state: SyncState },
  UpdatedPlayerScopeStatus: { status: PlayerScopeStatus },
  SettledRecordedRun: { runId: Schema.String, settled: RunSettled },
  FailedAwaitRunSettled: { runId: Schema.String, reason: Schema.String },
}
export const SaveMessage = UiSchema.TaggedEnum(saveCases)

// NOTE: the visit id (src/app/update/save.ts). A run summary sent, or the
// queue of them started, reports nothing (src/app/update/settle.ts).
export const analyticsCases = {
  CompletedGenerateVisitId: { visitId: Schema.String },
}

// NOTE: today's day in UTC, from the Today Subscription
// (src/platform/today.ts): the day the first run pays double Bones, and any
// daily reward after it (src/app/update/today.ts).
export const dayCases = {
  ChangedToday: { day: DayStamp },
}

// NOTE: RECORD MY RUNS (src/app/update/recording.ts): this device's unlock.
// The queue of runs waiting for the network, and a finished run sent,
// report nothing.
export const recordingCases = {
  CompletedReadRecordUnlock: { unlock: RecordUnlock },
}
