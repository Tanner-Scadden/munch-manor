// One recorded run played back in the engine that runs this file, its end
// printed as JSON: Bun (JavaScriptCore) runs it as it is, Node (V8) from
// the bundle replay.ts builds. replay.ts runs it; it takes the path of the
// recording's plain JSON.
//   node tools/learn/out/engine.js <recording.json>

import '../determinism/globals'
import { Array, Console, Effect, FileSystem, Result, Schema } from 'effect'

import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import * as NodeServices from '@effect/platform-node/NodeServices'

import { RunEnd, RunRecordingJson } from '../../src/platform/recording'
import { encodeJson } from '../json'
import { replayRecording } from './replayRun'

class EngineReplayFailed extends Schema.TaggedError<
  EngineReplayFailed,
  { readonly brand: unique symbol }
>()('EngineReplayFailed', { message: Schema.String }) {}

const failWith = (message: string) => EngineReplayFailed.make({ message })

const program = Effect.gen(function* () {
  const path = yield* Effect.fromOption(Array.get(process.argv, 2)).pipe(
    Effect.mapError(() => failWith('Usage: engine <recording.json>')),
  )
  const fileSystem = yield* FileSystem.FileSystem
  const text = yield* fileSystem
    .readFileString(path)
    .pipe(Effect.mapError(error => failWith(error.message)))
  const recording = yield* Schema.decodeEffect(RunRecordingJson)(text).pipe(
    Effect.mapError(error => failWith(error.message)),
  )
  const result = yield* Result.match(replayRecording(recording), {
    onFailure: reason => Effect.fail(failWith(reason)),
    onSuccess: Effect.succeed,
  })
  yield* Console.log(encodeJson(RunEnd)(result.replayed))
})

NodeRuntime.runMain(
  program.pipe(
    Effect.catchTag('EngineReplayFailed', error =>
      Effect.andThen(
        Console.error(error.message),
        Effect.sync(() => {
          process.exitCode = 1
        }),
      ),
    ),
    Effect.provide(NodeServices.layer),
  ),
)
