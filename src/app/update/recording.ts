import { Effect, Option, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { maybeRunOutcome } from '../../platform/analyticsRun'
import {
  RunRecorder,
  RunRecording,
  finishRecording,
} from '../../platform/recording'
import { uploadRecording } from '../../platform/recordingUpload'
import { ApplicationBlock } from '../definition'
import { Message } from '../message'
import type { Model } from '../model'
import { type UpdateStep, defineHandlers } from './step'

// RECORD MY RUNS (src/platform/recording.ts): a recorded run ends with the
// run, and goes up to the Worker when the setting is still on.

// COMMAND

export const UploadRecording = ApplicationBlock.makeCommand('UploadRecording', {
  args: { recording: RunRecording },
  messages: [Message.CompletedUploadRecording, Message.FailedUploadRecording],
  handler: function* () {
    return ({ recording }) =>
      pipe(
        uploadRecording(recording),
        Effect.as(Message.CompletedUploadRecording()),
        Effect.catch(error =>
          Effect.succeed(
            Message.FailedUploadRecording({ reason: error.reason }),
          ),
        ),
      )
  },
})

// NOTE: the run ends as its summary does (maybeRunOutcome): won, lost, or
// left. The recorder goes idle either way; a player who turned the setting
// off mid-run sends nothing.
export const finishRecordingFrom =
  (before: Model): UpdateStep =>
  stepModel =>
    RunRecorder.isAnyOf(['Recording'])(stepModel.recorder) &&
    Option.isSome(maybeRunOutcome(before, stepModel))
      ? {
          model: modifyFields(stepModel, {
            recorder: () => RunRecorder.Idle(),
          }),
          commands:
            stepModel.recordRuns === 'On'
              ? Option.match(finishRecording(stepModel.recorder), {
                  onNone: () => [],
                  onSome: recording => [UploadRecording({ recording })],
                })
              : [],
        }
      : { model: stepModel }

// HANDLERS

export const recordingHandlers = defineHandlers({
  CompletedReadRecordUnlock: (model, { unlock }) => ({
    model: modifyFields(model, { recordUnlock: () => unlock }),
  }),
  CompletedStartRecordingQueue: model => ({ model }),
  CompletedUploadRecording: model => ({ model }),
  FailedUploadRecording: model => ({ model }),
})
