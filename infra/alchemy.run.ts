import * as Alchemy from 'alchemy'
import * as Output from 'alchemy/Output'
import { String } from 'effect'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'
import { createRequire } from 'node:module'

import * as Cloudflare from '@alchemy.run/cloudflare'
import * as GitHub from '@alchemy.run/github'

import { SITE_INPUTS } from './siteInputs'

const PRODUCTION_STAGE = 'prod'

const stageName = (base: string, stage: string): string =>
  stage === PRODUCTION_STAGE ? base : `${base}-${stage}`

const workerName = (stage: string): string => stageName('munch-manor', stage)

const apiWorkerName = (stage: string): string =>
  stageName('munch-manor-api', stage)

// NOTE: production's own domain (the munchmanor.com zone, in the same
// account). The game answers at the apex, www redirects to it with a 301
// (a redirect rule that runs before the Worker), and the API Worker answers
// at api.munchmanor.com. Both Workers keep their workers.dev addresses too:
// saves live per origin (OPFS, localStorage, the service worker's cache) and
// installed apps are bound to the origin they were installed from, so the
// old address must keep serving the same build (see "Two origins" in
// PLATFORM.md). Preview stages stay on workers.dev only.
const DOMAIN = 'munchmanor.com'

const gameDomain = (stage: string) =>
  stage === PRODUCTION_STAGE
    ? { domain: { name: DOMAIN, redirects: [`www.${DOMAIN}`] } }
    : {}

const apiDomain = (stage: string) =>
  stage === PRODUCTION_STAGE ? { domain: `api.${DOMAIN}` } : {}

// NOTE: the Worker imports src/platform/analytics.ts, which the game shares, so its
// `effect` import would resolve from the game's node_modules (Foldkit pins an
// older Effect). The alias bundles infra's one copy of Effect for the shared
// Schema and the HttpApi alike. It points at the built files, since an alias
// skips the package's exports map: `effect/Schema` becomes `dist/Schema`.
const infraEffect = Effect.map(Path.Path, path =>
  path.join(
    path.dirname(createRequire(import.meta.url).resolve('effect/package.json')),
    'dist',
  ),
)

// NOTE: each stage gets its own D1 database, its own salt for the daily
// address hash, and its own rate limit namespaces. The free plan allows
// 100,000 Worker requests and 100,000 D1 rows written a day; one run writes
// one row.
const RATE_LIMIT_NAMESPACES = {
  visit: 7101,
  address: 7102,
  sync: 7103,
  recordings: 7104,
}

const RUNS_PER_VISIT_PER_MINUTE = 6
const RUNS_PER_ADDRESS_PER_MINUTE = 60

// NOTE: identity requests (challenges, sessions, link codes) per address.
// Sync messages themselves need a token and go to the scope's object.
const SYNC_REQUESTS_PER_ADDRESS_PER_MINUTE = 30

// NOTE: recorded runs (worker/recordings.ts) per player. A run takes minutes,
// so ten a minute only stops a client gone wrong; the game's queue sends
// what waited 7 seconds apart.
const RECORDINGS_PER_PLAYER_PER_MINUTE = 10

// NOTE: the analytics retention cleanup (worker/main.ts) runs once a day at
// 04:17 UTC and deletes run rows older than 90 days. Only production gets
// the Cron Trigger: the free plan allows five per account, and a preview's
// database is destroyed with its pull request anyway.
const RETENTION_CRON = '17 4 * * *'

// NOTE: Workers Logs for the API Worker, kept (persisted) so a co-op game's
// end-of-game log (worker/gameRoom.ts, RoomGameEnded) can be read after
// the fact, every invocation sampled while traffic is small. The free plan
// keeps 3 days and 200,000 events a day; Workers Paid 7 days and 20
// million a month. Lower `headSamplingRate` if traffic grows past that.
// See "Reading the room's logs" in PLATFORM.md.
const API_OBSERVABILITY = {
  enabled: true,
  headSamplingRate: 1,
  logs: {
    enabled: true,
    persist: true,
    invocationLogs: true,
    headSamplingRate: 1,
  },
}

// NOTE: the co-op dev page (the stand-in world in a room) is a test tool:
// every stage but production gets it.
const hasDevPage = (stage: string): boolean => stage !== PRODUCTION_STAGE

const Analytics = Effect.gen(function* () {
  const stage = yield* Alchemy.Stage
  const path = yield* Path.Path
  const effectAlias = yield* infraEffect

  const database = yield* Cloudflare.D1.Database('Analytics', {
    name: stageName('munch-manor-analytics', stage),
    migrations: path.resolve(import.meta.dirname, 'migrations'),
  })

  const addressSalt = yield* Alchemy.makeRandom('AddressSalt')

  // NOTE: signs sync session tokens and challenges. Made once per stage.
  const syncSecret = yield* Alchemy.makeRandom('SyncSecret')

  // NOTE: RECORD MY RUNS (worker/recordings.ts): each recorded run, one
  // object per run under its player's id, for training a bot that plays like
  // them (docs/BOT_PLAN.md). Private: only the Worker writes it, and the
  // owner reads it with wrangler. The free tier holds 10 GB.
  const recordings = yield* Cloudflare.R2.Bucket('Recordings', {
    name: stageName('munch-manor-recordings', stage),
  })

  return yield* Cloudflare.Worker('Api', {
    name: apiWorkerName(stage),
    ...apiDomain(stage),
    main: path.resolve(import.meta.dirname, 'worker/main.ts'),
    crons: stage === PRODUCTION_STAGE ? [RETENTION_CRON] : [],
    observability: API_OBSERVABILITY,
    env: {
      DB: database,
      ADDRESS_SALT: addressSalt,
      RUNS_BY_VISIT: Cloudflare.RateLimit('RUNS_BY_VISIT', {
        namespaceId: RATE_LIMIT_NAMESPACES.visit,
        simple: { limit: RUNS_PER_VISIT_PER_MINUTE, period: 60 },
      }),
      RUNS_BY_ADDRESS: Cloudflare.RateLimit('RUNS_BY_ADDRESS', {
        namespaceId: RATE_LIMIT_NAMESPACES.address,
        simple: { limit: RUNS_PER_ADDRESS_PER_MINUTE, period: 60 },
      }),
      // NOTE: the sync engine (worker/sync.ts): one SQLite-backed Durable
      // Object per player scope, and one directory of devices and link codes.
      // Both are hosted by this Worker, so the game keeps one API origin.
      SYNC_SCOPES: Cloudflare.DurableObject('SyncScope'),
      SYNC_DIRECTORY: Cloudflare.DurableObject('SyncDirectory'),
      SYNC_SECRET: syncSecret,
      SYNC_BY_ADDRESS: Cloudflare.RateLimit('SYNC_BY_ADDRESS', {
        namespaceId: RATE_LIMIT_NAMESPACES.sync,
        simple: { limit: SYNC_REQUESTS_PER_ADDRESS_PER_MINUTE, period: 60 },
      }),
      // NOTE: co-op rooms (worker/gameRoom.ts): one SQLite-backed Durable
      // Object per room, holding its `room:<code>` lobby scope and, while a
      // run is on, the run. QUICK PLAY's one Matchmaker (worker/matchmaker.ts)
      // keeps its queue in hibernating sockets. Every stage, production
      // included (approved 2026-10-29): both are SQLite classes, which the
      // free plan allows, and neither ticks while idle.
      GAME_ROOMS: Cloudflare.DurableObject('GameRoom'),
      MATCHMAKER: Cloudflare.DurableObject('Matchmaker'),
      RECORDINGS: recordings,
      RECORDINGS_BY_PLAYER: Cloudflare.RateLimit('RECORDINGS_BY_PLAYER', {
        namespaceId: RATE_LIMIT_NAMESPACES.recordings,
        simple: { limit: RECORDINGS_PER_PLAYER_PER_MINUTE, period: 60 },
      }),
    },
    build: {
      input: { resolve: { alias: { effect: effectAlias } } },
    },
  })
})

const Website = (apiUrl: Output.Output<string | undefined>) =>
  Effect.gen(function* () {
    const stage = yield* Alchemy.Stage
    const path = yield* Path.Path

    return yield* Cloudflare.Website.Foldkit('Website', {
      name: workerName(stage),
      ...gameDomain(stage),
      rootDir: path.resolve(import.meta.dirname, '..'),
      // The game has no routes. With the default single page fallback a
      // nested path such as /a/b served index.html, whose relative asset
      // paths then missed, so unknown paths answer 404 instead.
      assets: { notFoundHandling: 'none' },
      // NOTE: VITE_ variables are inlined into the game's bundle. This one
      // tells the game where to post run summaries (src/platform/analyticsBeacon.ts),
      // sync, and open co-op rooms. It is the API Worker's primary URL:
      // https://api.munchmanor.com in production, its workers.dev URL
      // elsewhere. The API allows any origin, so the build served at the old
      // workers.dev address reaches it too.
      // VITE_COOP shows the CO-OP tile. It is on for every stage since the
      // account moved to Workers Paid on 2026-10-30 (MULTIPLAYER.md, decision 8).
      env: {
        VITE_API_ORIGIN: Output.map(apiUrl, url => url ?? ''),
        VITE_COOP: 'On',
      },
      // NOTE: rebuilt only when an input changes (siteInputs.ts).
      memo: {
        include: [...SITE_INPUTS],
        lockfile: true,
      },
    })
  })

// NOTE: the co-op dev page (tools/mp-dev), a small static site of its own
// that is never part of the game's bundle, pointed at this stage's API
// Worker. Preview stages only.
const MpDev = (apiUrl: Output.Output<string | undefined>) =>
  Effect.gen(function* () {
    const stage = yield* Alchemy.Stage
    const path = yield* Path.Path

    return yield* Cloudflare.Website.StaticSite('MpDev', {
      name: stageName('munch-manor-mp-dev', stage),
      command: 'bun tools/mp-dev/build.ts',
      cwd: path.resolve(import.meta.dirname, '..'),
      outdir: 'tools/mp-dev/dist/page',
      env: { MP_DEV_API_ORIGIN: Output.map(apiUrl, url => url ?? '') },
      memo: {
        include: [
          'tools/mp-dev/*.ts',
          'tools/mp-dev/index.html',
          'packages/*/src/**',
          'packages/*/package.json',
          'package.json',
        ],
        lockfile: true,
      },
    })
  })

const PreviewComment = (
  url: Output.Output<string | undefined>,
  apiUrl: Output.Output<string | undefined>,
  mpDevLine: Output.Output<string> | string,
) =>
  Effect.gen(function* () {
    const github = yield* GitHub.GitHubEnv

    return github?.pr === undefined
      ? undefined
      : yield* GitHub.Comment('PreviewComment', {
          owner: github.owner,
          repository: github.repository,
          issueNumber: github.pr,
          body: Output.interpolate`
            ## Munch Manor preview

            **URL:** ${url}

            **Analytics API:** ${apiUrl}/api/health

            ${mpDevLine}

            Built from commit ${String.slice(0, 7)(github.sha)}. This comment updates on every push, and the preview is destroyed when the pull request closes.
          `,
        })
  })

// NOTE: the stack needs the Path service, which Alchemy's own platform
// layer provides; only the Alchemy CLI reads this export.
/** @stability unstable */
export default Alchemy.Stack(
  'munch-manor',
  {
    providers: Layer.mergeAll(Cloudflare.providers(), GitHub.providers()),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const stage = yield* Alchemy.Stage
    const api = yield* Analytics
    const website = yield* Website(api.url)
    const mpDev = hasDevPage(stage) ? yield* MpDev(api.url) : undefined
    yield* PreviewComment(
      website.url,
      api.url,
      mpDev === undefined
        ? ''
        : Output.map(
            mpDev.url,
            url =>
              `**Co-op dev page:** ${url ?? ''} (the stand-in world in a room: open it in 2 to 4 tabs)`,
          ),
    )

    return mpDev === undefined
      ? { url: website.url, apiUrl: api.url }
      : { url: website.url, apiUrl: api.url, mpDevUrl: mpDev.url }
  }),
)
