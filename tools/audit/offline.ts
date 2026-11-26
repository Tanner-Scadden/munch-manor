import { type Subprocess, spawn } from 'bun'
import {
  Array,
  Config,
  Console,
  Duration,
  Effect,
  FileSystem,
  Layer,
  Path,
  Schedule,
  Schema,
  String,
} from 'effect'
import { FetchHttpClient, HttpClient, HttpClientResponse } from 'effect/http'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import type { BrowserContext, Page } from 'playwright-core'

import * as NodeServices from '@effect/platform-node/NodeServices'

import { decodeJson, encodeJson } from '../json'
import {
  cacheEntries,
  fetchVersion,
  framesWithin,
  scriptSources,
  workerStateOf,
} from './inPage/offline'
import { PHONE_844, openBrowser, runAuditWith, wait } from './lib'
import {
  type AuditFailed,
  attempt,
  decodedFrom,
  evaluateAs,
  failWith,
} from './page'

const PREVIEW_PORT = 4297
const LOCAL = `http://localhost:${PREVIEW_PORT}/`
const CACHE_PREFIX = 'munch-manor-'

const Base = Config.String('BASE').pipe(Config.withDefault(LOCAL))

const failures: Array<string> = []
const check = (isOk: boolean, label: string) =>
  Effect.gen(function* () {
    yield* Console.log(`${isOk ? 'ok  ' : 'FAIL'} ${label}`)
    if (!isOk) {
      failures.push(label)
    }
  })

const rootDir = Effect.gen(function* () {
  const path = yield* Path.Path
  return path.resolve(import.meta.dir, '../..')
})

const build = (id: string) =>
  Effect.gen(function* () {
    const root = yield* rootDir
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const code = yield* spawner.exitCode(
      ChildProcess.make('bun', ['run', 'build'], {
        cwd: root,
        env: { BUILD_ID: id },
        extendEnv: true,
        stdin: 'ignore',
        stdout: 'ignore',
        stderr: 'ignore',
      }),
    )
    if (code !== 0) {
      return yield* failWith(`the build of ${id} exited with ${code}`)
    }
    yield* Console.log(`built ${id}`)
  })

const VersionFile = Schema.Struct({ build: Schema.optional(Schema.String) })

const servedBuild = HttpClient.get(`${LOCAL}version.json`).pipe(
  Effect.flatMap(HttpClientResponse.schemaBodyJson(VersionFile)),
  Effect.map(body => body.build),
  Effect.provideService(FetchHttpClient.RequestInit, { cache: 'no-store' }),
  Effect.provideService(HttpClient.TracerPropagationEnabled, false),
  Effect.orElseSucceed(() => undefined),
)

const serve = Effect.gen(function* () {
  const taken = yield* servedBuild
  if (taken !== undefined) {
    return yield* failWith(
      `port ${PREVIEW_PORT} is already taken by another server`,
    )
  }
  const root = yield* rootDir
  const fs = yield* FileSystem.FileSystem
  const versionText = yield* fs.readFileString(`${root}/dist/version.json`)
  const version = yield* Schema.decodeEffect(
    Schema.fromJsonString(VersionFile),
  )(versionText)
  const expected = version.build
  const server = spawn(
    [
      'bunx',
      'vite',
      'preview',
      '--configLoader',
      'native',
      '--port',
      globalThis.String(PREVIEW_PORT),
      '--strictPort',
    ],
    {
      cwd: root,
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'ignore',
      detached: true,
    },
  )
  const served = yield* servedBuild.pipe(
    Effect.repeat({
      until: answered => answered === expected,
      schedule: Schedule.spaced(Duration.millis(500)).pipe(
        Schedule.upTo({ times: 59 }),
      ),
    }),
  )
  if (served === expected) {
    return server
  }
  return yield* failWith(`vite preview never served ${expected} on ${LOCAL}`)
})

const killGroup = (server: Subprocess) => {
  try {
    process.kill(-server.pid)
  } catch {
    server.kill()
  }
}

const stop = (server: Subprocess | undefined) =>
  Effect.andThen(
    Effect.sync(() => {
      if (server?.exitCode === null) {
        killGroup(server)
      }
    }),
    wait(500),
  )

const precacheCount = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const root = yield* rootDir
  const source = yield* fs.readFileString(`${root}/dist/sw.js`)
  const line = String.split('\n')(source)[1] ?? ''
  return decodeJson(Schema.Array(Schema.Unknown))(
    String.replace(/;$/, '')(String.replace(/^const PRECACHE = /, '')(line)),
  ).length
})

const Caches = Schema.Array(
  Schema.Struct({ name: Schema.String, entries: Schema.Finite }),
)
const encodeCaches = encodeJson(Caches)

const gameCaches = (page: Page) =>
  decodedFrom(Caches, () => page.evaluate(cacheEntries, CACHE_PREFIX))

const isControlled = (page: Page) =>
  attempt(() =>
    page.evaluate(
      () =>
        !('serviceWorker' in navigator) ||
        navigator.serviceWorker.controller !== null,
    ),
  )

const WorkerState = Schema.Struct({
  support: Schema.Boolean,
  registered: Schema.optional(Schema.Boolean),
  installing: Schema.optional(Schema.NullOr(Schema.String)),
  waiting: Schema.optional(Schema.NullOr(Schema.String)),
  active: Schema.optional(Schema.NullOr(Schema.String)),
})

const workerState = (page: Page) => evaluateAs(page, WorkerState, workerStateOf)

const awaitSplashGone = (page: Page) =>
  attempt(() =>
    page.waitForFunction(() => document.getElementById('splash') === null, {
      timeout: 30_000,
    }),
  )

const openGame = (page: Page, how: Effect.Effect<unknown, AuditFailed>) =>
  Effect.gen(function* () {
    yield* how
    const splashes = yield* attempt(() => page.locator('#splash').count())
    yield* awaitSplashGone(page)
    const canvases = yield* attempt(() => page.locator('.game-surface').count())
    return { isSplashShown: splashes === 1, isBooted: canvases > 0 }
  })

const goto = (page: Page, base: string) =>
  attempt(() => page.goto(base, { waitUntil: 'domcontentloaded' }))

const reload = (page: Page) =>
  attempt(() => page.reload({ waitUntil: 'domcontentloaded' }))

const runningScript = (page: Page) =>
  attempt(() => page.evaluate(scriptSources))

const soundToggle = (page: Page) =>
  page
    .getByRole('list', { name: 'Game settings' })
    .getByRole('button', { name: 'Sound', exact: true })

const openSettings = (page: Page) =>
  Effect.andThen(
    attempt(() => page.click('#home-settings')),
    attempt(() => soundToggle(page).waitFor({ timeout: 5000 })),
  )

const soundPressed = (page: Page) =>
  attempt(() => soundToggle(page).getAttribute('aria-pressed'))

const isMuted = (page: Page) =>
  Effect.gen(function* () {
    yield* openSettings(page)
    return (yield* soundPressed(page)) === 'false'
  })

const frameCount = (page: Page, ms: number) =>
  attempt(() => page.evaluate(framesWithin, ms))

const status = (page: Page) =>
  attempt(() =>
    page.evaluate(
      () =>
        document.querySelector('[role="status"].sr-only')?.textContent ?? '',
    ),
  )

const playARun = (page: Page) =>
  Effect.gen(function* () {
    yield* attempt(() => page.locator('#home-play').tap())
    yield* wait(400)
    const normal = page.getByRole('button', { name: /^double dare/i })
    if ((yield* attempt(() => normal.count())) > 0) {
      yield* attempt(() => normal.tap())
    }
    yield* wait(1500)
    const surface = yield* attempt(() =>
      page.locator('.game-surface').boundingBox(),
    )
    if (surface !== null) {
      for (const _ of [1, 2, 3, 4]) {
        yield* attempt(() =>
          page.touchscreen.tap(
            surface.x + surface.width * 0.8,
            surface.y + surface.height * 0.4,
          ),
        )
        yield* wait(200)
      }
    }
    const frames = yield* frameCount(page, 2000)
    return { frames, status: yield* status(page) }
  })

const goOffline = (context: BrowserContext, server: Subprocess | undefined) =>
  Effect.andThen(
    attempt(() => context.setOffline(true)),
    stop(server),
  )

const offlinePart = (page: Page, base: string) =>
  Effect.gen(function* () {
    const online = yield* openGame(page, goto(page, base))
    yield* check(online.isBooted, 'online: the first visit boots')
    yield* attempt(() =>
      page.waitForFunction(
        () =>
          !('serviceWorker' in navigator) ||
          navigator.serviceWorker.controller !== null,
        null,
        { timeout: 30_000 },
      ),
    ).pipe(Effect.ignore)
    const isFirstControlled = yield* isControlled(page)
    if (!isFirstControlled) {
      const state = yield* workerState(page)
      yield* Console.log(`worker: ${encodeJson(WorkerState)(state)}`)
      const registered = yield* attempt(() =>
        page.evaluate(() =>
          navigator.serviceWorker.register('sw.js').then(
            registration => `ok, scope ${registration.scope}`,
            (error: unknown) => `failed: ${globalThis.String(error)}`,
          ),
        ),
      )
      yield* Console.log(`registering by hand: ${registered}`)
    }
    yield* check(
      isFirstControlled,
      'online: the service worker controls the page',
    )
    const firstCaches = yield* gameCaches(page)
    yield* Console.log(`caches: ${encodeCaches(firstCaches)}`)
    yield* check(
      firstCaches.length === 1 && (firstCaches[0]?.entries ?? 0) > 10,
      'online: one cache holds the precached game',
    )
    return firstCaches
  })

const servers: { current: Subprocess | undefined } = { current: undefined }

const audit = (base: string, isLocal: boolean) =>
  Effect.gen(function* () {
    if (isLocal) {
      yield* build('offline-one')
      servers.current = yield* serve
      const count = yield* precacheCount
      yield* Console.log(`precache list: ${count} files`)
    }
    const browser = yield* openBrowser
    const context = yield* attempt(() =>
      browser.newContext({
        viewport: { width: PHONE_844.width, height: PHONE_844.height },
        deviceScaleFactor: PHONE_844.scale,
        isMobile: true,
        hasTouch: true,
      }),
    )
    const services = yield* Effect.context()
    const errors: Array<string> = []
    context.on('weberror', error => errors.push(error.error().message))
    context.on('console', message => {
      const text = message.text()
      if (message.type() === 'error' || /service ?worker|sw\.js/i.test(text)) {
        Effect.runSyncWith(services)(
          Console.log(`console ${message.type()}: ${text}`),
        )
      }
    })
    yield* Effect.gen(function* () {
      const page = yield* attempt(() => context.newPage())
      const firstCaches = yield* offlinePart(page, base)
      if (failures.length > 0) {
        return yield* failWith(
          'the worker never took control, so offline is moot',
        )
      }
      const firstScript = yield* runningScript(page)

      yield* goOffline(context, servers.current)
      servers.current = undefined
      const versionOffline = yield* attempt(() => page.evaluate(fetchVersion))
      yield* check(
        versionOffline === 'failed',
        'offline: version.json is not cached',
      )

      const reloaded = yield* openGame(page, reload(page))
      yield* check(reloaded.isSplashShown, 'offline reload: the splash shows')
      yield* check(reloaded.isBooted, 'offline reload: the game boots')
      yield* attempt(() => page.close())

      const cold = yield* attempt(() => context.newPage())
      const started = yield* openGame(cold, goto(cold, base))
      yield* check(
        started.isSplashShown,
        'offline cold start: the splash shows',
      )
      yield* check(started.isBooted, 'offline cold start: the game boots')
      const coldScript = yield* runningScript(cold)
      yield* check(
        coldScript === firstScript,
        'offline cold start: the same build runs',
      )
      const run = yield* playARun(cold)
      yield* Console.log(
        `run: ${run.frames} frames in 2s, status "${run.status}"`,
      )
      yield* check(run.frames > 30, 'offline: a run plays frames')

      yield* attempt(() => cold.reload({ waitUntil: 'domcontentloaded' }))
      yield* awaitSplashGone(cold)
      yield* openSettings(cold)
      if ((yield* soundPressed(cold)) !== 'false') {
        yield* attempt(() => soundToggle(cold).tap())
      }
      yield* wait(800)
      yield* openGame(cold, reload(cold))
      const isStillMuted = yield* isMuted(cold)
      yield* check(isStillMuted, 'offline: the muted sound outlives a reload')

      if (isLocal) {
        yield* updatePart(context, cold, firstCaches[0]?.name ?? '', base)
      }
    }).pipe(
      Effect.ensuring(
        Effect.andThen(
          attempt(() => browser.close()).pipe(Effect.ignore),
          Effect.suspend(() => stop(servers.current)),
        ),
      ),
    )
    yield* Console.log(
      errors.length === 0
        ? 'no page errors'
        : `page errors: ${Array.join(errors, ' | ')}`,
    )
    yield* check(errors.length === 0, 'no page errors')
    if (failures.length > 0) {
      yield* Console.log(`${failures.length} failed`)
      return yield* Effect.sync(() => process.exit(1))
    }
    yield* Console.log('all clear')
  })

const updatePart = (
  context: BrowserContext,
  page: Page,
  oldCache: string,
  base: string,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const root = yield* rootDir
    const server = yield* serve
    yield* Effect.gen(function* () {
      yield* attempt(() => context.setOffline(false))
      yield* openGame(page, goto(page, base))
      yield* build('offline-two')
      yield* attempt(() =>
        page.evaluate(() =>
          document.dispatchEvent(new Event('visibilitychange')),
        ),
      )
      yield* attempt(() =>
        page.locator('.home-gift').waitFor({ timeout: 10_000 }),
      )
      yield* check(true, 'update: the chip appears for the new build')
      yield* attempt(() =>
        Promise.all([
          page.waitForEvent('load', { timeout: 30_000 }),
          page.locator('.home-gift').tap(),
        ]),
      )
      yield* awaitSplashGone(page)
      const servedScripts = yield* fs.readFileString(`${root}/dist/index.html`)
      const script = yield* runningScript(page)
      yield* check(
        script !== '' &&
          Array.every(String.split(' ')(script), src =>
            String.includes(src)(servedScripts),
          ),
        'update: the reload lands on the new build',
      )
      yield* wait(1000)
      const after = yield* gameCaches(page)
      yield* Console.log(`caches after the update: ${encodeCaches(after)}`)
      yield* check(
        Array.every(after, cache => cache.name !== oldCache) &&
          Array.some(
            after,
            cache => cache.name === `${CACHE_PREFIX}offline-two`,
          ),
        'update: the old cache is gone, the new one is there',
      )
      const chips = yield* attempt(() => page.locator('.home-gift').count())
      yield* check(chips === 0, 'update: no chip after the reload')

      yield* attempt(() => context.setOffline(true))
      yield* stop(server)
      const cold = yield* attempt(() => context.newPage())
      const started = yield* openGame(cold, goto(cold, base))
      const coldScript = started.isBooted
        ? yield* runningScript(cold)
        : undefined
      yield* check(
        started.isBooted && coldScript === script,
        'update: an offline cold start runs the new build',
      )
    }).pipe(Effect.ensuring(stop(server)))
  })

runAuditWith(
  Effect.gen(function* () {
    const base = yield* Base
    yield* audit(base, base === LOCAL)
  }),
  Layer.merge(NodeServices.layer, FetchHttpClient.layer),
)
