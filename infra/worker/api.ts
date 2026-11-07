import { Array, String } from 'effect'
import * as Clock from 'effect/Clock'
import type * as Config from 'effect/Config'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import * as HttpApi from 'effect/http-api/HttpApi'
import * as HttpApiBuilder from 'effect/http-api/HttpApiBuilder'
import * as HttpApiEndpoint from 'effect/http-api/HttpApiEndpoint'
import * as HttpApiGroup from 'effect/http-api/HttpApiGroup'
import * as HttpApiSchema from 'effect/http-api/HttpApiSchema'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServer from 'effect/http/HttpServer'
import type * as HttpServerRequest from 'effect/http/HttpServerRequest'
import * as SqlClient from 'effect/sql/SqlClient'
import type * as SqlError from 'effect/sql/SqlError'

import { HEALTH_PATH, RUNS_PATH, SHARES_PATH } from '../../src/analytics.ts'
import {
  type RateDecision,
  type RunRow,
  type ShareRow,
  addressHashInput,
  addressRateKey,
  bodySize,
  decideRate,
  declaredSize,
  decodeShare,
  decodeSummary,
  rateOutcome,
  retentionCutoffDay,
  rowOf,
  shareRowOf,
  utcDay,
  visitRateKey,
} from './rules.ts'

// ENVIRONMENT

export type RateLimiter = Readonly<{
  limit: (options: { key: string }) => Promise<{ success: boolean }>
}>

// NOTE: main.ts builds this from the Worker's bindings for each request: the
// D1 database as an Effect SQL layer, the two rate limit bindings, and the
// address salt. Tests build it over SQLite and counting fakes.
/** @stability unstable */
export type WorkerServices = Readonly<{
  database: Layer.Layer<
    SqlClient.SqlClient,
    Config.ConfigError | SqlError.SqlError
  >
  visitLimiter: RateLimiter
  addressLimiter: RateLimiter
  addressSalt: string
}>

/** @stability unstable */
export class WorkerEnv extends Context.Service<WorkerEnv, WorkerServices>()(
  'munch-manor-infra/worker/api/WorkerEnv',
) {}

// ERRORS

class SummaryTooLarge extends Schema.TaggedError<
  SummaryTooLarge,
  { readonly brand: unique symbol }
>()('SummaryTooLarge', {}, { httpApiStatus: 413 }) {}

class SummaryRejected extends Schema.TaggedError<
  SummaryRejected,
  { readonly brand: unique symbol }
>()('SummaryRejected', {}, { httpApiStatus: 400 }) {}

class RateLimited extends Schema.TaggedError<
  RateLimited,
  { readonly brand: unique symbol }
>()(
  'RateLimited',
  { by: Schema.Literals(['Visit', 'Address']) },
  { httpApiStatus: 429 },
) {}

class StoreUnavailable extends Schema.TaggedError<
  StoreUnavailable,
  { readonly brand: unique symbol }
>()('StoreUnavailable', {}, { httpApiStatus: 503 }) {}

// API

export const Health = Schema.Struct({
  status: Schema.Literal('Ok'),
  database: Schema.Literals(['Ok', 'Unavailable']),
})
export type Health = typeof Health.Type

const Api = HttpApi.make('munch-manor').add(
  HttpApiGroup.make('runs')
    .add(
      HttpApiEndpoint.post('record', RUNS_PATH, {
        success: HttpApiSchema.Accepted,
        error: [
          SummaryTooLarge,
          SummaryRejected,
          RateLimited,
          StoreUnavailable,
        ],
      }),
    )
    .add(
      HttpApiEndpoint.post('share', SHARES_PATH, {
        success: HttpApiSchema.Accepted,
        error: [
          SummaryTooLarge,
          SummaryRejected,
          RateLimited,
          StoreUnavailable,
        ],
      }),
    )
    .add(HttpApiEndpoint.get('health', HEALTH_PATH, { success: Health })),
)

// DATABASE

// NOTE: the database layer is built for this one effect and closed after
// it, as each request brings its own bindings.
const withDatabase = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const env = yield* WorkerEnv
      const database = yield* Layer.build(env.database)
      return yield* Effect.provideContext(effect, database)
    }),
  )

const insertRun = (row: RunRow) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`INSERT INTO runs ${sql.insert(row)}`
  })

const insertShare = (row: ShareRow) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`INSERT INTO shares ${sql.insert(row)}`
  })

// NOTE: the retention rule: every run row and share row received before the
// cutoff day goes. Both tables index received_day, so each is one range
// delete. Answers how many run rows went.
/** @stability unstable */
export const deleteExpiredRuns = (nowMs: number) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const cutoff = retentionCutoffDay(nowMs)
    const deleted = yield* sql<{
      readonly id: number
    }>`DELETE FROM runs WHERE received_day < ${cutoff} RETURNING id`
    yield* sql`DELETE FROM shares WHERE received_day < ${cutoff}`
    return deleted.length
  })

const checkDatabase = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`SELECT 1 AS ok`
})

// RATE LIMITS

const sha256Hex = (input: string) =>
  Effect.promise(() =>
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(input)),
  ).pipe(
    Effect.map(digest =>
      Array.join(
        globalThis.Array.from(new Uint8Array(digest), byte =>
          String.padStart(2, '0')(byte.toString(16)),
        ),
        '',
      ),
    ),
  )

const isWithin = (limiter: RateLimiter, key: string) =>
  Effect.promise(() => limiter.limit({ key })).pipe(
    Effect.map(({ success }) => rateOutcome(success)),
    Effect.orElseSucceed(() => rateOutcome(true)),
  )

const CLIENT_ADDRESS_HEADER = 'cf-connecting-ip'
const UNKNOWN_ADDRESS = 'unknown'

const checkRate = (visitId: string, address: string) =>
  Effect.gen(function* () {
    const env = yield* WorkerEnv
    const nowMs = yield* Clock.currentTimeMillis
    const addressHash = yield* sha256Hex(
      addressHashInput(env.addressSalt, utcDay(nowMs), address),
    )
    const [visit, byAddress] = yield* Effect.all([
      isWithin(env.visitLimiter, visitRateKey(visitId)),
      isWithin(env.addressLimiter, addressRateKey(addressHash)),
    ])
    return decideRate({ visit, address: byAddress })
  })

const failWhenLimited = (decision: RateDecision) =>
  decision._tag === 'Limited'
    ? Effect.fail(RateLimited.make({ by: decision.by }))
    : Effect.void

// HANDLERS

const healthy: Health = { status: 'Ok', database: 'Ok' }

const databaseDown: Health = { status: 'Ok', database: 'Unavailable' }

// NOTE: a run summary and a share event go in the same way: the size cap,
// the decode, the rate limits by visit and by address, then one row.
const recordPosted = <A extends { readonly visitId: string }, E>(
  request: HttpServerRequest.HttpServerRequest,
  decode: (body: string) => Effect.Effect<A, E>,
  insert: (
    posted: A,
    nowMs: number,
  ) => Effect.Effect<void, SqlError.SqlError, SqlClient.SqlClient>,
) =>
  Effect.gen(function* () {
    if (declaredSize(request.headers['content-length']) === 'TooLarge') {
      return yield* SummaryTooLarge.make()
    }
    const body = yield* Effect.orElseSucceed(request.text, () => '')
    if (bodySize(body) === 'TooLarge') {
      return yield* SummaryTooLarge.make()
    }
    const posted = yield* Effect.mapError(decode(body), () =>
      SummaryRejected.make(),
    )
    const address = Option.getOrElse(
      Option.fromNullishOr(request.headers[CLIENT_ADDRESS_HEADER]),
      () => UNKNOWN_ADDRESS,
    )
    yield* Effect.flatMap(checkRate(posted.visitId, address), failWhenLimited)
    const nowMs = yield* Clock.currentTimeMillis
    yield* withDatabase(insert(posted, nowMs)).pipe(
      Effect.mapError(() => StoreUnavailable.make()),
    )
  })

const RunsLive = HttpApiBuilder.group(Api, 'runs', handlers =>
  handlers
    .handleRaw('record', ({ request }) =>
      recordPosted(request, decodeSummary, (summary, nowMs) =>
        Effect.flatMap(rowOf(summary, nowMs), insertRun),
      ),
    )
    .handleRaw('share', ({ request }) =>
      recordPosted(request, decodeShare, (event, nowMs) =>
        insertShare(shareRowOf(event, nowMs)),
      ),
    )
    .handle('health', () =>
      withDatabase(checkDatabase).pipe(
        Effect.as(healthy),
        Effect.orElseSucceed(() => databaseDown),
      ),
    ),
)

const ApiLive = HttpApiBuilder.layer(Api).pipe(
  Layer.provide(RunsLive),
  Layer.provide(HttpServer.layerServices),
)

export const makeHandler = () =>
  HttpRouter.toWebHandler(ApiLive, { disableLogger: true })
