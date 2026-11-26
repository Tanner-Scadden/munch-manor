import { Cause, Effect, Queue, Schema, type Scope, Stream, pipe } from 'effect'

export class SocketError extends Schema.TaggedError<
  SocketError,
  { readonly brand: unique symbol }
>()('SocketError', {
  reason: Schema.String,
}) {}

export class TokenUnavailable extends Schema.TaggedError<
  TokenUnavailable,
  { readonly brand: unique symbol }
>()('TokenUnavailable', {
  reason: Schema.String,
}) {}

const isSocketError = Schema.is(SocketError)

export type SocketData = string | Uint8Array

export interface OpenSocket {
  readonly send: (data: SocketData) => Effect.Effect<void, SocketError>
  readonly messages: Stream.Stream<SocketData, SocketError>
  readonly drop: (reason: string) => Effect.Effect<void>
}

const OPEN_TIMEOUT = '10 seconds'

const closeQuietly = (socket: WebSocket) =>
  Effect.sync(() => {
    if (
      socket.readyState === WebSocket.CONNECTING ||
      socket.readyState === WebSocket.OPEN
    ) {
      socket.close(1000, 'Done')
    }
  })

const dataOf = (data: unknown): SocketData | undefined =>
  typeof data === 'string'
    ? data
    : data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : undefined

export const openSocket = (
  url: string,
): Effect.Effect<OpenSocket, SocketError, Scope.Scope> =>
  Effect.gen(function* () {
    const inbox = yield* Queue.unbounded<SocketData, SocketError | Cause.Done>()
    const socket = yield* Effect.acquireRelease(
      Effect.try({
        try: () => {
          const opened = new WebSocket(url)
          opened.binaryType = 'arraybuffer'
          return opened
        },
        catch: error => SocketError.make({ reason: String(error) }),
      }),
      closeQuietly,
    )
    socket.addEventListener('message', event => {
      const data = dataOf(event.data)
      if (data !== undefined) {
        Queue.offerUnsafe(inbox, data)
      }
    })
    socket.addEventListener('close', event => {
      Queue.failCauseUnsafe(
        inbox,
        Cause.fail(
          SocketError.make({
            reason: `Closed (${event.code} ${event.reason})`,
          }),
        ),
      )
    })
    yield* pipe(
      Effect.callback<void, SocketError>(resume => {
        const opened = () => resume(Effect.void)
        const failed = () =>
          resume(Effect.fail(SocketError.make({ reason: 'Failed to open' })))
        socket.addEventListener('open', opened, { once: true })
        socket.addEventListener('error', failed, { once: true })
        return Effect.sync(() => {
          socket.removeEventListener('open', opened)
          socket.removeEventListener('error', failed)
        })
      }),
      Effect.timeoutOrElse({
        duration: OPEN_TIMEOUT,
        orElse: () =>
          Effect.fail(SocketError.make({ reason: 'Open timed out' })),
      }),
    )
    const send = (data: SocketData) =>
      Effect.try({
        try: () => {
          if (socket.readyState !== WebSocket.OPEN) {
            throw SocketError.make({ reason: 'Not open' })
          }
          socket.send(typeof data === 'string' ? data : data.slice().buffer)
        },
        catch: error =>
          isSocketError(error)
            ? error
            : SocketError.make({ reason: String(error) }),
      })
    const drop = (reason: string) =>
      Effect.andThen(
        Queue.fail(inbox, SocketError.make({ reason })),
        closeQuietly(socket),
      )
    return { send, messages: Stream.fromQueue(inbox), drop }
  })
