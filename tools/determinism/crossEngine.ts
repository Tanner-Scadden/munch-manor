// The cross-engine determinism check: the same scripted run, fed the same
// inputs, in Bun (JavaScriptCore, Safari's engine), Node (V8), headless
// Chrome (V8, a browser), and workerd (V8, the runtime of Durable Objects).
// Each engine hashes the gameplay state (see fields.ts and hash.ts) every N
// frames. For every pair that disagrees, it finds the exact first frame,
// dumps both engines' state at that frame, and reports which fields differ
// and the first path inside them, with both values.
//
// Heavy (each engine plays the whole run), so run it through the guard:
//   bun run determinism -- [options]
//
// Options:
//   --frames N           frames to play (default 18000, 5 minutes)
//   --seed S             the run's seed (default 1)
//   --mode Endless       endless instead of the campaign
//   --pattern Mixed      variable frame lengths instead of a fixed 60 Hz step
//   --every N            hash every N frames (default 1)
//   --det-math           swap in the deterministic Math of detMath.ts first
//   --engines a,b        any of bun,node,chrome,workerd (default all four)
//   --no-build           reuse out/ from the last build
//   --json               print the report as JSON
//
// It exits 1 when any two engines disagree. Today the engines' own Math
// makes JavaScriptCore and V8 disagree within the first two seconds, so
// without --det-math that is expected (see README.md).

import {
  Array,
  Clock,
  Config,
  Console,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Schema,
  String,
} from 'effect'
import { FetchHttpClient, HttpClientRequest } from 'effect/http'
import { pathToFileURL } from 'node:url'

import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import * as NodeServices from '@effect/platform-node/NodeServices'

import { askWorkerd } from './askWorkerd'
import {
  type Difference,
  firstDifference,
  firstDivergentCheckpoint,
  jsonTextOf,
  revive,
} from './diff'
import { commandOutput, infraBinary, serveWorkerd } from './process'
import {
  DEFAULT_REQUEST,
  EngineRequest,
  type EngineRun,
  decodeEngineDump,
  decodeEngineError,
  decodeEngineRun,
  paramsOf,
} from './request'

const here = import.meta.dirname

const WORKERD_PORT = 8797

type EngineName = 'bun' | 'node' | 'chrome' | 'workerd'
const ALL_ENGINES: ReadonlyArray<EngineName> = [
  'bun',
  'node',
  'chrome',
  'workerd',
]

class EngineFailed extends Schema.TaggedError<
  EngineFailed,
  { readonly brand: unique symbol }
>()('EngineFailed', { message: Schema.String }) {}

class EnginesDisagree extends Schema.TaggedError<
  EnginesDisagree,
  { readonly brand: unique symbol }
>()('EnginesDisagree', { pairs: Schema.Finite }) {}

// NOTE: the value an Option holds, or the run fails with `reason`.
const orFail = <A>(
  maybe: Option.Option<A>,
  reason: string,
): Effect.Effect<A, EngineFailed> =>
  Effect.fromOption(maybe).pipe(
    Effect.mapError(() => EngineFailed.make({ message: reason })),
  )

// ARGUMENTS

const argv = process.argv.slice(2)
const flag = (name: string): boolean => argv.includes(name)
const option = (name: string): string | undefined => {
  const at = argv.indexOf(name)
  return at === -1 ? undefined : argv[at + 1]
}

const request: EngineRequest = {
  ...DEFAULT_REQUEST,
  frames: Number(option('--frames') ?? DEFAULT_REQUEST.frames),
  seed: Number(option('--seed') ?? DEFAULT_REQUEST.seed),
  mode: option('--mode') === 'Endless' ? 'Endless' : 'Campaign',
  pattern: option('--pattern') === 'Mixed' ? 'Mixed' : 'Fixed60',
  every: Number(option('--every') ?? DEFAULT_REQUEST.every),
  detMath: flag('--det-math'),
}
const engines = Array.flatMap(
  String.split(',')(option('--engines') ?? Array.join(ALL_ENGINES, ',')),
  name => Array.filter(ALL_ENGINES, engine => engine === name),
)
const asJson = flag('--json')

// ENGINES

const unescapeHtml = (text: string): string =>
  String.replaceAll(
    '&amp;',
    '&',
  )(
    String.replaceAll(
      '&#39;',
      "'",
    )(
      String.replaceAll(
        '&quot;',
        '"',
      )(String.replaceAll('&gt;', '>')(String.replaceAll('&lt;', '<')(text))),
    ),
  )

const rootOf = Effect.gen(function* () {
  const path = yield* Path.Path
  return path.resolve(here, '../..')
})

const runCommand = (command: string, args: ReadonlyArray<string>) =>
  Effect.flatMap(rootOf, cwd =>
    commandOutput({ command, args, cwd }).pipe(
      Effect.mapError(error => EngineFailed.make({ message: error.message })),
    ),
  )

const outPath = (file: string) =>
  Effect.gen(function* () {
    const path = yield* Path.Path
    return path.resolve(here, 'out', file)
  })

const runChrome = (params: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const chrome = yield* Config.String('CHROME').pipe(
        Config.withDefault(
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        ),
      )
      // NOTE: a throwaway profile, so the run never touches the owner's
      // Chrome. It goes with the scope.
      const profile = yield* fs.makeTempDirectoryScoped({
        prefix: 'determinism-chrome-',
      })
      const page = yield* outPath('page.html')
      const dom = yield* runCommand(chrome, [
        '--headless',
        '--disable-gpu',
        '--no-first-run',
        '--disable-extensions',
        `--user-data-dir=${profile}`,
        '--dump-dom',
        `${pathToFileURL(page).href}?${params}`,
      ])
      const answer = Option.flatMap(
        String.match(/<pre id="answer">([\s\S]*?)<\/pre>/)(dom),
        found => Option.fromNullishOr(found[1]),
      )
      const text = yield* orFail(
        answer,
        `Chrome printed no answer: ${String.slice(0, 400)(dom)}`,
      )
      return unescapeHtml(text)
    }),
  )

const runWorkerd = (params: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const path = yield* Path.Path
      const root = yield* rootOf
      const override = yield* Config.option(Config.String('WORKERD'))
      const maybeBinary = yield* infraBinary({
        root,
        name: 'workerd',
        override,
      })
      const binary = yield* orFail(
        maybeBinary,
        'no workerd: run bun install in infra/, or set WORKERD',
      )
      yield* serveWorkerd({
        binary,
        config: path.resolve(here, 'workerd.capnp'),
        cwd: here,
      })
      return yield* askWorkerd(
        HttpClientRequest.get(`http://127.0.0.1:${WORKERD_PORT}/?${params}`),
      )
    }),
  )

const textFrom = (engine: EngineName, params: string) => {
  switch (engine) {
    case 'bun':
      return runCommand('bun', ['tools/determinism/cli.ts', params])
    case 'node':
      return Effect.flatMap(outPath('cli.js'), cli =>
        runCommand('node', [cli, params]),
      )
    case 'chrome':
      return runChrome(params)
    case 'workerd':
      return runWorkerd(params)
  }
}

const ask = (engine: EngineName, ofRequest: EngineRequest) =>
  Effect.gen(function* () {
    const text = yield* textFrom(engine, paramsOf(ofRequest))
    const maybeError = decodeEngineError(text)
    if (Option.isSome(maybeError)) {
      return yield* EngineFailed.make({
        message: `${engine}: ${globalThis.String(maybeError.value.error)}`,
      })
    }
    return text
  })

const askRun = (engine: EngineName, ofRequest: EngineRequest) =>
  Effect.flatMap(ask(engine, ofRequest), text =>
    orFail(decodeEngineRun(text), `${engine} answered no run`),
  )

const askDump = (engine: EngineName, frame: number) =>
  Effect.flatMap(ask(engine, { ...request, dump: frame }), text =>
    orFail(
      decodeEngineDump(text),
      `${engine} answered no dump for frame ${frame}`,
    ),
  )

// THE CHECK

type Divergence = Readonly<{
  a: EngineName
  b: EngineName
  frame: number
  fields: ReadonlyArray<string>
  difference: Difference | undefined
}>

type Pair = Readonly<{ a: EngineName; b: EngineName }>

const pairsOf = (names: ReadonlyArray<EngineName>): ReadonlyArray<Pair> =>
  Array.flatMap(names, (a, index) =>
    Array.map(names.slice(index + 1), b => ({ a, b })),
  )

const exactFrame = (pair: Pair, checkpointFrame: number) =>
  Effect.gen(function* () {
    if (request.every === 1 || checkpointFrame < 0) {
      return checkpointFrame
    }
    const narrowed = { ...request, every: 1, frames: checkpointFrame + 1 }
    const left = yield* askRun(pair.a, narrowed)
    const right = yield* askRun(pair.b, narrowed)
    return (
      firstDivergentCheckpoint(left.checkpoints, right.checkpoints)?.frame ??
      checkpointFrame
    )
  })

const explain = (pair: Pair, frame: number) =>
  Effect.gen(function* () {
    if (frame < 0) {
      const started: Divergence = {
        ...pair,
        frame,
        fields: ['(the started run)'],
        difference: undefined,
      }
      return started
    }
    const left = yield* askDump(pair.a, frame)
    const right = yield* askDump(pair.b, frame)
    const rightHashes = new Map(right.fieldHashes)
    const fields = Array.map(
      Array.filter(
        left.fieldHashes,
        ([field, hash]) => rightHashes.get(field) !== hash,
      ),
      ([field]) => field,
    )
    const divergence: Divergence = {
      ...pair,
      frame,
      fields,
      difference: firstDifference(revive(left.state), revive(right.state)),
    }
    return divergence
  })

const playEngines = Effect.forEach(engines, engine =>
  Effect.gen(function* () {
    const startedAt = yield* Clock.currentTimeMillis
    const run = yield* askRun(engine, request)
    if (!asJson) {
      const endedAt = yield* Clock.currentTimeMillis
      yield* Console.error(
        `${run.engine}: ${run.frames} frames in ${((endedAt - startedAt) / 1000).toFixed(1)} s`,
      )
    }
    return [engine, run] as const
  }),
)

const divergencesOf = (
  runs: ReadonlyArray<readonly [EngineName, EngineRun]>,
) => {
  const runOf = new Map(runs)
  return Effect.map(
    Effect.forEach(pairsOf(engines), pair => {
      const left = runOf.get(pair.a)
      const right = runOf.get(pair.b)
      if (left === undefined || right === undefined) {
        return Effect.succeed(Option.none<Divergence>())
      }
      const checkpoint = firstDivergentCheckpoint(
        left.checkpoints,
        right.checkpoints,
      )
      if (checkpoint === undefined) {
        return Effect.succeed(Option.none<Divergence>())
      }
      return exactFrame(pair, checkpoint.frame).pipe(
        Effect.flatMap(frame => explain(pair, frame)),
        Effect.asSome,
      )
    }),
    Array.getSomes,
  )
}

// THE REPORT

const shown = (value: unknown): string => {
  const text =
    typeof value === 'number'
      ? Object.is(value, -0)
        ? '-0'
        : globalThis.String(value)
      : jsonTextOf(value)
  return text.length > 120 ? `${String.slice(0, 117)(text)}...` : text
}

// NOTE: the --json report. A difference's values are whatever the states
// held there, so they pass through as they are.
const Report = Schema.Struct({
  request: EngineRequest,
  engines: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      engine: Schema.String,
      frames: Schema.Finite,
      endPhase: Schema.String,
      endWave: Schema.Finite,
      finalHash: Schema.UndefinedOr(Schema.Finite),
    }),
  ),
  divergences: Schema.Array(
    Schema.Struct({
      a: Schema.String,
      b: Schema.String,
      frame: Schema.Finite,
      fields: Schema.Array(Schema.String),
      difference: Schema.UndefinedOr(
        Schema.Struct({
          path: Schema.String,
          a: Schema.Unknown,
          b: Schema.Unknown,
        }),
      ),
    }),
  ),
  unclassified: Schema.Array(Schema.String),
})

const report = (
  runs: ReadonlyArray<readonly [EngineName, EngineRun]>,
  divergences: ReadonlyArray<Divergence>,
) =>
  Effect.gen(function* () {
    const unclassified = [
      ...new Set(Array.flatMap(runs, ([, run]) => run.unclassified)),
    ]
    if (asJson) {
      const text = yield* Schema.encodeEffect(
        Schema.fromJsonString(Report, { space: 2 }),
      )({
        request,
        engines: Array.map(runs, ([name, run]) => ({
          name,
          engine: run.engine,
          frames: run.frames,
          endPhase: run.endPhase,
          endWave: run.endWave,
          finalHash: run.checkpoints.at(-1)?.[1],
        })),
        divergences,
        unclassified,
      })
      yield* Console.log(text)
      return
    }
    yield* Console.log(
      `Seed ${request.seed}, ${request.mode}, ${request.pattern} steps, ${request.frames} frames, hashed every ${request.every}, ${request.detMath ? 'deterministic Math' : "the engines' own Math"}`,
    )
    yield* Effect.forEach(runs, ([, run]) =>
      Console.log(
        `  ${String.padEnd(40)(run.engine)} ${String.padStart(6)(globalThis.String(run.frames))} frames, ended in ${run.endPhase} ${run.endWave}, final hash ${run.checkpoints.at(-1)?.[1]}`,
      ),
    )
    if (divergences.length === 0) {
      yield* Console.log('Every engine agrees on every hashed frame.')
    }
    yield* Effect.forEach(divergences, divergence =>
      Effect.gen(function* () {
        yield* Console.log(
          `${divergence.a} vs ${divergence.b}: first differ after frame ${divergence.frame}, in ${Array.join(divergence.fields, ', ')}`,
        )
        if (divergence.difference !== undefined) {
          yield* Console.log(
            `  first difference at ${divergence.difference.path}: ${shown(divergence.difference.a)} vs ${shown(divergence.difference.b)}`,
          )
        }
      }),
    )
    if (unclassified.length > 0) {
      yield* Console.log(
        `Model fields not in fields.ts, hashed as World: ${Array.join(unclassified, ', ')}`,
      )
    }
  })

const program = Effect.gen(function* () {
  if (!flag('--no-build')) {
    yield* runCommand('bun', ['tools/determinism/build.ts'])
  }
  const runs = yield* playEngines
  const divergences = yield* divergencesOf(runs)
  yield* report(runs, divergences)
  // NOTE: exits 1 when any two engines disagree.
  if (divergences.length > 0) {
    return yield* EnginesDisagree.make({ pairs: divergences.length })
  }
})

NodeRuntime.runMain(
  program.pipe(
    Effect.provide(Layer.merge(NodeServices.layer, FetchHttpClient.layer)),
  ),
)
