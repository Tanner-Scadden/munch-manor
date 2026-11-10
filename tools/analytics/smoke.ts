import { Array, Console, Effect, Random, Schema, pipe } from 'effect'
import { FetchHttpClient, HttpClient, HttpClientRequest } from 'effect/http'

import * as NodeRuntime from '@effect/platform-node/NodeRuntime'

import {
  HEALTH_PATH,
  RUNS_PATH,
  RUN_SUMMARY_VERSION,
  type RunSummary,
  RunSummaryJson,
  SOLO_PARTY,
} from '../../src/platform/analytics'

// Posts one made-up run summary to a deployed analytics Worker, the way the
// game's beacon does, and checks /api/health. The run is marked with the
// build "smoke-test" so the report can tell it apart:
//
//   bun tools/analytics/smoke.ts https://munch-manor-api-pr-42.tanner-scadden.workers.dev
//   bun tools/analytics/smoke.ts https://api.munchmanor.com   # production

const USAGE = 'Usage: bun tools/analytics/smoke.ts <api origin>'

class SmokeError extends Schema.TaggedError<
  SmokeError,
  { readonly brand: unique symbol }
>()('SmokeError', { message: Schema.String }) {}

const SMOKE_BUILD = 'smoke-test'

const smokeSummary = (visitId: string): RunSummary => ({
  version: RUN_SUMMARY_VERSION,
  visitId,
  build: SMOKE_BUILD,
  mode: 'Campaign',
  difficulty: 'Normal',
  wave: 3,
  outcome: { _tag: 'GameOver', killedBy: 'Runner' },
  dareItemsFound: 1,
  runMs: 181_000,
  kills: {
    Shambler: 22,
    Runner: 5,
    Tank: 0,
    Exploder: 2,
    Thrower: 0,
    Crawler: 0,
    Boss: 0,
  },
  heartsLost: 5,
  keysSpent: 6,
  casesOpened: 1,
  powerUpsGrabbed: 1,
  trapsPlaced: 0,
  device: 'KeyboardMouse',
  screenFit: 'Browser',
  frameTime: 'Under17Ms',
  party: SOLO_PARTY,
  modifiers: 0,
})

const HEX_DIGITS = 16

const randomVisitId = Effect.map(
  Effect.all(Array.makeBy(HEX_DIGITS, () => Random.nextIntBetween(0, 15))),
  digits =>
    Array.join(
      Array.map(digits, digit => digit.toString(16)),
      '',
    ),
)

const call = (request: HttpClientRequest.HttpClientRequest) =>
  pipe(
    HttpClient.execute(request),
    Effect.flatMap(response =>
      Effect.map(response.text, body => ({ status: response.status, body })),
    ),
    Effect.mapError(error => SmokeError.make({ message: error.message })),
  )

const expectStatus =
  (expected: number, what: string) =>
  ({ status, body }: { status: number; body: string }) =>
    status === expected
      ? Console.log(`${what}: ${status} ${body}`)
      : Effect.fail(
          SmokeError.make({ message: `${what} answered ${status} ${body}` }),
        )

const program = Effect.gen(function* () {
  const origin = yield* Effect.fromOption(Array.get(process.argv, 2)).pipe(
    Effect.mapError(() => SmokeError.make({ message: USAGE })),
  )
  const visitId = yield* randomVisitId
  const body = yield* pipe(
    Schema.encodeEffect(RunSummaryJson)(smokeSummary(visitId)),
    Effect.mapError(error => SmokeError.make({ message: error.message })),
  )
  yield* Effect.flatMap(
    call(HttpClientRequest.get(new URL(HEALTH_PATH, origin).href)),
    expectStatus(200, `GET ${HEALTH_PATH}`),
  )
  yield* Effect.flatMap(
    call(
      HttpClientRequest.post(new URL(RUNS_PATH, origin).href).pipe(
        HttpClientRequest.bodyText(body, 'text/plain;charset=UTF-8'),
      ),
    ),
    expectStatus(202, `POST ${RUNS_PATH}`),
  )
})

NodeRuntime.runMain(
  program.pipe(
    Effect.catchTag('SmokeError', error =>
      Effect.andThen(
        Console.error(error.message),
        Effect.sync(() => {
          process.exitCode = 1
        }),
      ),
    ),
    Effect.provide(FetchHttpClient.layer),
  ),
)
