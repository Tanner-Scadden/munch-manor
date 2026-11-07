import {
  Array,
  type Cause,
  Effect,
  Layer,
  Option,
  Queue,
  Ref,
  Schema,
  type Scope,
  Semaphore,
  Stream,
  pipe,
} from 'effect'
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from 'effect/http'

import type { IdentityApi } from './Device'
import {
  ChallengeResponse,
  IDENTITY_PATHS,
  IdentityFailure,
  IdentityRefused,
  LinkCodeResponse,
  RedeemRequest,
  SessionRequest,
  SessionResponse,
} from './Identity'
import {
  ClientMessage,
  ExchangeReply,
  type HelloMessage,
  ServerMessage,
  decodeServerMessage,
  encodeClientMessage,
  encodeExchange,
} from './Protocol'
import { type Channel, type Transport, TransportError } from './Sync'

// NOTE: the browser's transports and identity client. Only a resource or a
// Command in the app should call these: they open sockets and fetch.

const OPEN_TIMEOUT = '10 seconds'
const HTTP_SESSION = '5 minutes'

const socketUrl = (origin: string, scope: string): string => {
  const url = new URL(IDENTITY_PATHS.socket, origin)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.searchParams.set('scope', scope)
  return url.toString()
}

const exchangeUrl = (origin: string, scope: string): string => {
  const url = new URL(IDENTITY_PATHS.exchange, origin)
  url.searchParams.set('scope', scope)
  return url.toString()
}

// NOTE: every request goes through Effect's fetch client, built for the
// request and closed after it. Trace headers stay off: the Worker's CORS
// rules allow only content-type and authorization, so a traceparent header
// would fail the preflight.
/** @stability unstable */
export const withFetch = <A, E>(
  effect: Effect.Effect<A, E, HttpClient.HttpClient>,
): Effect.Effect<A, E> =>
  Effect.scoped(
    Effect.flatMap(Layer.build(FetchHttpClient.layer), client =>
      pipe(
        effect,
        Effect.provideService(HttpClient.TracerPropagationEnabled, false),
        Effect.provide(client),
      ),
    ),
  )

const jsonPost = (url: string, body: string, token?: string) =>
  pipe(
    HttpClientRequest.post(url),
    HttpClientRequest.bodyText(body, 'application/json'),
    request =>
      token === undefined
        ? request
        : HttpClientRequest.bearerToken(request, token),
  )

const closeQuietly = (socket: WebSocket) =>
  Effect.sync(() => {
    if (
      socket.readyState === WebSocket.CONNECTING ||
      socket.readyState === WebSocket.OPEN
    ) {
      socket.close(1000, 'Done')
    }
  })

// WEBSOCKET

// NOTE: a WebSocket to the scope's Durable Object. The browser going
// offline closes it at once instead of waiting for the heartbeat to notice.
export const webSocketTransport = (origin: string): Transport => ({
  name: 'WebSocket',
  open: (scope: string): Effect.Effect<Channel, TransportError, Scope.Scope> =>
    Effect.gen(function* () {
      const inbox = yield* Queue.unbounded<
        ServerMessage,
        TransportError | Cause.Done
      >()
      const socket = yield* Effect.acquireRelease(
        Effect.try({
          try: () => new WebSocket(socketUrl(origin, scope)),
          catch: error => TransportError.make({ reason: String(error) }),
        }),
        closeQuietly,
      )
      const value_1 = yield* Effect.context()
      const runFork = Effect.runForkWith(value_1)
      const fail = (reason: string) =>
        runFork(Queue.fail(inbox, TransportError.make({ reason })))
      socket.addEventListener('message', event => {
        if (typeof event.data === 'string') {
          runFork(
            Effect.matchEffect(decodeServerMessage(event.data), {
              onFailure: () => Effect.void,
              onSuccess: message => Queue.offer(inbox, message),
            }),
          )
        }
      })
      socket.addEventListener('close', event => {
        fail(`Socket closed (${event.code})`)
      })
      const goOffline = () => {
        fail('The browser went offline')
        socket.close(1000, 'Offline')
      }
      yield* Effect.acquireRelease(
        Effect.sync(() => window.addEventListener('offline', goOffline)),
        () =>
          Effect.sync(() => window.removeEventListener('offline', goOffline)),
      )
      yield* pipe(
        Effect.callback<void, TransportError>(resume => {
          const opened = () => resume(Effect.void)
          const failed = () =>
            resume(
              Effect.fail(
                TransportError.make({ reason: 'Socket failed to open' }),
              ),
            )
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
            Effect.fail(
              TransportError.make({ reason: 'Socket open timed out' }),
            ),
        }),
      )
      const send = (message: ClientMessage) =>
        Effect.flatMap(
          Effect.mapError(encodeClientMessage(message), error =>
            TransportError.make({ reason: error.message }),
          ),
          json =>
            Effect.try({
              try: () => socket.send(json),
              catch: error => TransportError.make({ reason: String(error) }),
            }),
        )
      return { send, messages: Stream.fromQueue(inbox) }
    }),
})

// HTTP

// NOTE: the fallback when sockets keep failing. Each exchange posts the
// Hello, with the newest seq this channel has seen, plus whatever was sent
// since the last one, and feeds the replies back as if they came over a
// socket. A heartbeat Ping becomes a pull. The channel ends after
// HTTP_SESSION, so the sync loop tries the WebSocket again.
export const httpTransport = (origin: string): Transport => ({
  name: 'Http',
  open: (scope: string): Effect.Effect<Channel, TransportError, Scope.Scope> =>
    Effect.gen(function* () {
      const inbox = yield* Queue.unbounded<
        ServerMessage,
        TransportError | Cause.Done
      >()
      const hello = yield* Ref.make<Option.Option<HelloMessage>>(Option.none())
      const lock = yield* Semaphore.make(1)

      const seen = (reply: ReadonlyArray<ServerMessage>) =>
        Ref.update(hello, maybeHello =>
          Option.map(maybeHello, current => {
            const newest = Array.reduce(
              reply,
              current.lastSeq,
              (seq, message) =>
                ServerMessage.matchOrElse(
                  message,
                  {
                    Snapshot: snapshot => Math.max(seq, snapshot.seq),
                    Deltas: ({ deltas }) =>
                      Math.max(seq, ...Array.map(deltas, delta => delta.seq)),
                  },
                  () => seq,
                ),
            )
            return { ...current, lastSeq: newest, mode: 'Catchup' as const }
          }),
        )

      const exchange = (extra: ReadonlyArray<ClientMessage>) =>
        lock
          .withPermit(
            Effect.gen(function* () {
              const maybeHello = yield* Ref.get(hello)
              if (Option.isNone(maybeHello)) {
                return
              }
              const body = yield* Effect.mapError(
                encodeExchange([maybeHello.value, ...extra]),
                error => TransportError.make({ reason: error.message }),
              )
              const reply = yield* pipe(
                HttpClient.execute(jsonPost(exchangeUrl(origin, scope), body)),
                Effect.flatMap(HttpClientResponse.filterStatusOk),
                Effect.flatMap(
                  HttpClientResponse.schemaBodyJson(ExchangeReply),
                ),
                withFetch,
                Effect.mapError(error =>
                  TransportError.make({
                    reason:
                      error._tag === 'HttpClientError' &&
                      error.reason._tag === 'StatusCodeError'
                        ? `HTTP ${error.reason.response.status}`
                        : error.message,
                  }),
                ),
              )
              yield* seen(reply)
              yield* Queue.offerAll(inbox, reply)
            }),
          )
          .pipe(Effect.tapError(error => Queue.fail(inbox, error)))

      const send = (message: ClientMessage) =>
        ClientMessage.match(message, {
          Hello: helloMessage =>
            Effect.andThen(
              Ref.set(hello, Option.some(helloMessage)),
              exchange([]),
            ),
          Ping: () => exchange([]),
          Push: push => exchange([push]),
        })

      yield* pipe(
        Effect.sleep(HTTP_SESSION),
        Effect.andThen(Queue.end(inbox)),
        Effect.forkScoped,
      )
      return { send, messages: Stream.fromQueue(inbox) }
    }),
})

// IDENTITY

const unavailable = (): IdentityRefused =>
  IdentityRefused.make({
    failure: IdentityFailure.cases.Unavailable.make({}),
  })

// NOTE: a refusal carries an IdentityFailure as its body. A body that does
// not decode, like a proxy's error page, reads as Unavailable.
const refusedFrom = (response: HttpClientResponse.HttpClientResponse) =>
  pipe(
    HttpClientResponse.schemaBodyJson(IdentityFailure)(response),
    Effect.orElseSucceed(() => IdentityFailure.cases.Unavailable.make({})),
    Effect.flatMap(failure => Effect.fail(IdentityRefused.make({ failure }))),
  )

const call = <A, I, E>(
  schema: Schema.Codec<A, I>,
  request: Effect.Effect<HttpClientRequest.HttpClientRequest, E>,
): Effect.Effect<A, IdentityRefused> =>
  pipe(
    request,
    Effect.flatMap(HttpClient.execute),
    Effect.mapError(unavailable),
    Effect.flatMap(response =>
      response.status >= 200 && response.status < 300
        ? Effect.mapError(
            HttpClientResponse.schemaBodyJson(schema)(response),
            unavailable,
          )
        : refusedFrom(response),
    ),
    withFetch,
  )

// NOTE: an identity request, its body through its Schema.
const post = <A, I>(
  url: string,
  schema: Schema.Codec<A, I>,
  body: A,
  token?: string,
) =>
  pipe(
    HttpClientRequest.post(url),
    request =>
      token === undefined
        ? request
        : HttpClientRequest.bearerToken(request, token),
    HttpClientRequest.schemaBodyJson(schema)(body),
  )

const NoBody = Schema.Struct({})

export const httpIdentityApi = (origin: string): IdentityApi => ({
  challenge: call(
    ChallengeResponse,
    post(new URL(IDENTITY_PATHS.challenge, origin).toString(), NoBody, {}),
  ),
  session: request =>
    call(
      SessionResponse,
      post(
        new URL(IDENTITY_PATHS.session, origin).toString(),
        SessionRequest,
        request,
      ),
    ),
  link: token =>
    call(
      LinkCodeResponse,
      post(new URL(IDENTITY_PATHS.link, origin).toString(), NoBody, {}, token),
    ),
  redeem: (token, code) =>
    call(
      SessionResponse,
      post(
        new URL(IDENTITY_PATHS.redeem, origin).toString(),
        RedeemRequest,
        { code },
        token,
      ),
    ),
})
