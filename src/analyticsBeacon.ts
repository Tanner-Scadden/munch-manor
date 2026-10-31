import { Array, Data, Effect, Option, Random, Schema, pipe } from 'effect'
import { FetchHttpClient, HttpClient, HttpClientRequest } from 'effect/http'

import {
  MAX_SUMMARY_BYTES,
  PostedRunJson,
  type PostedRunSummary,
  RUNS_PATH,
  SHARES_PATH,
  type ShareEvent,
  ShareEventJson,
  VISIT_ID_LENGTH,
} from './analytics'
import { API_ORIGIN } from './apiOrigin'
import { describeError } from './describeError'

// API ORIGIN

const maybeApiUrl = (path: string, origin: string): Option.Option<string> =>
  origin === ''
    ? Option.none()
    : Option.liftThrowable(() => new URL(path, origin).href)()

export const maybeRunsUrl = (origin: string): Option.Option<string> =>
  maybeApiUrl(RUNS_PATH, origin)

const maybeSharesUrl = (origin: string): Option.Option<string> =>
  maybeApiUrl(SHARES_PATH, origin)

// VISIT

const HEX_DIGITS_PER_PART = 4
const PART_LIMIT = 16 ** HEX_DIGITS_PER_PART

const hexPart = (value: number): string =>
  value.toString(16).padStart(HEX_DIGITS_PER_PART, '0')

export const generateVisitId: Effect.Effect<string> = pipe(
  Effect.all(
    Array.makeBy(VISIT_ID_LENGTH / HEX_DIGITS_PER_PART, () =>
      Random.nextIntBetween(0, PART_LIMIT - 1),
    ),
  ),
  Effect.map(parts => Array.join(Array.map(parts, hexPart), '')),
)

// SEND

const SummaryTransport = Schema.Literals(['Beacon', 'Fetch', 'Unconfigured'])
type SummaryTransport = typeof SummaryTransport.Type

class SummarySendError extends Data.TaggedError('SummarySendError')<{
  readonly reason: string
}> {}

const toSendError = (error: unknown): SummarySendError =>
  new SummarySendError({ reason: describeError(error) })

// NOTE: text/plain keeps both requests "simple", so the browser sends them
// cross-origin with no preflight. The Worker decodes the body as JSON anyway.
const SUMMARY_CONTENT_TYPE = 'text/plain;charset=UTF-8'

const queueBeacon = (url: string, body: string) =>
  Effect.try({
    try: () =>
      navigator.sendBeacon(
        url,
        new Blob([body], { type: SUMMARY_CONTENT_TYPE }),
      ),
    catch: toSendError,
  })

// NOTE: the fallback when the browser will not queue a beacon. no-cors
// answers with an opaque response, so only a request that never went out
// counts as a failure. Trace headers stay off: they are not CORS-safelisted.
const postKeepalive = (url: string, body: string) =>
  pipe(
    HttpClient.execute(
      HttpClientRequest.bodyText(
        HttpClientRequest.post(url),
        body,
        SUMMARY_CONTENT_TYPE,
      ),
    ),
    Effect.provideService(FetchHttpClient.RequestInit, {
      keepalive: true,
      mode: 'no-cors',
      credentials: 'omit',
    }),
    Effect.provideService(HttpClient.TracerPropagationEnabled, false),
    Effect.provide(FetchHttpClient.layer),
    Effect.mapError(toSendError),
  )

const sendTo = (
  url: string,
  body: string,
): Effect.Effect<SummaryTransport, SummarySendError> =>
  pipe(
    queueBeacon(url, body),
    Effect.orElseSucceed(() => false),
    Effect.flatMap(isQueued =>
      isQueued
        ? Effect.succeed<SummaryTransport>('Beacon')
        : Effect.as(postKeepalive(url, body), 'Fetch'),
    ),
  )

export const sendRunSummary = (
  summary: PostedRunSummary,
  origin: string = API_ORIGIN,
): Effect.Effect<SummaryTransport, SummarySendError> =>
  Option.match(maybeRunsUrl(origin), {
    onNone: () => Effect.succeed<SummaryTransport>('Unconfigured'),
    onSome: url =>
      pipe(
        Schema.encodeEffect(PostedRunJson)(summary),
        Effect.mapError(toSendError),
        Effect.filterOrFail(
          body => new Blob([body]).size <= MAX_SUMMARY_BYTES,
          () => new SummarySendError({ reason: 'summary too large' }),
        ),
        Effect.flatMap(body => sendTo(url, body)),
      ),
  })

// NOTE: a tap on SHARE, sent the same way as a run summary.
export const sendShareEvent = (
  event: ShareEvent,
  origin: string = API_ORIGIN,
): Effect.Effect<SummaryTransport, SummarySendError> =>
  Option.match(maybeSharesUrl(origin), {
    onNone: () => Effect.succeed<SummaryTransport>('Unconfigured'),
    onSome: url =>
      pipe(
        Schema.encodeEffect(ShareEventJson)(event),
        Effect.mapError(toSendError),
        Effect.flatMap(body => sendTo(url, body)),
      ),
  })
