// Runs the API Worker (sync and co-op rooms, not analytics) in a local
// workerd, the Durable Object runtime, with storage that starts empty. e2e.ts uses
// it; on its own it serves until stopped, for the dev page:
//   bun tools/mp-dev/local.ts            (API at http://127.0.0.1:8798)
//   bun tools/mp-dev/serve.ts http://127.0.0.1:8798
import { Console, Data, Effect, Schedule, type Scope } from 'effect'
import { FetchHttpClient, HttpClient, HttpClientRequest } from 'effect/http'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as NodeRuntime from '@effect/platform-node/NodeRuntime'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const infra = resolve(root, 'infra')
const outdir = resolve(here, 'dist/workerd')

// NOTE: MP_DEV_PORT moves it, so two worktrees can each run a local workerd.
export const LOCAL_PORT = Number(process.env['MP_DEV_PORT'] ?? 8798)
export const LOCAL_ORIGIN = `http://127.0.0.1:${LOCAL_PORT}`

// NOTE: the Worker and the shared packages must meet one Effect, infra's,
// as the alias in infra/alchemy.run.ts makes them in a deploy.
const effectFromInfra = {
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
}

// NOTE: SQLite-backed Durable Objects need disk storage in workerd; each
// run starts from an empty directory.
const storage = resolve(outdir, 'storage')

const CONFIG = `using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  services = [
    (name = "main", worker = .api),
    (name = "do-storage", disk = (path = "${storage}", writable = true)),
  ],
  sockets = [ (name = "http", address = "127.0.0.1:${LOCAL_PORT}", http = (), service = "main") ],
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

export const buildWorker = async (): Promise<string> => {
  mkdirSync(outdir, { recursive: true })
  const result = await Bun.build({
    entrypoints: [resolve(infra, 'worker/main.ts')],
    outdir,
    target: 'browser',
    format: 'esm',
    minify: false,
    metafile: false,
    plugins: [effectFromInfra],
    define: {},
  })
  if (!result.success) {
    throw new Error(`The Worker did not build: ${String(result.logs)}`)
  }
  rmSync(storage, { recursive: true, force: true })
  mkdirSync(storage, { recursive: true })
  const config = resolve(outdir, 'local.capnp')
  writeFileSync(config, CONFIG)
  return config
}

class WorkerdFailed extends Data.TaggedError('WorkerdFailed')<{
  readonly reason: string
}> {}

const answersChallenge = HttpClient.execute(
  HttpClientRequest.post(`${LOCAL_ORIGIN}/sync/challenge`).pipe(
    HttpClientRequest.bodyText('{}'),
  ),
).pipe(
  Effect.mapError(() => new WorkerdFailed({ reason: 'Not answering yet' })),
  Effect.filterOrFail(
    response => response.status >= 200 && response.status < 300,
    () => new WorkerdFailed({ reason: 'Not ready yet' }),
  ),
  Effect.provide(FetchHttpClient.layer),
)

export interface Workerd {
  // NOTE: stops workerd and starts it again on the same storage, as a deploy
  // of new code does: every Durable Object loses its memory and every socket
  // drops, and what the objects stored stays.
  readonly restart: Effect.Effect<void, WorkerdFailed>
}

// NOTE: workerd runs for as long as the Scope; closing it stops workerd.
export const startWorkerd: Effect.Effect<Workerd, WorkerdFailed, Scope.Scope> =
  Effect.gen(function* () {
    const config = yield* Effect.tryPromise({
      try: () => buildWorker(),
      catch: error => new WorkerdFailed({ reason: String(error) }),
    })
    const spawn = () =>
      Bun.spawn(
        [
          resolve(infra, 'node_modules/.bin/workerd'),
          'serve',
          config,
          '--experimental',
        ],
        { cwd: outdir, stdout: 'inherit', stderr: 'inherit' },
      )
    const running = { current: spawn() }
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => running.current.kill()),
    )
    const ready = Effect.retry(answersChallenge, {
      schedule: Schedule.spaced('100 millis'),
      times: 100,
    })
    yield* ready
    return {
      restart: Effect.gen(function* () {
        running.current.kill(9)
        yield* Effect.promise(() => running.current.exited)
        running.current = spawn()
        yield* ready
      }),
    }
  })

if (import.meta.main) {
  NodeRuntime.runMain(
    Effect.scoped(
      Effect.gen(function* () {
        yield* startWorkerd
        yield* Console.log(`The API Worker runs in workerd at ${LOCAL_ORIGIN}`)
        return yield* Effect.never
      }),
    ),
  )
}
