import { Layer } from 'effect'

import { ChangeLobby } from '../features/coop/steps'
import {
  AnswerOffer,
  CancelQuickPlay,
  LeaveRoom,
  RequestRoom,
  ResyncRoom,
  SendRoomFrames,
} from '../features/coop/update'
import {
  LoadSave,
  ReadRecordUnlock,
  StartRecordingQueue,
  StartSummaryQueue,
} from './boot'
import { ShowInstallPrompt } from './update/home'
import { CueMusic } from './update/music'
import { RedeemLinkCode, RequestLinkCode } from './update/profile'
import { UploadRecording } from './update/recording'
import { AwaitRunSettled, ReloadSyncedSave, WriteSave } from './update/save'
import { SendRunSummary } from './update/settle'
import {
  AcquireAudioEngine,
  PlayPlaced,
  PlaySound,
  ResumeAudio,
} from './update/sound'
import { FetchBuild } from './update/version'

// NOTE: the root's Command services (Effect UI, "Put I/O behind a
// Service"): each Command that needs a service (the store, the audio
// engine, co-op's network, the install prompt) sits beside the update that
// issues it, and its `.layer` joins this list. A `Command.make` needs none.
export const CommandsLayer = Layer.mergeAll(
  LoadSave.layer,
  StartSummaryQueue.layer,
  ReadRecordUnlock.layer,
  StartRecordingQueue.layer,
  SendRunSummary.layer,
  CueMusic.layer,
  UploadRecording.layer,
  RequestLinkCode.layer,
  RedeemLinkCode.layer,
  WriteSave.layer,
  AwaitRunSettled.layer,
  ReloadSyncedSave.layer,
  ShowInstallPrompt.layer,
  AcquireAudioEngine.layer,
  ResumeAudio.layer,
  PlaySound.layer,
  PlayPlaced.layer,
  FetchBuild.layer,
  ChangeLobby.layer,
  RequestRoom.layer,
  AnswerOffer.layer,
  CancelQuickPlay.layer,
  SendRoomFrames.layer,
  LeaveRoom.layer,
  ResyncRoom.layer,
)
