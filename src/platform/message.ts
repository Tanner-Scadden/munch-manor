import { Schema } from 'effect'
import { defineMessageUnion } from 'foldkit/message'

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
  CompletedReloadPage: {},
  FailedReloadPage: { reason: Schema.String },
  CompletedRegisterServiceWorker: {},
  FailedRegisterServiceWorker: { reason: Schema.String },
  CompletedUpdateServiceWorker: {},
  FailedUpdateServiceWorker: { reason: Schema.String },
}
export const VersionMessage = defineMessageUnion(versionCases)

// NOTE: the device: full screen, how the screen fits, and the rotation lock
// (src/app/update/fullscreen.ts).
export const deviceCases = {
  ClickedFullscreenButton: {},
  CompletedSetFullscreen: { fullscreen: FullscreenSetting },
  FailedSetFullscreen: { reason: Schema.String },
  ChangedFullscreen: { fullscreen: FullscreenSetting },
  CompletedDetectScreenFit: { screenFit: ScreenFit },
  CompletedDetectOrientationLock: { orientationLock: OrientationLock },
  CompletedApplyRotation: {},
}
export const DeviceMessage = defineMessageUnion(deviceCases)
export type DeviceMessage = typeof DeviceMessage.Type

// NOTE: installing the game: the install tile and Chrome's prompt, handled
// with the home menu (src/app/update/home.ts).
export const installCases = {
  ClickedInstallButton: {},
  ChangedInstallOffer: { installOffer: InstallOffer },
  CompletedShowInstallPrompt: { outcome: InstallOutcome },
}
export const InstallMessage = defineMessageUnion(installCases)

// NOTE: the loading splash's load steps (src/app/update/save.ts).
export const loadCases = {
  CompletedLoadStyles: {},
  CompletedLoadFonts: {},
  FailedLoadFonts: { reason: Schema.String },
  CompletedAwaitFirstFrame: {},
  CompletedDecodeSprites: {},
  CompletedShowLoadProgress: {},
  CompletedHideSplash: {},
}

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

// NOTE: the visit id and the run summaries (src/app/update/save.ts).
export const analyticsCases = {
  CompletedGenerateVisitId: { visitId: Schema.String },
  CompletedStartSummaryQueue: {},
  CompletedSendRunSummary: {},
  FailedSendRunSummary: { reason: Schema.String },
}
