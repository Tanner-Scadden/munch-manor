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
import { CueMusic } from './musicPlan'
import { subscriptions } from './subscriptions'
import { FocusLookOption } from './update/character'
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
import { FocusLobbyControl } from './update/lobby'
import { ApplyRotation } from './update/rotation'
import {
  AwaitRunSettled,
  FocusTutorialReset,
  HideSplash,
  RedeemLinkCode,
  ReloadSyncedSave,
  RequestLinkCode,
  ShowLoadProgress,
  WriteSave,
} from './update/save'
import { SendRunSummary } from './update/settle'
import { FocusShopItem } from './update/shop'
import { PlaySound, ResumeAudio, managedResources } from './update/sound'
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
  CueMusic.layer,
  FocusLookOption.layer,
  FocusShopItem.layer,
  FetchBuild.layer,
  WaitForUnwrap.layer,
  ReloadPage.layer,
  ReadUpdateMarker.layer,
  RegisterServiceWorker.layer,
  UpdateServiceWorker.layer,
  FocusHomeButton.layer,
  FocusHandCard.layer,
  FocusLobbyControl.layer,
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
  RequestLinkCode.layer,
  RedeemLinkCode.layer,
  GenerateVisitId.layer,
  StartSummaryQueue.layer,
  SendRunSummary.layer,
  FocusTutorialReset.layer,
  managedResources.layer,
)

// NOTE: the root's own handlers: its Commands and the audio resource, its
// Subscriptions, and its Mounts. Each child Block brings its own through its
// Binding (src/composition.ts).
export const EffectsLayer = Layer.mergeAll(
  CommandsLayer,
  subscriptions.layer,
  MeasureGameSurface.layer,
  ListenForTouchTaps.layer,
  ShareFromClick.layer,
)
