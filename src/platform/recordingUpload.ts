import { Effect, Function, Layer, Option, Schedule, Schema, pipe } from 'effect'
import type { Duration } from 'effect'
import { FetchHttpClient, HttpClient, HttpClientRequest } from 'effect/http'

import { describeError } from '#shared/describeError.ts'
import { isObjectFirst } from '#shared/dualArgs.ts'

import { API_ORIGIN } from './apiOrigin.ts'
import { type RunRecording, RunRecordingJson } from './recording.ts'
import {
  GZIP_CONTENT_TYPE,
  JSON_CONTENT_TYPE,
  MAX_RECORDING_BYTES,
  RECORDINGS_PATH,
  RUN_ID_PARAM,
  type RecordingEncoding,
} from './recordingApi.ts'
import { PlayerStore } from './store.ts'
import { isOnline } from './summaryQueue.ts'

class RecordingSendError extends Schema.TaggedError<
  RecordingSendError,
  { readonly brand: unique symbol }
>()('RecordingSendError', {
  reason: Schema.String,
}) {}

const toSendError = (error: unknown): RecordingSendError =>
  RecordingSendError.make({ reason: describeError(error) })

type Packed = Readonly<{ body: Uint8Array; encoding: RecordingEncoding }>

const pack = (json: string): Effect.Effect<Packed> =>
  typeof CompressionStream === 'undefined'
    ? Effect.succeed({
        body: new TextEncoder().encode(json),
        encoding: 'Plain',
      })
    : pipe(
        Effect.tryPromise({
          try: () =>
            new Response(
              new Blob([json])
                .stream()
                .pipeThrough(new CompressionStream('gzip')),
            ).arrayBuffer(),
          catch: toSendError,
        }),
        Effect.map((buffer): Packed => ({
          body: new Uint8Array(buffer),
          encoding: 'Gzip',
        })),
        Effect.orElseSucceed((): Packed => ({
          body: new TextEncoder().encode(json),
          encoding: 'Plain',
        })),
      )

const recordingUrl = (origin: string, runId: string): Option.Option<string> =>
  origin === ''
    ? Option.none()
    : Option.liftThrowable(() => {
        const url = new URL(RECORDINGS_PATH, origin)
        url.searchParams.set(RUN_ID_PARAM, runId)
        return url.href
      })()

const post = (url: string, token: string, { body, encoding }: Packed) =>
  pipe(
    Layer.build(FetchHttpClient.layer),
    Effect.flatMap(client =>
      pipe(
        HttpClient.execute(
          pipe(
            HttpClientRequest.post(url),
            HttpClientRequest.bearerToken(token),
            HttpClientRequest.bodyUint8Array(
              body,
              encoding === 'Gzip' ? GZIP_CONTENT_TYPE : JSON_CONTENT_TYPE,
            ),
          ),
        ),
        Effect.flatMap(response =>
          response.status >= 200 && response.status < 300
            ? Effect.void
            : Effect.fail(toSendError(`status ${response.status}`)),
        ),
        Effect.provideService(HttpClient.TracerPropagationEnabled, false),
        Effect.provide(client),
      ),
    ),
    Effect.scoped,
    Effect.mapError(toSendError),
  )

const tokenOf: Effect.Effect<string, RecordingSendError, PlayerStore> = pipe(
  PlayerStore.use(store => store.roomAccess),
  Effect.flatMap(
    Option.match({
      onNone: () => Effect.fail(toSendError('no sync session')),
      onSome: access => Effect.mapError(access.token, toSendError),
    }),
  ),
)

const sendBody = (body: string, origin: string) =>
  pipe(
    Schema.decodeEffect(RunRecordingJson)(body),
    Effect.mapError(toSendError),
    Effect.flatMap(recording =>
      Option.match(recordingUrl(origin, recording.runId), {
        onNone: () => Effect.void,
        onSome: url =>
          pipe(
            Effect.all({ token: tokenOf, packed: pack(body) }),
            Effect.filterOrFail(
              ({ packed }) => packed.body.byteLength <= MAX_RECORDING_BYTES,
              () => toSendError('recording too large'),
            ),
            Effect.flatMap(({ token, packed }) => post(url, token, packed)),
          ),
      }),
    ),
  )

const queueBody = (body: string) =>
  PlayerStore.use(store => store.queueRecording(body))

const QUEUE_SPACING: Duration.Input = '7 seconds'

const sendNextQueued = (origin: string) =>
  pipe(
    isOnline,
    Effect.flatMap(online =>
      online
        ? PlayerStore.use(store => store.takeQueuedRecording)
        : Effect.succeedNone,
    ),
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.succeed(false),
        onSome: body =>
          pipe(
            sendBody(body, origin),
            Effect.as(true),
            Effect.catch(() => Effect.as(queueBody(body), false)),
          ),
      }),
    ),
  )

const drainRecordingQueue = (origin: string) =>
  pipe(
    sendNextQueued(origin),
    Effect.repeat({
      while: isSent => isSent,
      schedule: Schedule.spaced(QUEUE_SPACING),
    }),
    Effect.asVoid,
    Effect.catch(error =>
      Effect.logWarning(
        'The recording queue could not be drained',
        error.reason,
      ),
    ),
  )

type UploadFailure = Readonly<{ reason: string }>

export const uploadRecording: {
  (
    origin?: string,
  ): (
    recording: RunRecording,
  ) => Effect.Effect<void, UploadFailure, PlayerStore>
  (
    recording: RunRecording,
    origin?: string,
  ): Effect.Effect<void, UploadFailure, PlayerStore>
} = Function.dual(
  isObjectFirst,
  (
    recording: RunRecording,
    origin: string = API_ORIGIN,
  ): Effect.Effect<void, UploadFailure, PlayerStore> =>
    origin === ''
      ? Effect.void
      : pipe(
          Schema.encodeEffect(RunRecordingJson)(recording),
          Effect.mapError(toSendError),
          Effect.flatMap(body =>
            Effect.flatMap(isOnline, online =>
              online
                ? pipe(
                    sendBody(body, origin),
                    Effect.tap(() =>
                      Effect.forkDetach(drainRecordingQueue(origin)),
                    ),
                    Effect.catch(() => queueBody(body)),
                  )
                : queueBody(body),
            ),
          ),
        ),
)

export const startRecordingQueue = (origin: string = API_ORIGIN) =>
  pipe(
    PlayerStore.use(store => store.load),
    Effect.flatMap(maybeSave =>
      Option.exists(maybeSave, save => save.recordRuns === 'On')
        ? drainRecordingQueue(origin)
        : PlayerStore.use(store => store.clearQueuedRecordings),
    ),
    Effect.catch(error =>
      Effect.logWarning('The recording queue could not start', error.reason),
    ),
  )
