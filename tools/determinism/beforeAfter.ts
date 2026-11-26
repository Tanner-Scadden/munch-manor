import {
  Array,
  Console,
  Effect,
  FileSystem,
  Option,
  Path,
  Record,
  Schema,
  String,
} from 'effect'
import { tmpdir } from 'node:os'

import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import * as NodeServices from '@effect/platform-node/NodeServices'

import {
  firstDifference,
  firstDivergentCheckpoint,
  jsonTextOf,
  revive,
} from './diff'
import { commandOutput } from './process'
import {
  DEFAULT_REQUEST,
  type EngineRequest,
  decodeEngineDump,
  decodeEngineRun,
  paramsOf,
} from './request'

const here = import.meta.dirname

class CompareFailed extends Schema.TaggedError<
  CompareFailed,
  { readonly brand: unique symbol }
>()('CompareFailed', { message: Schema.String }) {}

class RunsDiffer extends Schema.TaggedError<
  RunsDiffer,
  { readonly brand: unique symbol }
>()('RunsDiffer', { frame: Schema.Finite }) {}

const argv = process.argv.slice(2)
const option = (name: string): string | undefined => {
  const at = argv.indexOf(name)
  return at === -1 ? undefined : argv[at + 1]
}
const ref =
  argv[0] !== undefined && !String.startsWith('--')(argv[0])
    ? argv[0]
    : 'origin/main'
const isTip = argv.includes('--tip')

const request: EngineRequest = {
  ...DEFAULT_REQUEST,
  frames: Number(option('--frames') ?? 7200),
  seed: Number(option('--seed') ?? DEFAULT_REQUEST.seed),
  mode: option('--mode') === 'Endless' ? 'Endless' : 'Campaign',
  pattern: option('--pattern') === 'Mixed' ? 'Mixed' : 'Fixed60',
  every: Number(option('--every') ?? DEFAULT_REQUEST.every),
  noHitStop: argv.includes('--no-hit-stop'),
}

const run = (
  command: string,
  args: ReadonlyArray<string>,
  cwd: string,
  env: Readonly<Record<string, string>>,
) =>
  commandOutput({ command, args, cwd, env }).pipe(
    Effect.mapError(error =>
      CompareFailed.make({
        message: `${command} ${Array.join(args, ' ')}: ${error.message}`,
      }),
    ),
  )

const rootOf = Effect.gen(function* () {
  const path = yield* Path.Path
  return path.resolve(here, '../..')
})

const PATCHED_COPY = /_patch_hash=/

const installBase = (cwd: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const cache = path.resolve(tmpdir(), 'munch-determinism-bun-cache')
    yield* fs.makeDirectory(cache, { recursive: true })
    const entries = yield* fs.readDirectory(cache)
    yield* Effect.forEach(
      Array.filter(entries, entry => PATCHED_COPY.test(entry)),
      entry => fs.remove(path.resolve(cache, entry), { recursive: true }),
    )
    yield* run(
      'bun',
      ['install', '--frozen-lockfile', '--ignore-scripts'],
      cwd,
      {
        BUN_INSTALL_CACHE_DIR: cache,
      },
    )
  })

const PackageManifest = Schema.Struct({
  patchedDependencies: Schema.Record(Schema.String, Schema.Unknown),
})

const decodeManifest = Schema.decodeOption(
  Schema.fromJsonString(PackageManifest),
)

const nameOf = (key: string): string =>
  Option.match(String.lastIndexOf('@')(key), {
    onNone: () => String.slice(0, -1)(key),
    onSome: at => String.slice(0, at)(key),
  })

const patchesOf = (cwd: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const text = yield* fs.readFileString(path.resolve(cwd, 'package.json'))
    const patched = Option.match(decodeManifest(text), {
      onNone: () => [],
      onSome: manifest => Record.toEntries(manifest.patchedDependencies),
    })
    return Array.flatMap(
      patched,
      ([key, patch]): Array<readonly [string, string]> =>
        typeof patch === 'string' ? [[nameOf(key), patch]] : [],
    )
  })

const checkPatches = (cwd: string, side: string) =>
  Effect.gen(function* () {
    const path = yield* Path.Path
    const patches = yield* patchesOf(cwd)
    yield* Effect.forEach(patches, ([name, patch]) =>
      commandOutput({
        command: 'git',
        args: [
          'apply',
          '--check',
          '--reverse',
          `--directory=node_modules/${name}`,
          path.resolve(cwd, patch),
        ],
        cwd,
      }).pipe(
        Effect.mapError(() =>
          CompareFailed.make({
            message:
              `The ${side}'s node_modules/${name} does not match ${patch}. ` +
              'Bun may have linked an older patched copy from its cache: see "Changing it" in patches/README.md.',
          }),
        ),
      ),
    )
  })

const askRun = (cwd: string, ofRequest: EngineRequest) =>
  run('bun', ['tools/determinism/cli.ts', paramsOf(ofRequest)], cwd, {}).pipe(
    Effect.flatMap(text =>
      Effect.fromOption(decodeEngineRun(text)).pipe(
        Effect.mapError(() =>
          CompareFailed.make({ message: `no run from ${cwd}` }),
        ),
      ),
    ),
  )

const askDump = (cwd: string, frame: number) =>
  run(
    'bun',
    ['tools/determinism/cli.ts', paramsOf({ ...request, dump: frame })],
    cwd,
    {},
  ).pipe(
    Effect.flatMap(text =>
      Effect.fromOption(decodeEngineDump(text)).pipe(
        Effect.mapError(() =>
          CompareFailed.make({
            message: `no dump from ${cwd} for frame ${frame}`,
          }),
        ),
      ),
    ),
  )

const baseWorktree = (root: string, baseCommit: string) =>
  Effect.acquireRelease(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const base = yield* fs.makeTempDirectory({ prefix: 'determinism-base-' })
      yield* fs.remove(base, { recursive: true })
      yield* run(
        'git',
        ['worktree', 'add', '--detach', base, baseCommit],
        root,
        {},
      )
      return base
    }),
    base =>
      Effect.ignore(
        run('git', ['worktree', 'remove', '--force', base], root, {}),
      ),
  )

const copyHarness = (base: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const target = path.resolve(base, 'tools/determinism')
    yield* fs.remove(target, { recursive: true, force: true })
    yield* fs.makeDirectory(target, { recursive: true })
    const entries = yield* fs.readDirectory(here)
    yield* Effect.forEach(
      Array.filter(entries, entry => entry !== 'out'),
      entry => fs.copy(path.resolve(here, entry), path.resolve(target, entry)),
    )
    const harnessFiles = yield* Effect.forEach(
      Array.filter(entries, entry => String.endsWith('.ts')(entry)),
      entry => fs.readFileString(path.resolve(here, entry)),
    )
    const imported = Array.dedupe(
      Array.flatMap(harnessFiles, text =>
        Array.map(
          Array.fromIterable(
            String.matchAll(/'\.\.\/\.\.\/src\/([\w/.-]+)'/g)(text),
          ),
          ([, module]) => module ?? '',
        ),
      ),
    )
    yield* Effect.forEach(imported, module =>
      Effect.gen(function* () {
        const shim = path.resolve(base, 'src', `${module}.ts`)
        const flat = path.resolve(base, 'src', `${path.basename(module)}.ts`)
        if ((yield* fs.exists(shim)) || !(yield* fs.exists(flat))) {
          return
        }
        yield* fs.makeDirectory(path.dirname(shim), { recursive: true })
        const relative = path.relative(path.dirname(shim), flat)
        yield* fs.writeFileString(
          shim,
          `export * from './${String.slice(0, -3)(relative)}'\n`,
        )
      }),
    )
    const pureApp = path.resolve(base, 'src/app/pureApp.ts')
    if (!(yield* fs.exists(pureApp))) {
      yield* fs.makeDirectory(path.dirname(pureApp), { recursive: true })
      yield* fs.writeFileString(
        pureApp,
        "export { update } from '../main'\nexport { initialModel } from '../model'\n",
      )
    }
  })

const exactFrame = (
  base: string,
  root: string,
  narrowed: EngineRequest,
  checkpointFrame: number,
) =>
  Effect.gen(function* () {
    const before = yield* askRun(base, narrowed)
    const after = yield* askRun(root, narrowed)
    return (
      firstDivergentCheckpoint(before.checkpoints, after.checkpoints)?.frame ??
      checkpointFrame
    )
  })

const compare = Effect.gen(function* () {
  const root = yield* rootOf
  const baseCommit = isTip
    ? ref
    : yield* Effect.map(
        run('git', ['merge-base', 'HEAD', ref], root, {}),
        String.trim,
      )
  const baseName = isTip
    ? ref
    : `${ref} merge base ${String.slice(0, 9)(baseCommit)}`
  const base = yield* baseWorktree(root, baseCommit)
  yield* copyHarness(base)
  yield* installBase(base)
  yield* checkPatches(base, `base (${baseName})`)
  yield* checkPatches(root, 'working tree')

  const before = yield* askRun(base, request)
  const after = yield* askRun(root, request)
  yield* Console.log(
    `Seed ${request.seed}, ${request.mode}, ${request.pattern} steps, ${request.frames} frames, hashed every ${request.every}${request.noHitStop ? ', no hit-stop' : ''}`,
  )
  yield* Console.log(
    `  before (${baseName}): ${before.frames} frames, ended in ${before.endPhase} ${before.endWave}`,
  )
  yield* Console.log(
    `  after (working tree): ${after.frames} frames, ended in ${after.endPhase} ${after.endWave}`,
  )
  const checkpoint = firstDivergentCheckpoint(
    before.checkpoints,
    after.checkpoints,
  )
  if (checkpoint === undefined) {
    yield* Console.log('The gameplay is the same on every hashed frame.')
    return
  }
  const narrowed = { ...request, every: 1, frames: checkpoint.frame + 1 }
  const frame =
    request.every === 1 || checkpoint.frame < 0
      ? checkpoint.frame
      : yield* exactFrame(base, root, narrowed, checkpoint.frame)
  if (frame < 0) {
    yield* Console.log('The started runs already differ.')
  } else {
    const left = yield* askDump(base, frame)
    const right = yield* askDump(root, frame)
    const rightHashes = new Map(right.fieldHashes)
    const fields = Array.map(
      Array.filter(
        left.fieldHashes,
        ([field, hash]) => rightHashes.get(field) !== hash,
      ),
      ([field]) => field,
    )
    const onlyAfter = Array.map(
      Array.filter(
        right.fieldHashes,
        ([field]) => !Array.some(left.fieldHashes, ([name]) => name === field),
      ),
      ([field]) => field,
    )
    yield* Console.log(
      `First differ after frame ${frame}, in ${Array.join([...fields, ...onlyAfter], ', ')}`,
    )
    const difference = firstDifference(revive(left.state), revive(right.state))
    if (difference !== undefined) {
      yield* Console.log(
        `  first difference at ${difference.path}: ${String.slice(0, 120)(jsonTextOf(difference.a))} vs ${String.slice(0, 120)(jsonTextOf(difference.b))}`,
      )
    }
  }
  return yield* RunsDiffer.make({ frame })
})

NodeRuntime.runMain(
  Effect.scoped(compare).pipe(Effect.provide(NodeServices.layer)),
)
