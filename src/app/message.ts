import { Schema } from 'effect'
import { defineMessageUnion } from 'foldkit/message'

import { soundCases } from '../audio/message'
import { FriendsDare } from '../domain/beatLink'
import { endCases } from '../features/end/message'
import { homeCases } from '../features/home/message'
import { helpCases } from '../features/menus/message'
import { missionCases } from '../features/missions/message'
import { onboardingCases } from '../features/onboarding/message'
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

// NOTE: the root's own Messages: the frames, the seed, the couch's players,
// and a room link and a SHARE link read at start. Their handlers are in
// src/app/main.ts, src/app/update/coop.ts, and src/app/update/beatMyRun.ts.
export const frameCases = {
  TickedFrame: { deltaTime: Schema.Finite },
  TickedRoomFrame: { nowMs: Schema.Finite },
  CompletedGenerateSeed: { seed: Schema.Finite },
  CompletedDetectLocalPlayers: { count: Schema.Finite },
  CompletedReadRoomLink: { maybeCode: Schema.Option(Schema.String) },
  CompletedReadBeatLink: { maybeDare: Schema.Option(FriendsDare) },
  CompletedForgetBeatLink: {},
}

// NOTE: the root's Message union is the one flat join of every group, each
// declared by the feature that sends it (AGENTS.md "Folders"), so
// `Message.X(...)` and the generated `Got*` envelopes stay as they were. No
// two groups may name the same tag (src/app/__tests__/message.test.ts).
export const Message = defineMessageUnion({
  ...frameCases,
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
  ...missionCases,
})
export type Message = typeof Message.Type

export type TickedFrame = typeof Message.TickedFrame.Type
export type PressedKey = typeof Message.PressedKey.Type
export type PressedMetaKey = typeof Message.PressedMetaKey.Type
export type MissedKeyDown = typeof Message.MissedKeyDown.Type
export type BlurredWindow = typeof Message.BlurredWindow.Type
export type FocusedWindow = typeof Message.FocusedWindow.Type
export type ChangedPageVisibility = typeof Message.ChangedPageVisibility.Type
export type RestoredPageFromCache = typeof Message.RestoredPageFromCache.Type
export type ReleasedPointer = typeof Message.ReleasedPointer.Type
export type CancelledPointer = typeof Message.CancelledPointer.Type
export type ReleasedEveryTouch = typeof Message.ReleasedEveryTouch.Type
export type MeasuredGameSurface = typeof Message.MeasuredGameSurface.Type
export type TappedWithTouch = typeof Message.TappedWithTouch.Type
export type SettledShare = typeof Message.SettledShare.Type
export type PressedPointer = typeof Message.PressedPointer.Type
