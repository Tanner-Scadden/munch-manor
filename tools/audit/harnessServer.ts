// The built harness: `vite build tools/audit/harness` once into a cache
// folder named by a hash of everything the build reads, served by a small
// static server on a free port of the script's own. A script that finds the
// folder for today's hash skips the build, so only a change to the game, the
// harness, or the dependencies costs a build (about 2 s).
// It also holds where the harness runs, and the runners of the scripts that
// shoot it.
import { type Server, spawn } from 'bun'
import {
  Array,
  Clock,
  Config,
  Console,
  DateTime,
  Effect,
  FileSystem,
  Function,
  Layer,
  Option,
  Order,
  Path,
  Schema,
  type Scope,
  String,
} from 'effect'
import { tmpdir } from 'node:os'

import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import * as NodeServices from '@effect/platform-node/NodeServices'
import { describeError } from '@game/describeError'

export const HARNESS = 'http://localhost:4174/'

const ROOT = `${import.meta.dir}/../..`
const VITE = `${ROOT}/node_modules/.bin/vite`

// NOTE: the folders and files the harness build reads. `public` is copied
// into the build, `tools/sprites` builds the sprite atlas, and `patches`
// changes what `foldkit` is.
const INPUT_DIRS = [
  'src',
  'tools/audit/harness',
  'tools/sprites',
  'tools/vite',
  'public',
  'patches',
]
const INPUT_FILES = ['package.json', 'bun.lock', 'tsconfig.json']
const SKIPPED_DIRS = new Set(['dist', 'dist-profile', 'node_modules'])

// NOTE: the cache is shared by every worktree, since the folder name is the
// content's hash. Only the newest few builds are kept.
const KEPT_BUILDS = 8

class HarnessBuildFailed extends Schema.TaggedError<
  HarnessBuildFailed,
  { readonly brand: unique symbol }
>()('HarnessBuildFailed', { message: Schema.String }) {}

const filesUnder = (
  dir: string,
): Effect.Effect<
  ReadonlyArray<string>,
  never,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const names = yield* fs
      .readDirectory(dir)
      .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []))
    const nested = yield* Effect.forEach(
      Array.sort(names, Order.String),
      name =>
        Effect.gen(function* () {
          const full = path.join(dir, name)
          const info = yield* fs.stat(full).pipe(Effect.option)
          return yield* Option.match(info, {
            onNone: () => Effect.succeed<ReadonlyArray<string>>([]),
            onSome: ({ type }) =>
              type === 'Directory'
                ? SKIPPED_DIRS.has(name)
                  ? Effect.succeed<ReadonlyArray<string>>([])
                  : filesUnder(full)
                : Effect.succeed<ReadonlyArray<string>>(
                    type === 'File' ? [full] : [],
                  ),
          })
        }),
    )
    return Array.flatten(nested)
  })

const harnessHash = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const root = path.resolve(ROOT)
  const dirFiles = yield* Effect.forEach(INPUT_DIRS, dir =>
    filesUnder(path.join(root, dir)),
  )
  const topFiles = yield* Effect.filter(
    Array.map(INPUT_FILES, file => path.join(root, file)),
    file => fs.exists(file).pipe(Effect.orElseSucceed(() => false)),
  )
  const paths = Array.sort(
    [...Array.flatten(dirFiles), ...topFiles],
    Order.String,
  )
  const hasher = new Bun.CryptoHasher('sha256')
  for (const file of paths) {
    hasher.update(path.relative(root, file))
    hasher.update('\0')
    const bytes = yield* fs.readFile(file)
    hasher.update(bytes)
    hasher.update('\0')
  }
  return String.slice(0, 16)(hasher.digest('hex'))
})

const newestFirst = Order.flip(
  Order.mapInput(Order.Number, (build: { mtimeMs: number }) => build.mtimeMs),
)

const pruneOldBuilds = (cache: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const names = yield* fs.readDirectory(cache)
    const builds = yield* Effect.forEach(names, name =>
      Effect.gen(function* () {
        const full = path.join(cache, name)
        const info = yield* fs.stat(full)
        return info.type === 'Directory'
          ? Option.some({
              path: full,
              mtimeMs: Option.match(info.mtime, {
                onNone: () => 0,
                onSome: date => date.getTime(),
              }),
            })
          : Option.none()
      }),
    )
    const old = Array.drop(
      Array.sort(Array.getSomes(builds), newestFirst),
      KEPT_BUILDS,
    )
    yield* Effect.forEach(
      old,
      build => fs.remove(build.path, { recursive: true, force: true }),
      { discard: true },
    )
  })

const runBuild = (draft: string) =>
  Effect.tryPromise({
    try: () => {
      const build = spawn(
        [
          VITE,
          'build',
          'tools/audit/harness',
          '--outDir',
          draft,
          '--emptyOutDir',
        ],
        { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' },
      )
      return Promise.all([
        new Response(build.stdout).text(),
        new Response(build.stderr).text(),
        build.exited,
      ])
    },
    catch: error => HarnessBuildFailed.make({ message: describeError(error) }),
  })

// NOTE: builds into a folder of its own and renames it into place, so two
// scripts building the same hash at once both end with one whole build.
const buildInto = (outDir: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const startedMs = yield* Clock.currentTimeMillis
    const draft = `${outDir}.draft-${process.pid}-${startedMs}`
    const [output, errors, code] = yield* runBuild(draft)
    const removeDraft = fs
      .remove(draft, { recursive: true, force: true })
      .pipe(Effect.ignore)
    if (code !== 0) {
      yield* removeDraft
      yield* Console.error(output, errors)
      return yield* HarnessBuildFailed.make({
        message: 'the harness build failed',
      })
    }
    yield* fs.rename(draft, outDir).pipe(
      Effect.catch(() =>
        Effect.gen(function* () {
          yield* removeDraft
          const isThere = yield* fs
            .exists(`${outDir}/index.html`)
            .pipe(Effect.orElseSucceed(() => false))
          if (!isThere) {
            return yield* HarnessBuildFailed.make({
              message: `could not move the harness build into ${outDir}`,
            })
          }
        }),
      ),
    )
  })

const builtHarness = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const startedMs = yield* Clock.currentTimeMillis
  const cache = path.join(tmpdir(), 'munch-manor-harness')
  yield* fs.makeDirectory(cache, { recursive: true })
  const hash = yield* harnessHash
  const outDir = path.join(cache, hash)
  const isCached = yield* fs.exists(`${outDir}/index.html`)
  if (isCached) {
    const dateTime = yield* DateTime.now
    const now = DateTime.toDateUtc(dateTime)
    yield* fs.utimes(outDir, now, now)
    yield* Console.log(`Harness ${hash}: cached`)
  } else {
    yield* buildInto(outDir)
    const finishedMs = yield* Clock.currentTimeMillis
    yield* Console.log(
      `Harness ${hash}: built in ${Math.round(finishedMs - startedMs)} ms`,
    )
    yield* pruneOldBuilds(cache)
  }
  return outDir
})

const notFound = () => new Response('Not found', { status: 404 })

const fileFor = (path: Path.Path, dir: string, pathname: string) => {
  const file = path.join(dir, decodeURIComponent(pathname))
  if (!String.startsWith(dir)(file)) {
    return Option.none()
  }
  return Option.some(
    pathname === '/' || String.endsWith('/')(pathname)
      ? Bun.file(path.join(file, 'index.html'))
      : Bun.file(file),
  )
}

const respond = (path: Path.Path, dir: string, request: Request) =>
  Option.match(fileFor(path, dir, new URL(request.url).pathname), {
    onNone: () => Effect.succeed(notFound()),
    onSome: file =>
      Effect.promise(() => file.exists()).pipe(
        Effect.map(isFile => (isFile ? new Response(file) : notFound())),
      ),
  })

// NOTE: serves a folder on a free port. Any path that is not a file gets 404.
const serveDir = (
  dir: string,
): Effect.Effect<Server<undefined>, never, Path.Path> =>
  Effect.gen(function* () {
    const path = yield* Path.Path
    const services = yield* Effect.context()
    return Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: request =>
        Effect.runPromiseWith(services)(respond(path, dir, request)),
    })
  })

// WHERE THE HARNESS RUNS

// NOTE: where the harness runs. `BASE` names a server you started, and
// `HARNESS_DEV=1` uses the dev server on 4174 for live editing. Otherwise
// `harness` builds the harness once per content hash and serves it on a
// free port of this script's own.
let harnessBase = HARNESS

export const harnessBaseUrl = () => harnessBase

const harness = Effect.gen(function* () {
  const base = yield* Config.String('BASE').pipe(Config.option)
  const isDev = yield* Config.String('HARNESS_DEV').pipe(Config.withDefault(''))
  if (Option.isSome(base) || isDev === '1') {
    harnessBase = Option.getOrElse(base, () => HARNESS)
    return harnessBase
  }
  const dir = yield* builtHarness
  const server = yield* serveDir(dir)
  server.unref()
  harnessBase = `http://127.0.0.1:${server.port}/`
  return harnessBase
})

// NOTE: `harness` for tools/video, which waits on a promise.
export const useHarness = (): Promise<string> =>
  Effect.runPromise(harness.pipe(Effect.provide(NodeServices.layer)))

// THE RUNNERS

// NOTE: `runAudit` and `runAuditWith` (lib.ts) for a script that shoots the
// harness: they build and serve it first, so `harnessUrl` points at it.
export const runHarnessAudit = <A, E>(
  program: Effect.Effect<A, E, Scope.Scope>,
) => {
  NodeRuntime.runMain(
    Effect.andThen(harness, program).pipe(
      Effect.scoped,
      Effect.provide(NodeServices.layer),
    ),
  )
}

export const runHarnessAuditWith: {
  <R>(
    layer: Layer.Layer<R>,
  ): <A, E>(program: Effect.Effect<A, E, R | Scope.Scope>) => void
  <A, E, R>(
    program: Effect.Effect<A, E, R | Scope.Scope>,
    layer: Layer.Layer<R>,
  ): void
} = Function.dual(
  2,
  <A, E, R>(
    program: Effect.Effect<A, E, R | Scope.Scope>,
    layer: Layer.Layer<R>,
  ): void => {
    NodeRuntime.runMain(
      Effect.andThen(harness, program).pipe(
        Effect.scoped,
        Effect.provide(Layer.merge(NodeServices.layer, layer)),
      ),
    )
  },
)
