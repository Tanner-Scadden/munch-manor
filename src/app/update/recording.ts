import { Effect, Option, pipe } from 'effect'

import { Command, Component } from '@effect/ui'

import { maybeRunOutcome } from '../../platform/analyticsRun'
import {
  RunRecorder,
  RunRecording,
  finishRecording,
} from '../../platform/recording'
import { uploadRecording } from '../../platform/recordingUpload'
import { PlayerStore } from '../../platform/store'
import type { Model } from '../model'
import { type UpdateStep, defineHandlers } from './step'

// RECORD MY RUNS (src/platform/recording.ts): a recorded run ends with the
// run, and goes up to the Worker when the setting is still on.

// COMMAND

// NOTE: a run that cannot go up waits in the store's queue, so the Model
// hears nothing either way: a failure is logged.
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

// NOTE: the run ends as its summary does (maybeRunOutcome): won, lost, or
// left. The recorder goes idle either way; a player who turned the setting
// off mid-run sends nothing.
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

// HANDLERS

export const recordingHandlers = defineHandlers({
  // NOTE: the boot only ever unlocks: a save read or synced as unlocked
  // stays so.
  CompletedReadRecordUnlock: ($, { unlock }) =>
    $.evolve({
      recordUnlock: current => (unlock === 'Unlocked' ? unlock : current),
    }),
})
