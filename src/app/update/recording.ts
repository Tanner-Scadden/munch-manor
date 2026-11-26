import { Effect, Option, pipe } from 'effect'

import { Command, Component } from '@effect/ui'

import type { Model } from '#app/model.ts'
import { maybeRunOutcome } from '#platform/analyticsRun.ts'
import {
  RunRecorder,
  RunRecording,
  finishRecording,
} from '#platform/recording.ts'
import { uploadRecording } from '#platform/recordingUpload.ts'
import { PlayerStore } from '#platform/store.ts'

import { type UpdateStep, defineHandlers } from './step.ts'

export class UploadRecording extends Command.Service<UploadRecording>()(
  'app/UploadRecording',
  { args: { recording: RunRecording }, success: Component.Noop },
) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const store = yield* PlayerStore
      return ({ recording }) =>
        pipe(
          uploadRecording(recording),
          Effect.provideService(PlayerStore, store),
          Effect.catch(error =>
            Effect.logWarning('upload recording', error.reason),
          ),
          Effect.as(Component.noop),
        )
    }),
  )
}

export const finishRecordingFrom =
  (before: Model): UpdateStep =>
  $ =>
    RunRecorder.isAnyOf(['Recording'])($.model.recorder) &&
    Option.isSome(maybeRunOutcome(before, $.model))
      ? $.evolve({ recorder: RunRecorder.Idle() }).run(
          ...($.model.settings.recordRuns === 'On'
            ? Option.match(finishRecording($.model.recorder), {
                onNone: () => [],
                onSome: recording => [UploadRecording.make({ recording })],
              })
            : []),
        )
      : $.model

export const recordingHandlers = defineHandlers({
  CompletedReadRecordUnlock: ($, { unlock }) =>
    $.evolve({
      recordUnlock: current => (unlock === 'Unlocked' ? unlock : current),
    }),
})
