import {
  Array,
  Console,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Schema,
  String,
  pipe,
} from 'effect'
import { FetchHttpClient, HttpClient } from 'effect/http'

import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import * as NodeServices from '@effect/platform-node/NodeServices'

import { RunEnd, RunRecordingJson } from '../../src/platform/recording'
import { bundle } from '../determinism/bundle'
import { commandOutput } from '../determinism/process'

// Plays a recorded run (RECORD MY RUNS, src/platform/recording.ts) back
// through the plain step and checks that it ends as the recording says: the
// same tick count, outcome, wave, and World hash. Run it through the guard:
//
//   bun run learn:replay -- <file or URL>
//
// The file is the recording's JSON, gzipped (as the Worker stores it, the
// key ending .json.gz) or plain. Pull one from R2 with wrangler (see
// TANNER_TODO.md).
//
// Engines round Math.sin and Math.cos apart in the last bit, and the step
// (a spread shot) and the bots' brain (their aim and their runs) use them,
// so a run is exact only in the engine family that played it. The replay
// runs in both families here (engine.ts): Bun for JavaScriptCore (Safari,
// every iPhone browser) and Node for V8 (Chrome, Android, Edge). It passes
// when either ends as the recording did. Firefox's engine has no local
// stand-in, so its runs may come out DIFFERENT.

const USAGE = 'Usage: bun run learn:replay -- <recording file or URL>'

class ReplayError extends Schema.TaggedError<
  ReplayError,
  { readonly brand: unique symbol }
>()('ReplayError', { message: Schema.String }) {}

const failWith = (message: string) => ReplayError.make({ message })

const isUrl = (source: string): boolean =>
  String.startsWith('https://')(source) || String.startsWith('http://')(source)

const bytesOf = (
  source: string,
): Effect.Effect<
  Uint8Array,
  ReplayError,
  FileSystem.FileSystem | HttpClient.HttpClient
> =>
  isUrl(source)
    ? pipe(
        HttpClient.get(source),
        Effect.flatMap(response => response.arrayBuffer),
        Effect.mapBoth({
          onFailure: error => failWith(`${source}: ${error.message}`),
          onSuccess: buffer => new Uint8Array(buffer),
        }),
      )
    : pipe(
        FileSystem.FileSystem.use(fileSystem => fileSystem.readFile(source)),
        Effect.mapError(error => failWith(`${source}: ${error.message}`)),
      )

const GZIP_MAGIC: ReadonlyArray<number> = [0x1f, 0x8b]

const isGzip = (bytes: Uint8Array): boolean =>
  bytes[0] === GZIP_MAGIC[0] && bytes[1] === GZIP_MAGIC[1]

const textOf = (bytes: Uint8Array): Effect.Effect<string, ReplayError> =>
  isGzip(bytes)
    ? Effect.tryPromise({
        try: () =>
          new Response(
            new Blob([Uint8Array.from(bytes)])
              .stream()
              .pipeThrough(new DecompressionStream('gzip')),
          ).text(),
        catch: () => failWith('the recording could not be gunzipped'),
      })
    : Effect.succeed(new TextDecoder().decode(bytes))

const sourceArgument: Effect.Effect<string, ReplayError> = pipe(
  Array.get(process.argv, 2),
  Option.filter(source => source !== '--'),
  Option.orElse(() => Array.get(process.argv, 3)),
  Effect.fromOption,
  Effect.mapError(() => failWith(USAGE)),
)

type EngineName = 'bun' | 'node'

const ENGINES: ReadonlyArray<EngineName> = ['bun', 'node']

const ENGINE_LABELS: { readonly [Engine in EngineName]: string } = {
  bun: 'Bun (JavaScriptCore)',
  node: 'Node (V8)',
}

const here = import.meta.dirname

const commandOf = (engine: EngineName, jsonPath: string) =>
  Effect.gen(function* () {
    const path = yield* Path.Path
    if (engine === 'bun') {
      return {
        command: 'bun',
        args: [path.resolve(here, 'engine.ts'), jsonPath],
      }
    }
    const outdir = path.resolve(here, 'out')
    const bundled = yield* bundle({
      outdir,
      entry: path.resolve(here, 'engine.ts'),
      target: 'node',
      format: 'esm',
    }).pipe(Effect.mapError(error => failWith(error.message)))
    return { command: 'node', args: [bundled, jsonPath] }
  })

const replayIn = (engine: EngineName, jsonPath: string) =>
  Effect.gen(function* () {
    const path = yield* Path.Path
    const { command, args } = yield* commandOf(engine, jsonPath)
    const output = yield* commandOutput({
      command,
      args,
      cwd: path.resolve(here, '../..'),
    }).pipe(Effect.mapError(error => failWith(error.message)))
    return yield* Schema.decodeEffect(Schema.fromJsonString(RunEnd))(
      String.trim(output),
    ).pipe(Effect.mapError(error => failWith(error.message)))
  })

const isSameEnd = (left: RunEnd, right: RunEnd): boolean =>
  left.ticks === right.ticks &&
  left.outcome === right.outcome &&
  left.wave === right.wave &&
  left.hash === right.hash

const endLine = (label: string, end: RunEnd) =>
  `${label}: ${end.ticks} ticks, ${end.outcome} on wave ${end.wave}, hash ${end.hash}`

const program = Effect.scoped(
  Effect.gen(function* () {
    const source = yield* sourceArgument
    const text = yield* Effect.flatMap(bytesOf(source), textOf)
    const recording = yield* pipe(
      Schema.decodeEffect(RunRecordingJson)(text),
      Effect.mapError(error => failWith(`not a recording: ${error.message}`)),
    )
    const fileSystem = yield* FileSystem.FileSystem
    const jsonPath = yield* fileSystem
      .makeTempFileScoped({ prefix: 'replay-', suffix: '.json' })
      .pipe(Effect.mapError(error => failWith(error.message)))
    yield* fileSystem
      .writeFileString(jsonPath, text)
      .pipe(Effect.mapError(error => failWith(error.message)))
    yield* Console.log(
      `run ${recording.runId}, build ${recording.build}, ${recording.settings.mode._tag} on ${recording.settings.difficulty.chosen}`,
    )
    yield* Console.log(endLine('recorded', recording.end))
    const sames = yield* Effect.forEach(ENGINES, engine =>
      Effect.gen(function* () {
        const end = yield* replayIn(engine, jsonPath)
        const isSame = isSameEnd(end, recording.end)
        yield* Console.log(
          `${endLine(ENGINE_LABELS[engine], end)}: ${isSame ? 'SAME' : 'DIFFERENT'}`,
        )
        return isSame
      }),
    )
    if (!Array.some(sames, isSame => isSame)) {
      return yield* failWith('the replay ended differently in every engine')
    }
  }),
)

NodeRuntime.runMain(
  program.pipe(
    Effect.catchTag('ReplayError', error =>
      Effect.andThen(
        Console.error(error.message),
        Effect.sync(() => {
          process.exitCode = 1
        }),
      ),
    ),
    Effect.provide(Layer.merge(NodeServices.layer, FetchHttpClient.layer)),
  ),
)
