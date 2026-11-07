import {
  Clock,
  Effect,
  Option,
  Queue,
  Ref,
  Result,
  Schedule,
  Schema,
  type Scope,
  Stream,
  pipe,
} from 'effect'

import { PING_JSON, PONG_JSON } from '@munch/sync-engine'

import {
  type ClientFrame,
  MIN_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
  ServerFrame,
  decodeServerFrame,
  encodeClientFrame,
} from './Protocol'
import { type Ended, backoffUpTo, reconnecting } from './Reconnect'
import {
  type OpenSocket,
  SocketError,
  type TokenUnavailable,
  openSocket,
} from './Socket'

// NOTE: the realtime channel from the browser: one socket to the GameRoom
// at a time, a Hello with a fresh token on each, every decoded frame as an
// event, and a reconnect with backoff when the socket drops. `events` is a
// plain Stream, so a Foldkit Subscription can map it to Messages, and
// `send` an Effect a Command can run. What the frames mean is Session.ts.

export const RoomEvent = Schema.TaggedUnion({
  Connecting: { attempt: Schema.Finite },
  Received: { frame: ServerFrame, bytes: Schema.Finite, atMs: Schema.Finite },
  Dropped: { reason: Schema.String },
  Stopped: { reason: Schema.String },
  // NOTE: the socket's free ping came back: sent at `sentMs`, back at `atMs`.
  Ponged: { sentMs: Schema.Finite, atMs: Schema.Finite },
})
export type RoomEvent = typeof RoomEvent.Type

export interface RoomClientOptions {
  readonly url: string
  readonly token: Effect.Effect<string, TokenUnavailable>
  readonly maxBackoffMs?: number | undefined
}

export interface RoomClient {
  readonly events: Stream.Stream<RoomEvent>
  // NOTE: the bytes written, or none when no socket is open.
  readonly send: (frame: ClientFrame) => Effect.Effect<Option.Option<number>>
  // NOTE: says Leave, which frees the seat, and stops reconnecting.
  readonly leave: Effect.Effect<void>
  // NOTE: drops the socket and connects again at once, for a Session that
  // could not apply a message and needs the Snapshot a new link brings.
  readonly resync: Effect.Effect<void>
}

// NOTE: the sync engine's ping, which the Durable Object answers by
// auto-response without waking, keeps the socket alive and measures the
// round trip, for free: an auto-response is never billed. It goes every
// 2 seconds, in the lobby and in the run alike.
const HEARTBEAT = '2 seconds'
// NOTE: the room sends 20 times a second in a run, and the ping is
// answered every 2 seconds even in the lobby, so this long with nothing at
// all is a dead link (a half-open TCP connection never closes by itself):
// the socket is dropped and a new one connects.
const SILENT_MS = 6000
const WATCH_EVERY = '1 second'
const DEFAULT_MAX_BACKOFF_MS = 5000

// NOTE: refusals that another try would only repeat. An Unauthorized one
// is retried, since the next try brings a fresh token.
const isFinal = (frame: ServerFrame): boolean =>
  frame._tag === 'Kicked' ||
  (frame._tag === 'Refused' && frame.reason !== 'Unauthorized')

const reasonOf = (frame: ServerFrame): string =>
  frame._tag === 'Refused' ? `Refused: ${frame.reason}` : frame._tag

export const connectRoom = (
  options: RoomClientOptions,
): Effect.Effect<RoomClient, never, Scope.Scope> =>
  Effect.gen(function* () {
    const events = yield* Queue.unbounded<RoomEvent>()
    const current = yield* Ref.make<Option.Option<OpenSocket>>(Option.none())
    const stopped = yield* Ref.make<Option.Option<string>>(Option.none())
    const heardAny = yield* Ref.make(false)
    const pinged = yield* Ref.make<Option.Option<number>>(Option.none())
    const heardMs = yield* Ref.make(0)

    const offer = (event: RoomEvent) => Queue.offer(events, event)

    const onData = (data: string | Uint8Array) =>
      Effect.gen(function* () {
        const currentTimeMillis_1 = yield* Clock.currentTimeMillis
        yield* Ref.set(heardMs, currentTimeMillis_1)
        if (typeof data === 'string') {
          if (data !== PONG_JSON) {
            return
          }
          const atMs = yield* Clock.currentTimeMillis
          const maybeSent = yield* Ref.getAndSet(pinged, Option.none())
          return yield* Option.match(maybeSent, {
            onNone: () => Effect.void,
            onSome: sentMs =>
              offer(RoomEvent.cases.Ponged.make({ sentMs, atMs })),
          })
        }
        const decoded = decodeServerFrame(data)
        if (Result.isFailure(decoded)) {
          return yield* Effect.logWarning(
            'A room frame did not decode',
            decoded.failure.reason,
          )
        }
        const frame = decoded.success
        const atMs = yield* Clock.currentTimeMillis
        yield* Ref.set(heardAny, true)
        yield* offer(
          RoomEvent.cases.Received.make({ frame, bytes: data.length, atMs }),
        )
        if (isFinal(frame)) {
          yield* Ref.set(stopped, Option.some(reasonOf(frame)))
        }
      })

    const hello = (token: string) =>
      Effect.mapError(
        Effect.fromResult(
          encodeClientFrame({
            _tag: 'Hello',
            minVersion: MIN_PROTOCOL_VERSION,
            maxVersion: PROTOCOL_VERSION,
            token,
          }),
        ),
        error => SocketError.make({ reason: error.reason }),
      )

    const connection = (attempt: number) =>
      Effect.scoped(
        Effect.gen(function* () {
          yield* offer(RoomEvent.cases.Connecting.make({ attempt }))
          const token = yield* Effect.mapError(options.token, error =>
            SocketError.make({ reason: `No token: ${error.reason}` }),
          )
          const socket = yield* openSocket(options.url)
          const value_1 = yield* hello(token)
          yield* socket.send(value_1)
          yield* Ref.set(current, Option.some(socket))
          const currentTimeMillis_2 = yield* Clock.currentTimeMillis
          yield* Ref.set(heardMs, currentTimeMillis_2)
          yield* Effect.forkScoped(
            Effect.repeat(
              Effect.delay(
                Effect.gen(function* () {
                  const nowMs = yield* Clock.currentTimeMillis
                  if (nowMs - (yield* Ref.get(heardMs)) >= SILENT_MS) {
                    yield* socket.drop('Silent')
                  }
                }),
                WATCH_EVERY,
              ),
              Schedule.forever,
            ),
          )
          yield* Effect.forkScoped(
            Effect.repeat(
              Effect.delay(
                Effect.andThen(
                  Effect.flatMap(Clock.currentTimeMillis, sentMs =>
                    Ref.set(pinged, Option.some(sentMs)),
                  ),
                  Effect.ignore(socket.send(PING_JSON)),
                ),
                HEARTBEAT,
              ),
              Schedule.forever,
            ),
          )
          yield* pipe(
            socket.messages,
            Stream.takeUntilEffect(() =>
              Effect.map(Ref.get(stopped), Option.isSome),
            ),
            Stream.runForEach(onData),
            Effect.ensuring(Ref.set(current, Option.none())),
          )
        }),
      )

    const connectOnce = (attempt: number): Effect.Effect<Ended> =>
      Effect.gen(function* () {
        yield* Ref.set(heardAny, false)
        const exit = yield* Effect.exit(connection(attempt))
        const maybeStop = yield* Ref.get(stopped)
        if (Option.isSome(maybeStop)) {
          yield* offer(
            RoomEvent.cases.Stopped.make({ reason: maybeStop.value }),
          )
          return 'Stopped'
        }
        yield* offer(
          RoomEvent.cases.Dropped.make({
            reason:
              exit._tag === 'Failure' ? String(exit.cause) : 'Socket ended',
          }),
        )
        return (yield* Ref.get(heardAny)) ? 'Heard' : 'Unheard'
      })

    yield* Effect.forkScoped(
      reconnecting(
        connectOnce,
        backoffUpTo(options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS),
      ),
    )

    const send = (frame: ClientFrame) =>
      Effect.gen(function* () {
        const maybeSocket = yield* Ref.get(current)
        if (Option.isNone(maybeSocket)) {
          return Option.none<number>()
        }
        const encoded = encodeClientFrame(frame)
        if (Result.isFailure(encoded)) {
          yield* Effect.logWarning(
            'A frame did not encode',
            encoded.failure.reason,
          )
          return Option.none<number>()
        }
        return yield* pipe(
          maybeSocket.value.send(encoded.success),
          Effect.as(Option.some(encoded.success.length)),
          Effect.catchTag('SocketError', () =>
            Effect.succeed(Option.none<number>()),
          ),
        )
      })

    const leave = Effect.gen(function* () {
      yield* send({ _tag: 'Leave' })
      yield* Ref.set(stopped, Option.some('Left'))
    })

    const resync = Effect.flatMap(Ref.get(current), maybeSocket =>
      Option.match(maybeSocket, {
        onNone: () => Effect.void,
        onSome: socket => socket.drop('Resync'),
      }),
    )

    return { events: Stream.fromQueue(events), send, leave, resync }
  })
