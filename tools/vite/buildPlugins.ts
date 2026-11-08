// The build's own Vite plugins: the build id in version.json, and sw.js, the
// service worker, with its precache list checked against dist.

import {
  Array,
  Clock,
  Config,
  Effect,
  FileSystem,
  Option,
  Path,
  Record,
  Schema,
  String,
} from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import { type Plugin, transformWithOxc } from 'vite'

import {
  IS_SERVICE_WORKER_KILLED,
  KILL_SWITCH_SOURCE,
  SERVICE_WORKER_FILE,
  precacheDrift,
  precacheList,
  serviceWorkerSource,
} from '../../src/platform/sw/precache.ts'
import { encodeJson } from '../json.ts'
import { nodeRuntime } from '../node.ts'

// NOTE: two folders up from this one, joined with `/` as Vite's own paths are.
const ROOT = Array.join(
  Array.dropRight(String.split('/')(import.meta.dirname), 2),
  '/',
)

const WORKER_SOURCE = `${ROOT}/src/platform/sw/worker.ts`

const DEV_BUILD = 'dev'

// NOTE: a git command's trimmed output, or None when it fails.
const git = (
  ...args: ReadonlyArray<string>
): Effect.Effect<
  Option.Option<string>,
  never,
  ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    return yield* spawner
      .string(ChildProcess.make('git', args, { stderr: 'ignore' }))
      .pipe(Effect.map(String.trim), Effect.option)
  })

// NOTE: a local deploy ships uncommitted changes, so a dirty tree gets a
// timestamp after its commit. Two such builds of one commit still differ.
const commitBuild = Effect.gen(function* () {
  const commit = yield* git('rev-parse', 'HEAD')
  if (Option.isNone(commit) || commit.value === '') {
    return Option.none<string>()
  }
  const status = yield* git('status', '--porcelain')
  if (Option.contains(status, '')) {
    return commit
  }
  const now = yield* Clock.currentTimeMillis
  return Option.some(`${commit.value}-dirty-${now}`)
})

// NOTE: an environment variable, or None when it is unset or empty.
const nonEmptyEnv = (key: string) =>
  Effect.gen(function* () {
    const value = yield* Config.option(Config.String(key))
    return Option.filter(value, String.isNonEmpty)
  })

const resolveBuild = Effect.gen(function* () {
  const fromId = yield* nonEmptyEnv('BUILD_ID')
  if (Option.isSome(fromId)) {
    return fromId.value
  }
  const fromSha = yield* nonEmptyEnv('GITHUB_SHA')
  if (Option.isSome(fromSha)) {
    return fromSha.value
  }
  const fromCommit = yield* commitBuild
  if (Option.isSome(fromCommit) && fromCommit.value !== '') {
    return fromCommit.value
  }
  const now = yield* Clock.currentTimeMillis
  return `time-${now}`
})

const encodeVersion = encodeJson(Schema.Struct({ build: Schema.String }))

// Stamps every production build with an id and writes it to version.json,
// so an installed app can tell that a newer build is live.
// NOTE: shared with the service worker plugin, which names its cache after
// the build.
const build = { id: DEV_BUILD }

export const buildId = (): Plugin => ({
  name: 'munch-manor:build-id',
  config: (_config, { command }) =>
    nodeRuntime
      .runPromise(
        command === 'build' ? resolveBuild : Effect.succeed(DEV_BUILD),
      )
      .then(id => {
        build.id = id
        return { define: { __BUILD_ID__: encodeJson(Schema.String)(build.id) } }
      }),
  applyToEnvironment: environment => environment.name === 'client',
  generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: 'version.json',
      source: `${encodeVersion({ build: build.id })}\n`,
    })
  },
})

// NOTE: every file under `directory`, as paths relative to it joined with
// `/`, or none when it is not there.
const filesUnder = (
  directory: string,
): Effect.Effect<
  ReadonlyArray<string>,
  never,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const isThere = yield* fs
      .exists(directory)
      .pipe(Effect.orElseSucceed(() => false))
    if (!isThere) {
      return []
    }
    const entries = yield* fs.readDirectory(directory, { recursive: true })
    const files = yield* Effect.filter(entries, entry =>
      Effect.map(
        fs.stat(path.join(directory, entry)),
        info => info.type === 'File',
      ),
    )
    return Array.map(files, file =>
      Array.join(String.split(path.sep)(file), '/'),
    )
  }).pipe(Effect.orDie)

class PrecacheDrifted extends Schema.TaggedError<
  PrecacheDrifted,
  { readonly brand: unique symbol }
>()('PrecacheDrifted', { message: Schema.String }) {}

// Writes sw.js, the service worker that lets the game cold start offline
// (src/platform/sw/worker.ts), with this build's id and its precache list: every file
// Vite emitted and every file copied from public/, less NOT_PRECACHED. Once
// dist is written it checks the list against the files on disk and fails the
// build if they drift. KILL_SERVICE_WORKER=1 writes the kill switch instead.
export const serviceWorker = (): Plugin => {
  const state: {
    root: string
    outDir: string
    publicDir: string
    precache: ReadonlyArray<string>
  } = { root: '', outDir: '', publicDir: '', precache: [] }
  return {
    name: 'munch-manor:service-worker',
    apply: 'build',
    applyToEnvironment: environment => environment.name === 'client',
    configResolved: config => {
      state.root = config.root
      state.outDir = config.build.outDir
      state.publicDir = config.publicDir
    },
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const emitted = Record.keys<string, unknown>(bundle)
        return nodeRuntime
          .runPromise(
            Effect.gen(function* () {
              const fs = yield* FileSystem.FileSystem
              const publicFiles = yield* filesUnder(state.publicDir)
              state.precache = precacheList(emitted, publicFiles)
              const killFlag = yield* Config.option(
                Config.String('KILL_SERVICE_WORKER'),
              )
              const isKilled =
                IS_SERVICE_WORKER_KILLED || Option.contains(killFlag, '1')
              if (isKilled) {
                return KILL_SWITCH_SOURCE
              }
              const source = yield* fs.readFileString(WORKER_SOURCE)
              const worker = yield* Effect.promise(() =>
                transformWithOxc(source, WORKER_SOURCE, {
                  lang: 'ts',
                  target: 'es2022',
                }),
              )
              return yield* serviceWorkerSource(
                build.id,
                state.precache,
                worker.code,
              )
            }),
          )
          .then(source => {
            this.emitFile({
              type: 'asset',
              fileName: SERVICE_WORKER_FILE,
              source,
            })
          })
      },
    },
    closeBundle() {
      return nodeRuntime.runPromise(
        Effect.gen(function* () {
          const path = yield* Path.Path
          const deployed = yield* filesUnder(
            path.resolve(state.root, state.outDir),
          )
          const { missing, extra } = precacheDrift(deployed, state.precache)
          if (missing.length > 0 || extra.length > 0) {
            return yield* PrecacheDrifted.make({
              message: `the service worker's precache list drifted from dist: missing ${Array.join(missing, ', ') || 'none'}, extra ${Array.join(extra, ', ') || 'none'}`,
            })
          }
        }),
      )
    },
  }
}
