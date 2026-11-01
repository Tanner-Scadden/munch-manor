import {
  type Cause,
  Data,
  Effect,
  Option,
  Queue,
  Ref,
  Schedule,
  Schema,
  type Scope,
  Stream,
  pipe,
} from 'effect'
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from 'effect/http'

import {
  type IdentityError,
  type IdentityRefused,
  type Mutation,
  PING_JSON,
  PROTOCOL_VERSION as SYNC_PROTOCOL_VERSION,
  ServerMessage,
  type SessionResponse,
  type StoredKey,
  decodeServerMessage,
  encodeArgs,
  encodeClientMessage,
  importKey,
  makeMutationId,
  mutationVersions,
  sessionMessage,
} from '@munch/sync-engine'
import { httpIdentityApi } from '@munch/sync-engine/browser'

import {
  CreateRequest,
  DEFAULT_CALLING,
  JoinRequest,
  Lobby,
  MAX_LOOK_INPUT,
  MAX_NAME_INPUT,
  ROOM_PATHS,
  RoomRefusal,
  RoomScope,
  RoomTicket,
  cleanCalling,
  cleanRank,
  lobbyOfSnapshot,
  roomScopeId,
} from './Lobby'
import * as Matchmaking from './Matchmaking'
import { type Ended, backoffUpTo, reconnecting } from './Reconnect'
import { SocketError, type TokenUnavailable, openSocket } from './Socket'

// NOTE: the lobby from a client with no local database: the dev page, and
// tests. It follows the `room:<code>` scope over the sync engine's own
// protocol, asking for a Snapshot on join and again whenever Deltas say it
// changed (a lobby is a few rows and changes a few times a minute), and
// pushes mutations as envelopes. The game, which keeps SQLite already, can
// follow the same scope with a Replica instead.

export class RoomRequestFailed extends Data.TaggedError('RoomRequestFailed')<{
  readonly refusal: RoomRefusal
}> {}

export class LobbyOffline extends Data.TaggedError('LobbyOffline')<{
  readonly reason: string
}> {}

// IDENTITY

// NOTE: the device key sign-in of the sync engine (Device.ts), for a page
// that keeps its key somewhere other than SQLite.
export const signInDevice = (
  origin: string,
  key: StoredKey,
  playerId: string,
): Effect.Effect<SessionResponse, IdentityError | IdentityRefused> =>
  Effect.gen(function* () {
    const api = httpIdentityApi(origin)
    const deviceKey = yield* importKey(key)
    const { nonce } = yield* api.challenge
    const signature = yield* deviceKey.sign(sessionMessage(nonce, playerId))
    return yield* api.session({
      publicKey: key.publicKey,
      playerId,
      nonce,
      signature,
    })
  })

// ROOMS

const unavailable = () =>
  new RoomRequestFailed({ refusal: RoomRefusal.cases.Unavailable.make({}) })

const roomCall = <A, I>(
  url: string,
  token: string,
  schema: Schema.Codec<A, I>,
  body: A,
) =>
  pipe(
    HttpClientRequest.post(url),
    HttpClientRequest.bearerToken(token),
    HttpClientRequest.schemaBodyJson(schema)(body),
    Effect.flatMap(request => HttpClient.execute(request)),
    Effect.mapError(unavailable),
    Effect.flatMap(response =>
      response.status >= 200 && response.status < 300
        ? Effect.mapError(
            HttpClientResponse.schemaBodyJson(RoomTicket)(response),
            unavailable,
          )
        : pipe(
            HttpClientResponse.schemaBodyJson(RoomRefusal)(response),
            Effect.mapError(unavailable),
            Effect.flatMap(refusal =>
              Effect.fail(new RoomRequestFailed({ refusal })),
            ),
          ),
    ),
    Effect.provideService(HttpClient.TracerPropagationEnabled, false),
    Effect.provide(FetchHttpClient.layer),
  )

export const createRoom = (
  origin: string,
  token: string,
  name: string,
  look = '',
  rank = 1,
  calling = DEFAULT_CALLING,
): Effect.Effect<RoomTicket, RoomRequestFailed> =>
  roomCall(
    new URL(ROOM_PATHS.create, origin).toString(),
    token,
    CreateRequest,
    CreateRequest.make({
      name: name.slice(0, MAX_NAME_INPUT),
      look: look.slice(0, MAX_LOOK_INPUT),
      rank: cleanRank(rank),
      calling: cleanCalling(calling),
    }),
  )

export const joinRoom = (
  origin: string,
  token: string,
  code: string,
  name: string,
  look = '',
  rank = 1,
  calling = DEFAULT_CALLING,
): Effect.Effect<RoomTicket, RoomRequestFailed> =>
  roomCall(
    new URL(ROOM_PATHS.join, origin).toString(),
    token,
    JoinRequest,
    JoinRequest.make({
      code,
      name: name.slice(0, MAX_NAME_INPUT),
      look: look.slice(0, MAX_LOOK_INPUT),
      rank: cleanRank(rank),
      calling: cleanCalling(calling),
    }),
  )

export const roomSocketUrl = (origin: string, code: string): string => {
  const url = new URL(ROOM_PATHS.socket, origin)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.searchParams.set('code', code)
  return url.toString()
}

const scopeSocketUrl = (origin: string, scope: string): string => {
  const url = new URL('/sync/socket', origin)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.searchParams.set('scope', scope)
  return url.toString()
}

// LOBBY

export const LobbyEvent = Schema.TaggedUnion({
  Connecting: { attempt: Schema.Number },
  Updated: { lobby: Lobby },
  Acked: { id: Schema.String },
  Rejected: { id: Schema.String, reason: Schema.String },
  Dropped: { reason: Schema.String },
  Stopped: { reason: Schema.String },
})
export type LobbyEvent = typeof LobbyEvent.Type

export interface LobbyClientOptions {
  readonly origin: string
  readonly code: string
  readonly clientId: string
  readonly token: Effect.Effect<string, TokenUnavailable>
}

export interface LobbyClient {
  readonly events: Stream.Stream<LobbyEvent>
  readonly write: <A, I>(
    mutation: Mutation<string, A, I>,
    args: NoInfer<A>,
  ) => Effect.Effect<string, LobbyOffline>
}

const HEARTBEAT = '25 seconds'
const MAX_BACKOFF_MS = 5000

export const followLobby = (
  options: LobbyClientOptions,
): Effect.Effect<LobbyClient, never, Scope.Scope> =>
  Effect.gen(function* () {
    const scope = roomScopeId(options.code)
    const events = yield* Queue.unbounded<LobbyEvent>()
    const sendRef = yield* Ref.make<
      Option.Option<(text: string) => Effect.Effect<void, SocketError>>
    >(Option.none())
    const stopped = yield* Ref.make<Option.Option<string>>(Option.none())
    const heardAny = yield* Ref.make(false)

    const offer = (event: LobbyEvent) => Queue.offer(events, event)

    const helloText = (token: string) =>
      Effect.mapError(
        encodeClientMessage({
          _tag: 'Hello',
          protocol: SYNC_PROTOCOL_VERSION,
          scope,
          lastSeq: 0,
          mode: 'Snapshot',
          clientId: options.clientId,
          token,
          versions: mutationVersions(RoomScope),
        }),
        error => new SocketError({ reason: error.message }),
      )

    const onMessage = (
      message: ServerMessage,
      again: Effect.Effect<void, SocketError>,
    ) =>
      ServerMessage.match(message, {
        Snapshot: snapshot =>
          Option.match(lobbyOfSnapshot(snapshot.tables), {
            onNone: () => Effect.void,
            onSome: lobby => offer(LobbyEvent.cases.Updated.make({ lobby })),
          }),
        Deltas: () => again,
        Acked: acked => offer(LobbyEvent.cases.Acked.make({ id: acked.id })),
        Rejected: rejected =>
          offer(
            LobbyEvent.cases.Rejected.make({
              id: rejected.id,
              reason: rejected.reason,
            }),
          ),
        Failed: failed =>
          failed.code === 'Unauthorized' || failed.code === 'Unavailable'
            ? Effect.void
            : Ref.set(stopped, Option.some(`${failed.code}: ${failed.reason}`)),
        Pong: () => Effect.void,
      })

    const connection = (attempt: number) =>
      Effect.scoped(
        Effect.gen(function* () {
          yield* offer(LobbyEvent.cases.Connecting.make({ attempt }))
          const token = yield* Effect.mapError(
            options.token,
            error => new SocketError({ reason: `No token: ${error.reason}` }),
          )
          const socket = yield* openSocket(
            scopeSocketUrl(options.origin, scope),
          )
          const sendText = (text: string) => socket.send(text)
          const again = Effect.flatMap(helloText(token), sendText)
          yield* again
          yield* Ref.set(sendRef, Option.some(sendText))
          yield* Effect.forkScoped(
            Effect.repeat(
              Effect.delay(Effect.ignore(sendText(PING_JSON)), HEARTBEAT),
              Schedule.forever,
            ),
          )
          yield* pipe(
            socket.messages,
            Stream.takeUntilEffect(() =>
              Effect.map(Ref.get(stopped), Option.isSome),
            ),
            Stream.runForEach(data =>
              typeof data === 'string'
                ? Effect.andThen(
                    Ref.set(heardAny, true),
                    Effect.matchEffect(decodeServerMessage(data), {
                      onFailure: () => Effect.void,
                      onSuccess: message => onMessage(message, again),
                    }),
                  )
                : Effect.void,
            ),
            Effect.ensuring(Ref.set(sendRef, Option.none())),
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
            LobbyEvent.cases.Stopped.make({ reason: maybeStop.value }),
          )
          return 'Stopped'
        }
        yield* offer(
          LobbyEvent.cases.Dropped.make({
            reason:
              exit._tag === 'Failure' ? String(exit.cause) : 'Socket ended',
          }),
        )
        return (yield* Ref.get(heardAny)) ? 'Heard' : 'Unheard'
      })

    yield* Effect.forkScoped(
      reconnecting(connectOnce, backoffUpTo(MAX_BACKOFF_MS)),
    )

    const write = <A, I>(mutation: Mutation<string, A, I>, args: NoInfer<A>) =>
      Effect.gen(function* () {
        const maybeSend = yield* Ref.get(sendRef)
        if (Option.isNone(maybeSend)) {
          return yield* new LobbyOffline({ reason: 'Not connected' })
        }
        const id = yield* makeMutationId
        const encodedArgs = yield* Effect.mapError(
          encodeArgs(mutation, args),
          error => new LobbyOffline({ reason: error.message }),
        )
        const text = yield* Effect.mapError(
          encodeClientMessage({
            _tag: 'Push',
            mutations: [
              {
                id,
                name: mutation.name,
                version: mutation.version,
                args: encodedArgs,
              },
            ],
          }),
          error => new LobbyOffline({ reason: error.message }),
        )
        yield* Effect.mapError(
          maybeSend.value(text),
          error => new LobbyOffline({ reason: error.reason }),
        )
        return id
      })

    return { events: Stream.fromQueue(events), write }
  })

// QUICK PLAY

export const QuickPlayEvent = Schema.TaggedUnion({
  Connecting: {},
  Heard: { message: Matchmaking.QuickServer },
  Dropped: { reason: Schema.String },
})
export type QuickPlayEvent = typeof QuickPlayEvent.Type

export interface QuickPlayOptions {
  readonly origin: string
  readonly name: string
  readonly look?: string
  readonly rank?: number
  readonly calling?: string
  readonly token: Effect.Effect<string, TokenUnavailable>
}

export interface QuickPlay {
  readonly events: Stream.Stream<QuickPlayEvent>
  readonly answer: (accept: boolean) => Effect.Effect<void>
  readonly cancel: Effect.Effect<void>
}

const encodeQuick = Schema.encodeSync(Matchmaking.QuickClientJson)
const decodeQuick = Schema.decodeUnknownOption(Matchmaking.QuickServerJson)

const quickSocketUrl = (origin: string): string => {
  const url = new URL(ROOM_PATHS.quick, origin)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}

// NOTE: one press of QUICK PLAY: a socket to the Matchmaker that says Hello
// and reports each Waiting (the queue screen, and any offer to start with
// fewer) until Matched or Refused, after which the socket ends. It does
// not reconnect: a dropped socket leaves the queue, and the player presses
// again. Closing the Scope, or `cancel`, leaves the queue.
export const startQuickPlay = (
  options: QuickPlayOptions,
): Effect.Effect<QuickPlay, never, Scope.Scope> =>
  Effect.gen(function* () {
    const events = yield* Queue.unbounded<QuickPlayEvent, Cause.Done>()
    const sendRef = yield* Ref.make<
      Option.Option<(text: string) => Effect.Effect<void, SocketError>>
    >(Option.none())
    const session = Effect.gen(function* () {
      yield* Queue.offer(events, QuickPlayEvent.cases.Connecting.make({}))
      const token = yield* Effect.mapError(
        options.token,
        error => new SocketError({ reason: `No token: ${error.reason}` }),
      )
      const socket = yield* openSocket(quickSocketUrl(options.origin))
      const sendText = (text: string) => socket.send(text)
      yield* Ref.set(sendRef, Option.some(sendText))
      yield* sendText(
        encodeQuick({
          _tag: 'Hello',
          token,
          name: options.name.slice(0, MAX_NAME_INPUT),
          look: (options.look ?? '').slice(0, MAX_LOOK_INPUT),
          rank: cleanRank(options.rank ?? 1),
          calling: cleanCalling(options.calling ?? DEFAULT_CALLING),
        }),
      )
      yield* Stream.runForEach(socket.messages, data =>
        typeof data === 'string'
          ? Option.match(decodeQuick(data), {
              onNone: () => Effect.void,
              onSome: message =>
                Queue.offer(
                  events,
                  QuickPlayEvent.cases.Heard.make({ message }),
                ),
            })
          : Effect.void,
      )
    }).pipe(
      Effect.scoped,
      Effect.catchTag('SocketError', error =>
        Queue.offer(
          events,
          QuickPlayEvent.cases.Dropped.make({ reason: error.reason }),
        ),
      ),
      Effect.andThen(Queue.end(events)),
    )
    yield* Effect.forkScoped(session)
    const say = (message: Matchmaking.QuickClient) =>
      Effect.flatMap(Ref.get(sendRef), maybeSend =>
        Option.match(maybeSend, {
          onNone: () => Effect.void,
          onSome: sendText => Effect.ignore(sendText(encodeQuick(message))),
        }),
      )
    return {
      events: Stream.fromQueue(events),
      answer: accept => say({ _tag: 'Answer', accept }),
      cancel: say({ _tag: 'Cancel' }),
    }
  })
