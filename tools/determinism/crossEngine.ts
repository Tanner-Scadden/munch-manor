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

import { Option, Schema } from 'effect'
import { HttpClientRequest } from 'effect/http'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { askWorkerd } from './askWorkerd'
import {
  type Difference,
  firstDifference,
  firstDivergentCheckpoint,
  jsonTextOf,
  revive,
} from './diff'
import {
  DEFAULT_REQUEST,
  type EngineDump,
  EngineRequest,
  type EngineRun,
  decodeEngineDump,
  decodeEngineError,
  decodeEngineRun,
  paramsOf,
} from './request'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const out = resolve(here, 'out')

const CHROME =
  process.env['CHROME'] ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const WORKERD_PORT = 8797

type EngineName = 'bun' | 'node' | 'chrome' | 'workerd'
const ALL_ENGINES: ReadonlyArray<EngineName> = [
  'bun',
  'node',
  'chrome',
  'workerd',
]

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
const engines = (option('--engines') ?? ALL_ENGINES.join(','))
  .split(',')
  .flatMap(name => ALL_ENGINES.filter(engine => engine === name))
const asJson = flag('--json')

// ENGINES

const unescapeHtml = (text: string): string =>
  text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&')

const runCommand = (command: string, args: ReadonlyArray<string>): string => {
  const result = spawnSync(command, [...args], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
  })
  if (result.status !== 0) {
    throw new Error(`${command} failed: ${result.stderr}`)
  }
  return result.stdout
}

const runChrome = (params: string): string => {
  // NOTE: a throwaway profile, so the run never touches the owner's Chrome.
  const profile = mkdtempSync(resolve(tmpdir(), 'determinism-chrome-'))
  try {
    const dom = runCommand(CHROME, [
      '--headless',
      '--disable-gpu',
      '--no-first-run',
      '--disable-extensions',
      `--user-data-dir=${profile}`,
      '--dump-dom',
      `${pathToFileURL(resolve(out, 'page.html')).href}?${params}`,
    ])
    const answer = dom.match(/<pre id="answer">([\s\S]*?)<\/pre>/)?.[1]
    if (answer === undefined) {
      throw new Error(`Chrome printed no answer: ${dom.slice(0, 400)}`)
    }
    return unescapeHtml(answer)
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
}

const workerdBinary = (): string | undefined => {
  const commonDir = spawnSync(
    'git',
    ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    { cwd: root, encoding: 'utf8' },
  ).stdout.trim()
  return [
    process.env['WORKERD'],
    resolve(root, 'infra/node_modules/.bin/workerd'),
    commonDir === ''
      ? undefined
      : resolve(commonDir, '../infra/node_modules/.bin/workerd'),
  ].find(path => path !== undefined && existsSync(path))
}

const runWorkerd = async (params: string): Promise<string> => {
  const binary = workerdBinary()
  if (binary === undefined) {
    throw new Error('no workerd: run bun install in infra/, or set WORKERD')
  }
  const server = spawn(binary, ['serve', resolve(here, 'workerd.capnp')], {
    cwd: here,
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  try {
    return await askWorkerd(
      HttpClientRequest.get(`http://127.0.0.1:${WORKERD_PORT}/?${params}`),
    )
  } finally {
    server.kill()
  }
}

const ask = async (engine: EngineName, ofRequest: EngineRequest) => {
  const params = paramsOf(ofRequest)
  const text =
    engine === 'bun'
      ? runCommand('bun', ['tools/determinism/cli.ts', params])
      : engine === 'node'
        ? runCommand('node', [resolve(out, 'cli.js'), params])
        : engine === 'chrome'
          ? runChrome(params)
          : await runWorkerd(params)
  const maybeError = decodeEngineError(text)
  if (Option.isSome(maybeError)) {
    throw new Error(`${engine}: ${String(maybeError.value.error)}`)
  }
  return text
}

const askRun = async (
  engine: EngineName,
  ofRequest: EngineRequest,
): Promise<EngineRun> => {
  const text = await ask(engine, ofRequest)
  return Option.getOrThrowWith(
    decodeEngineRun(text),
    () => new Error(`${engine} answered no run`),
  )
}

const askDump = async (
  engine: EngineName,
  frame: number,
): Promise<EngineDump> => {
  const text = await ask(engine, { ...request, dump: frame })
  return Option.getOrThrowWith(
    decodeEngineDump(text),
    () => new Error(`${engine} answered no dump for frame ${frame}`),
  )
}

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
  names.flatMap((a, index) => names.slice(index + 1).map(b => ({ a, b })))

const exactFrame = async (
  pair: Pair,
  checkpointFrame: number,
): Promise<number> => {
  if (request.every === 1 || checkpointFrame < 0) {
    return checkpointFrame
  }
  const narrowed = { ...request, every: 1, frames: checkpointFrame + 1 }
  const left = await askRun(pair.a, narrowed)
  const right = await askRun(pair.b, narrowed)
  return (
    firstDivergentCheckpoint(left.checkpoints, right.checkpoints)?.frame ??
    checkpointFrame
  )
}

const explain = async (pair: Pair, frame: number): Promise<Divergence> => {
  if (frame < 0) {
    return {
      ...pair,
      frame,
      fields: ['(the started run)'],
      difference: undefined,
    }
  }
  const left = await askDump(pair.a, frame)
  const right = await askDump(pair.b, frame)
  const rightHashes = new Map(right.fieldHashes)
  const fields = left.fieldHashes
    .filter(([field, hash]) => rightHashes.get(field) !== hash)
    .map(([field]) => field)
  return {
    ...pair,
    frame,
    fields,
    difference: firstDifference(revive(left.state), revive(right.state)),
  }
}

if (!flag('--no-build')) {
  runCommand('bun', ['tools/determinism/build.ts'])
}

const runs = await engines.reduce<
  Promise<ReadonlyArray<readonly [EngineName, EngineRun]>>
>(async (done, engine) => {
  const previous = await done
  const startedAt = performance.now()
  const run = await askRun(engine, request)
  if (!asJson) {
    console.error(
      `${run.engine}: ${run.frames} frames in ${((performance.now() - startedAt) / 1000).toFixed(1)} s`,
    )
  }
  return [...previous, [engine, run] as const]
}, Promise.resolve([]))
const runOf = new Map(runs)

const divergences = await pairsOf(engines).reduce<
  Promise<ReadonlyArray<Divergence>>
>(async (done, pair) => {
  const previous = await done
  const left = runOf.get(pair.a)
  const right = runOf.get(pair.b)
  if (left === undefined || right === undefined) {
    return previous
  }
  const checkpoint = firstDivergentCheckpoint(
    left.checkpoints,
    right.checkpoints,
  )
  if (checkpoint === undefined) {
    return previous
  }
  return [
    ...previous,
    await explain(pair, await exactFrame(pair, checkpoint.frame)),
  ]
}, Promise.resolve([]))

// THE REPORT

const shown = (value: unknown): string => {
  const text =
    typeof value === 'number'
      ? Object.is(value, -0)
        ? '-0'
        : String(value)
      : jsonTextOf(value)
  return text.length > 120 ? `${text.slice(0, 117)}...` : text
}

// NOTE: the --json report. A difference's values are whatever the states
// held there, so they pass through as they are.
const Report = Schema.Struct({
  request: EngineRequest,
  engines: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      engine: Schema.String,
      frames: Schema.Number,
      endPhase: Schema.String,
      endWave: Schema.Number,
      finalHash: Schema.UndefinedOr(Schema.Number),
    }),
  ),
  divergences: Schema.Array(
    Schema.Struct({
      a: Schema.String,
      b: Schema.String,
      frame: Schema.Number,
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

const unclassified = [...new Set(runs.flatMap(([, run]) => run.unclassified))]

if (asJson) {
  console.log(
    Schema.encodeSync(Schema.fromJsonString(Report, { space: 2 }))({
      request,
      engines: runs.map(([name, run]) => ({
        name,
        engine: run.engine,
        frames: run.frames,
        endPhase: run.endPhase,
        endWave: run.endWave,
        finalHash: run.checkpoints.at(-1)?.[1],
      })),
      divergences,
      unclassified,
    }),
  )
} else {
  console.log(
    `Seed ${request.seed}, ${request.mode}, ${request.pattern} steps, ${request.frames} frames, hashed every ${request.every}, ${request.detMath ? 'deterministic Math' : "the engines' own Math"}`,
  )
  runs.forEach(([, run]) =>
    console.log(
      `  ${run.engine.padEnd(40)} ${String(run.frames).padStart(6)} frames, ended in ${run.endPhase} ${run.endWave}, final hash ${run.checkpoints.at(-1)?.[1]}`,
    ),
  )
  if (divergences.length === 0) {
    console.log('Every engine agrees on every hashed frame.')
  }
  divergences.forEach(divergence => {
    console.log(
      `${divergence.a} vs ${divergence.b}: first differ after frame ${divergence.frame}, in ${divergence.fields.join(', ')}`,
    )
    if (divergence.difference !== undefined) {
      console.log(
        `  first difference at ${divergence.difference.path}: ${shown(divergence.difference.a)} vs ${shown(divergence.difference.b)}`,
      )
    }
  })
  if (unclassified.length > 0) {
    console.log(
      `Model fields not in fields.ts, hashed as World: ${unclassified.join(', ')}`,
    )
  }
}

process.exit(divergences.length === 0 ? 0 : 1)
