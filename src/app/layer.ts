import { Layer } from 'effect'

import {
  AwaitFirstFrame,
  DecodeSprites,
  DetectInputDevice,
  DetectLocalPlayers,
  DetectOrientationLock,
  DetectScreenFit,
  DetectShareSheet,
  GenerateSeed,
  GenerateVisitId,
  LoadFonts,
  LoadSave,
  LoadStyles,
  ReadUpdateMarker,
  StartSummaryQueue,
} from './boot'
import { ListenForTouchTaps, MeasureGameSurface, ShareFromClick } from './mount'
import { subscriptions } from './subscriptions'
import { ReadRoomLink } from './update/coop'
import { SendShareEvent } from './update/end'
import { SetFullscreen } from './update/fullscreen'
import {
  ClickSupportLink,
  FocusEndMenuButton,
  FocusHandCard,
  FocusHomeButton,
  ReloadPage,
  ShowInstallPrompt,
  WaitForUnwrap,
} from './update/home'
import { CueMusic } from './update/music'
import {
  ClickPadFocus,
  EscapePadDialog,
  MovePadFocus,
  StepPadTab,
} from './update/padMenu'
import { ApplyRotation } from './update/rotation'
import { Rumble } from './update/rumble'
import {
  AwaitRunSettled,
  HideSplash,
  ReloadSyncedSave,
  ShowLoadProgress,
  WriteSave,
} from './update/save'
import { SendRunSummary } from './update/settle'
import {
  PlaySound,
  PlayTune,
  ResumeAudio,
  managedResources,
} from './update/sound'
import {
  FetchBuild,
  RegisterServiceWorker,
  UpdateServiceWorker,
} from './update/version'

// NOTE: every root Command's handler and the audio resource's lifecycle. Each
// Command sits beside the update that returns it; its `.layer` joins this
// list, or the Block's assembly reports its handler missing.
export const CommandsLayer = Layer.mergeAll(
  GenerateSeed.layer,
  DetectInputDevice.layer,
  DetectShareSheet.layer,
  DetectScreenFit.layer,
  ShowInstallPrompt.layer,
  DetectLocalPlayers.layer,
  DetectOrientationLock.layer,
  ApplyRotation.layer,
  SetFullscreen.layer,
  ResumeAudio.layer,
  PlaySound.layer,
  PlayTune.layer,
  Rumble.layer,
  CueMusic.layer,
  FetchBuild.layer,
  WaitForUnwrap.layer,
  ReloadPage.layer,
  ReadUpdateMarker.layer,
  RegisterServiceWorker.layer,
  UpdateServiceWorker.layer,
  FocusHomeButton.layer,
  MovePadFocus.layer,
  ClickPadFocus.layer,
  StepPadTab.layer,
  EscapePadDialog.layer,
  FocusHandCard.layer,
  FocusEndMenuButton.layer,
  ClickSupportLink.layer,
  SendShareEvent.layer,
  LoadStyles.layer,
  LoadFonts.layer,
  AwaitFirstFrame.layer,
  DecodeSprites.layer,
  ShowLoadProgress.layer,
  HideSplash.layer,
  ReadRoomLink.layer,
  LoadSave.layer,
  WriteSave.layer,
  AwaitRunSettled.layer,
  ReloadSyncedSave.layer,
  GenerateVisitId.layer,
  StartSummaryQueue.layer,
  SendRunSummary.layer,
  managedResources.layer,
)

// NOTE: the root's own handlers: its Commands and the audio resource, its
// Subscriptions, and its Mounts. Each child Block brings its own through its
// Binding (src/app/composition.ts).
export const EffectsLayer = Layer.mergeAll(
  CommandsLayer,
  subscriptions.layer,
  MeasureGameSurface.layer,
  ListenForTouchTaps.layer,
  ShareFromClick.layer,
)
