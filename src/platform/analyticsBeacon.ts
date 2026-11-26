import {
  Array,
  Effect,
  Function,
  Layer,
  Option,
  Random,
  Schema,
  String,
  pipe,
} from 'effect'
import { FetchHttpClient, HttpClient, HttpClientRequest } from 'effect/http'

import { describeError } from '../shared/describeError'
import { isObjectFirst } from '../shared/dualArgs'
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

const maybeApiUrl = (path: string, origin: string): Option.Option<string> =>
  origin === ''
    ? Option.none()
    : Option.liftThrowable(() => new URL(path, origin).href)()

export const maybeRunsUrl = (origin: string): Option.Option<string> =>
  maybeApiUrl(RUNS_PATH, origin)

const maybeSharesUrl = (origin: string): Option.Option<string> =>
  maybeApiUrl(SHARES_PATH, origin)

const HEX_DIGITS_PER_PART = 4
const PART_LIMIT = 16 ** HEX_DIGITS_PER_PART

const hexPart = (value: number): string =>
  String.padStart(HEX_DIGITS_PER_PART, '0')(value.toString(16))

export const generateVisitId: Effect.Effect<string> = pipe(
  Effect.all(
    Array.makeBy(VISIT_ID_LENGTH / HEX_DIGITS_PER_PART, () =>
      Random.nextIntBetween(0, PART_LIMIT - 1),
    ),
  ),
  Effect.map(parts => Array.join(Array.map(parts, hexPart), '')),
)

const SummaryTransport = Schema.Literals(['Beacon', 'Fetch', 'Unconfigured'])
type SummaryTransport = typeof SummaryTransport.Type

class SummarySendError extends Schema.TaggedError<
  SummarySendError,
  { readonly brand: unique symbol }
>()('SummarySendError', {
  reason: Schema.String,
}) {}

const toSendError = (error: unknown): SummarySendError =>
  SummarySendError.make({ reason: describeError(error) })

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

const postKeepalive = (url: string, body: string) =>
  pipe(
    Layer.build(FetchHttpClient.layer),
    Effect.flatMap(client =>
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
        Effect.provide(client),
      ),
    ),
    Effect.scoped,
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

export const sendRunSummary: {
  (
    origin?: string,
  ): (
    summary: PostedRunSummary,
  ) => Effect.Effect<SummaryTransport, SummarySendError>
  (
    summary: PostedRunSummary,
    origin?: string,
  ): Effect.Effect<SummaryTransport, SummarySendError>
} = Function.dual(
  isObjectFirst,
  (
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
            () => SummarySendError.make({ reason: 'summary too large' }),
          ),
          Effect.flatMap(body => sendTo(url, body)),
        ),
    }),
)

export const sendShareEvent: {
  (
    origin?: string,
  ): (event: ShareEvent) => Effect.Effect<SummaryTransport, SummarySendError>
  (
    event: ShareEvent,
    origin?: string,
  ): Effect.Effect<SummaryTransport, SummarySendError>
} = Function.dual(
  isObjectFirst,
  (
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
    }),
)
