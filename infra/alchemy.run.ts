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

const DOMAIN = 'munchmanor.com'

const gameDomain = (stage: string) =>
  stage === PRODUCTION_STAGE
    ? { domain: { name: DOMAIN, redirects: [`www.${DOMAIN}`] } }
    : {}

const apiDomain = (stage: string) =>
  stage === PRODUCTION_STAGE ? { domain: `api.${DOMAIN}` } : {}

const infraEffect = Effect.map(Path.Path, path =>
  path.join(
    path.dirname(createRequire(import.meta.url).resolve('effect/package.json')),
    'dist',
  ),
)

const RATE_LIMIT_NAMESPACES = {
  visit: 7101,
  address: 7102,
  sync: 7103,
  recordings: 7104,
}

const RUNS_PER_VISIT_PER_MINUTE = 6
const RUNS_PER_ADDRESS_PER_MINUTE = 60

const SYNC_REQUESTS_PER_ADDRESS_PER_MINUTE = 30

const RECORDINGS_PER_PLAYER_PER_MINUTE = 10

const RETENTION_CRON = '17 4 * * *'

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

  const syncSecret = yield* Alchemy.makeRandom('SyncSecret')

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
      PLAYER_LOGS: Cloudflare.DurableObject('PlayerLog'),
      LINK_CODES: Cloudflare.DurableObject('LinkCodes'),
      SYNC_SECRET: syncSecret,
      SYNC_BY_ADDRESS: Cloudflare.RateLimit('SYNC_BY_ADDRESS', {
        namespaceId: RATE_LIMIT_NAMESPACES.sync,
        simple: { limit: SYNC_REQUESTS_PER_ADDRESS_PER_MINUTE, period: 60 },
      }),
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

    return yield* Cloudflare.Website.Vite('Website', {
      name: workerName(stage),
      ...gameDomain(stage),
      rootDir: path.resolve(import.meta.dirname, '..'),
      assets: { notFoundHandling: 'none' },
      env: {
        VITE_API_ORIGIN: Output.map(apiUrl, url => url ?? ''),
        VITE_COOP: 'On',
      },
      memo: {
        include: [...SITE_INPUTS],
        lockfile: true,
      },
    })
  })

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
