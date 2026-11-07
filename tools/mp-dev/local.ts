// Runs the API Worker (sync and co-op rooms, not analytics) in a local
// workerd, the Durable Object runtime, with storage that starts empty. e2e.ts uses
// it; on its own it serves until stopped, for the dev page:
//   bun tools/mp-dev/local.ts            (API at http://127.0.0.1:8798)
//   bun tools/mp-dev/serve.ts http://127.0.0.1:8798
import {
  Config,
  Console,
  Effect,
  FileSystem,
  Layer,
  Path,
  Schedule,
  Schema,
  type Scope,
} from 'effect'
import { FetchHttpClient, HttpClient, HttpClientRequest } from 'effect/http'

import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import * as NodeServices from '@effect/platform-node/NodeServices'

const here = import.meta.dirname

// NOTE: MP_DEV_PORT moves it, so two worktrees can each run a local workerd.
const localPort = Effect.map(
  Config.String('MP_DEV_PORT').pipe(Config.withDefault('8798')),
  Number,
)

export const localOrigin: Effect.Effect<string, Config.ConfigError> =
  Effect.map(localPort, port => `http://127.0.0.1:${port}`)

// NOTE: the Worker and the shared packages must meet one Effect, infra's,
// as the alias in infra/alchemy.run.ts makes them in a deploy.
const effectFromInfra = (infra: string) => ({
  name: 'effect-from-infra',
  setup(build: {
    onResolve(
      options: { filter: RegExp },
      callback: (args: { path: string }) => { path: string },
    ): void
  }) {
    build.onResolve({ filter: /^effect(\/.*)?$/ }, args => ({
      path: Bun.resolveSync(args.path, infra),
    }))
  },
})

const configOf = (
  storage: string,
  port: number,
): string => `using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  services = [
    (name = "main", worker = .api),
    (name = "do-storage", disk = (path = "${storage}", writable = true)),
  ],
  sockets = [ (name = "http", address = "127.0.0.1:${port}", http = (), service = "main") ],
);

const api :Workerd.Worker = (
  modules = [ (name = "worker", esModule = embed "main.js") ],
  compatibilityDate = "2026-10-01",
  bindings = [
    (name = "SYNC_SECRET", text = "local-mp-dev-secret"),
    (name = "SYNC_SCOPES", durableObjectNamespace = "SyncScope"),
    (name = "SYNC_DIRECTORY", durableObjectNamespace = "SyncDirectory"),
    (name = "GAME_ROOMS", durableObjectNamespace = "GameRoom"),
    (name = "MATCHMAKER", durableObjectNamespace = "Matchmaker"),
  ],
  durableObjectNamespaces = [
    (className = "SyncScope", uniqueKey = "mp-dev-sync-scope", enableSql = true),
    (className = "SyncDirectory", uniqueKey = "mp-dev-sync-directory", enableSql = true),
    (className = "GameRoom", uniqueKey = "mp-dev-game-room", enableSql = true),
    (className = "Matchmaker", uniqueKey = "mp-dev-matchmaker", enableSql = true),
  ],
  durableObjectStorage = (localDisk = "do-storage"),
);
`

class WorkerdFailed extends Schema.TaggedError<
  WorkerdFailed,
  { readonly brand: unique symbol }
>()('WorkerdFailed', { message: Schema.String }) {}

type Dirs = Readonly<{ infra: string; outdir: string; storage: string }>

const dirsOf = Effect.gen(function* () {
  const path = yield* Path.Path
  const outdir = path.resolve(here, 'dist/workerd')
  return {
    infra: path.resolve(here, '../../infra'),
    outdir,
    // NOTE: SQLite-backed Durable Objects need disk storage in workerd;
    // each run starts from an empty directory.
    storage: path.resolve(outdir, 'storage'),
  }
})

const buildWorker = ({ infra, outdir, storage }: Dirs, port: number) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    yield* fs.makeDirectory(outdir, { recursive: true })
    const result = yield* Effect.tryPromise({
      try: () =>
        Bun.build({
          entrypoints: [path.resolve(infra, 'worker/main.ts')],
          outdir,
          target: 'browser',
          format: 'esm',
          minify: false,
          metafile: false,
          plugins: [effectFromInfra(infra)],
          define: {},
        }),
      catch: error =>
        WorkerdFailed.make({
          message: `The Worker did not build: ${globalThis.String(error)}`,
        }),
    })
    if (!result.success) {
      return yield* WorkerdFailed.make({
        message: `The Worker did not build: ${globalThis.String(result.logs)}`,
      })
    }
    yield* fs.remove(storage, { recursive: true, force: true })
    yield* fs.makeDirectory(storage, { recursive: true })
    const config = path.resolve(outdir, 'local.capnp')
    yield* fs.writeFileString(config, configOf(storage, port))
    return config
  })

const answersChallenge = (origin: string) =>
  HttpClient.execute(
    HttpClientRequest.post(`${origin}/sync/challenge`).pipe(
      HttpClientRequest.bodyText('{}'),
    ),
  ).pipe(
    Effect.mapError(() => WorkerdFailed.make({ message: 'Not answering yet' })),
    Effect.filterOrFail(
      response => response.status >= 200 && response.status < 300,
      () => WorkerdFailed.make({ message: 'Not ready yet' }),
    ),
  )

export interface Workerd {
  // NOTE: stops workerd and starts it again on the same storage, as a deploy
  // of new code does: every Durable Object loses its memory and every socket
  // drops, and what the objects stored stays.
  readonly restart: Effect.Effect<void, WorkerdFailed>
}

// NOTE: workerd runs for as long as the Scope; closing it stops workerd.
/** @stability unstable */
export const startWorkerd: Effect.Effect<
  Workerd,
  WorkerdFailed,
  FileSystem.FileSystem | Path.Path | HttpClient.HttpClient | Scope.Scope
> = Effect.gen(function* () {
  const path = yield* Path.Path
  const dirs = yield* dirsOf
  const port = yield* localPort.pipe(
    Effect.mapError(error => WorkerdFailed.make({ message: error.message })),
  )
  const config = yield* buildWorker(dirs, port).pipe(
    Effect.catchTag('PlatformError', error =>
      Effect.fail(WorkerdFailed.make({ message: error.message })),
    ),
  )
  const spawn = () =>
    Bun.spawn(
      [
        path.resolve(dirs.infra, 'node_modules/.bin/workerd'),
        'serve',
        config,
        '--experimental',
      ],
      { cwd: dirs.outdir, stdout: 'inherit', stderr: 'inherit' },
    )
  const running = { current: spawn() }
  yield* Effect.addFinalizer(() => Effect.sync(() => running.current.kill()))
  const ready = Effect.retry(answersChallenge(`http://127.0.0.1:${port}`), {
    schedule: Schedule.spaced('100 millis'),
    times: 100,
  })
  yield* ready
  const client = yield* HttpClient.HttpClient
  return {
    restart: Effect.gen(function* () {
      running.current.kill(9)
      yield* Effect.promise(() => running.current.exited)
      running.current = spawn()
      yield* Effect.provideService(ready, HttpClient.HttpClient, client)
    }),
  }
})

if (import.meta.main) {
  NodeRuntime.runMain(
    Effect.scoped(
      Effect.gen(function* () {
        yield* startWorkerd
        const origin = yield* localOrigin
        yield* Console.log(`The API Worker runs in workerd at ${origin}`)
        return yield* Effect.never
      }),
    ).pipe(
      Effect.provide(Layer.merge(NodeServices.layer, FetchHttpClient.layer)),
    ),
  )
}
