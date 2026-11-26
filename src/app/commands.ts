import { Layer } from 'effect'

import { ChangeLobby } from '#features/coop/steps.ts'
import {
  AnswerOffer,
  CancelQuickPlay,
  LeaveRoom,
  RequestRoom,
  ResyncRoom,
  SendRoomFrames,
} from '#features/coop/update.ts'

import {
  LoadSave,
  ReadRecordUnlock,
  StartRecordingQueue,
  StartSummaryQueue,
} from './boot.ts'
import { ShowInstallPrompt } from './update/home.ts'
import { CueMusic } from './update/music.ts'
import { RedeemLinkCode, RequestLinkCode } from './update/profile.ts'
import { UploadRecording } from './update/recording.ts'
import { ReloadSyncedSave, WriteSave } from './update/save.ts'
import { SendRunSummary } from './update/settle.ts'
import {
  AcquireAudioEngine,
  PlayPlaced,
  PlaySound,
  ResumeAudio,
} from './update/sound.ts'
import { FetchBuild } from './update/version.ts'

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
