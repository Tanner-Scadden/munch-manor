import { Function, String } from 'effect'
import * as Array from 'effect/Array'
import * as Clock from 'effect/Clock'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'

import { verifyToken } from '@munch/sync-engine'

import {
  GZIP_CONTENT_TYPE,
  JSON_CONTENT_TYPE,
  MAX_RECORDING_BYTES,
  RECORDINGS_PATH,
  RUN_ID_PARAM,
  type RecordingEncoding,
  maybeRunId,
  recordingKey,
} from '../../src/platform/recordingApi.ts'
import type { RateLimiter } from './api.ts'
import {
  CORS_HEADERS,
  bearerOf,
  json,
  syncErrorResponse,
  tryCall,
} from './syncCore.ts'

export type RecordingBucket = Readonly<{
  put: (
    key: string,
    value: ArrayBuffer,
    options: { httpMetadata: { contentType: string } },
  ) => Promise<unknown>
}>

export type RecordingBindings = Readonly<{
  SYNC_SECRET: string
  RECORDINGS: RecordingBucket
  RECORDINGS_BY_PLAYER: RateLimiter
}>

const ENCODINGS: Readonly<Record<string, RecordingEncoding>> = {
  [GZIP_CONTENT_TYPE]: 'Gzip',
  [JSON_CONTENT_TYPE]: 'Plain',
}

const CONTENT_TYPES: { readonly [Encoding in RecordingEncoding]: string } = {
  Gzip: GZIP_CONTENT_TYPE,
  Plain: JSON_CONTENT_TYPE,
}

const encodingOf = (request: Request): Option.Option<RecordingEncoding> =>
  Option.flatMap(
    Array.head(String.split(request.headers.get('content-type') ?? '', ';')),
    mediaType => Option.fromNullishOr(ENCODINGS[String.trim(mediaType)]),
  )

const isDeclaredTooLarge = (request: Request): boolean =>
  globalThis.Number(request.headers.get('content-length') ?? '0') >
  MAX_RECORDING_BYTES

const isWithinRate = (env: RecordingBindings, playerId: string) =>
  tryCall('check the recordings rate limit', () =>
    env.RECORDINGS_BY_PLAYER.limit({ key: `recording:${playerId}` }),
  ).pipe(
    Effect.map(outcome => outcome.success),
    Effect.catchTag('SyncCallFailed', () => Effect.succeed(true)),
  )

const routeRecordingPath = (
  request: Request,
  env: RecordingBindings,
  url: URL,
) =>
  Effect.gen(function* () {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }
    if (request.method !== 'POST') {
      return json(405, '{}')
    }
    const nowMs = yield* Clock.currentTimeMillis
    const claims = yield* Effect.result(
      verifyToken(
        env.SYNC_SECRET,
        Option.getOrElse(bearerOf(request), () => ''),
        nowMs,
      ),
    )
    if (Result.isFailure(claims)) {
      return json(401, '{}')
    }
    const { playerId } = claims.success
    const maybeRun = maybeRunId(url.searchParams.get(RUN_ID_PARAM) ?? '')
    const maybeEncoding = encodingOf(request)
    if (Option.isNone(maybeRun)) {
      return json(400, '{}')
    }
    if (Option.isNone(maybeEncoding)) {
      return json(415, '{}')
    }
    if (isDeclaredTooLarge(request)) {
      return json(413, '{}')
    }
    if (!(yield* isWithinRate(env, playerId))) {
      return json(429, '{}')
    }
    const body = yield* tryCall('read the recording', () =>
      request.arrayBuffer(),
    )
    if (body.byteLength === 0) {
      return json(400, '{}')
    }
    if (body.byteLength > MAX_RECORDING_BYTES) {
      return json(413, '{}')
    }
    const encoding = maybeEncoding.value
    yield* tryCall('store the recording', () =>
      env.RECORDINGS.put(
        recordingKey({ playerId, runId: maybeRun.value, encoding }),
        body,
        { httpMetadata: { contentType: CONTENT_TYPES[encoding] } },
      ),
    )
    return json(202, '{}')
  })

export const routeRecording: {
  (
    env: RecordingBindings,
  ): (request: Request) => Effect.Effect<Option.Option<Response>>
  (
    request: Request,
    env: RecordingBindings,
  ): Effect.Effect<Option.Option<Response>>
} = Function.dual(
  2,
  (
    request: Request,
    env: RecordingBindings,
  ): Effect.Effect<Option.Option<Response>> =>
    Effect.suspend(() => {
      const url = new URL(request.url)
      return url.pathname === RECORDINGS_PATH
        ? routeRecordingPath(request, env, url).pipe(
            syncErrorResponse,
            Effect.asSome,
          )
        : Effect.succeedNone
    }),
)
