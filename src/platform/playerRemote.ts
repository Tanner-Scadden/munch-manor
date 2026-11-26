import {
  type Array,
  Clock,
  Effect,
  Exit,
  Function,
  Layer,
  Option,
  Ref,
  Schedule,
  Schema,
  Scope,
  type Stream,
  SubscriptionRef,
  pipe,
} from 'effect'
import { EventLog, EventLogRemote } from 'effect/eventlog'
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from 'effect/http'
import { RpcClient, type RpcClientError, RpcSerialization } from 'effect/rpc'
import { Socket } from 'effect/socket'

import { TokenUnavailable } from '@munch/netcode/browser'

import {
  LINK_REDEEM_PATH,
  PLAYER_LOG_PATH,
  PlayerLogRpcs,
  RedeemAnswer,
  RedeemRequest,
  type SessionProblem,
  SessionRefused,
  type SessionToken,
  playerStoreOf,
} from '../shared/sessionApi'
import { LinkProblem, SyncState } from './playerSync'
import {
  type RoomSession,
  type Transport,
  browserTransports,
} from './roomReplica'

type PlayerRemoteClient = RpcClient.FromGroup<
  typeof PlayerLogRpcs,
  RpcClientError.RpcClientError
>

export class LinkRefused extends Schema.TaggedError<
  LinkRefused,
  { readonly brand: unique symbol }
>()('LinkRefused', {
  problem: LinkProblem,
}) {}

export interface SyncSetup {
  readonly connect: (
    storeId: string,
    hooks: RpcClient.ConnectionHooks['Service'],
  ) => Effect.Effect<PlayerRemoteClient, never, Scope.Scope>
  readonly redeem: (code: string) => Effect.Effect<RedeemAnswer, LinkRefused>
  readonly transports: Array.NonEmptyReadonlyArray<Transport>
}

export interface PlayerRemote {
  readonly state: Stream.Stream<SyncState>
  readonly session: RoomSession
  readonly createLinkCode: Effect.Effect<string, LinkRefused>
}

type Connected = Readonly<{
  client: PlayerRemoteClient
  remote: EventLogRemote.EventLogRemote['Service']
}>

const OFFLINE_AFTER = '10 seconds'

const TOKEN_MARGIN_MS = 60_000

const RECONNECT = Schedule.min([
  Schedule.exponential('1 second'),
  Schedule.spaced('30 seconds'),
])

const PROBLEM_OF: { readonly [Problem in SessionProblem]: LinkProblem } = {
  NotSignedIn: 'Unavailable',
  WrongCode: 'WrongCode',
  TooManyTries: 'TooManyTries',
  Unavailable: 'Unavailable',
}

const refusedFor = (problem: SessionProblem) =>
  LinkRefused.make({ problem: PROBLEM_OF[problem] })

const offline = () => LinkRefused.make({ problem: 'Offline' })

const isSessionRefused = Schema.is(SessionRefused)

const linkErrorOf = (error: unknown): LinkRefused =>
  isSessionRefused(error) ? refusedFor(error.problem) : offline()

class NotConnected extends Schema.TaggedError<
  NotConnected,
  { readonly brand: unique symbol }
>()('NotConnected', {}) {}

const connectIn = (
  setup: SyncSetup,
  storeId: string,
  hooks: RpcClient.ConnectionHooks['Service'],
  scope: Scope.Scope,
): Effect.Effect<
  Connected,
  EventLogRemote.EventLogRemoteError,
  EventLog.Registry
> =>
  Effect.gen(function* () {
    const attempt = yield* Scope.fork(scope)
    return yield* pipe(
      Effect.gen(function* () {
        const client = yield* setup.connect(storeId, hooks)
        const remote = yield* Effect.provideService(
          EventLogRemote.makeUnencrypted,
          EventLogRemote.EventLogRemoteClient,
          client,
        )
        return { client, remote }
      }),
      Scope.provide(attempt),
      Effect.onError(cause => Scope.close(attempt, Exit.failCause(cause))),
    )
  })

type RemoteOpened = Effect.Effect<
  PlayerRemote,
  never,
  Scope.Scope | EventLog.Registry
>

export const connectPlayerRemote: {
  (identity: EventLog.Identity['Service']): (setup: SyncSetup) => RemoteOpened
  (setup: SyncSetup, identity: EventLog.Identity['Service']): RemoteOpened
} = Function.dual(
  2,
  (setup: SyncSetup, identity: EventLog.Identity['Service']): RemoteOpened =>
    Effect.gen(function* () {
      const scope = yield* Effect.scope
      const storeId = playerStoreOf(identity.publicKey)
      const state = yield* SubscriptionRef.make<SyncState>(
        SyncState.Connecting(),
      )
      const connected = yield* Ref.make(Option.none<Connected>())
      const cached = yield* Ref.make(Option.none<SessionToken>())

      const hooks: RpcClient.ConnectionHooks['Service'] = {
        onConnect: SubscriptionRef.set(state, SyncState.Synced()),
        onDisconnect: SubscriptionRef.set(state, SyncState.Offline()),
      }

      yield* pipe(
        connectIn(setup, storeId, hooks, scope),
        Effect.tapError(error =>
          Effect.andThen(
            SubscriptionRef.set(state, SyncState.Offline()),
            Effect.logWarning('The player log could not connect', error.method),
          ),
        ),
        Effect.retry(RECONNECT),
        Effect.flatMap(next =>
          Effect.andThen(
            Ref.set(connected, Option.some(next)),
            SubscriptionRef.set(state, SyncState.Synced()),
          ),
        ),
        Effect.forkScoped,
      )

      yield* pipe(
        Effect.sleep(OFFLINE_AFTER),
        Effect.andThen(
          SubscriptionRef.update(state, current =>
            current._tag === 'Connecting' ? SyncState.Offline() : current,
          ),
        ),
        Effect.forkScoped,
      )

      const signedIn = <A, E>(
        call: (connection: Connected) => Effect.Effect<A, E>,
      ): Effect.Effect<
        A,
        E | EventLogRemote.EventLogRemoteError | NotConnected
      > =>
        Effect.flatMap(
          Effect.flatMap(Ref.get(connected), maybeConnected =>
            Effect.fromOption(maybeConnected),
          ),
          connection =>
            Effect.provideService(
              connection.remote.whenAuthenticated(call(connection)),
              EventLog.Identity,
              identity,
            ),
        ).pipe(
          Effect.catchTag('NoSuchElementError', () => NotConnected.make({})),
        )

      const mint = pipe(
        signedIn(connection => connection.client['Session.Mint']()),
        Effect.tap(token => Ref.set(cached, Option.some(token))),
        Effect.mapError(error => TokenUnavailable.make({ reason: error._tag })),
      )

      const token: Effect.Effect<string, TokenUnavailable> = Effect.gen(
        function* () {
          const nowMs = yield* Clock.currentTimeMillis
          const maybeCached = yield* Ref.get(cached)
          const maybeFresh = Option.filter(
            maybeCached,
            current => current.expiresMs - TOKEN_MARGIN_MS > nowMs,
          )
          return Option.isSome(maybeFresh)
            ? maybeFresh.value.token
            : (yield* mint).token
        },
      )

      return {
        state: SubscriptionRef.changes(state),
        session: {
          playerId: identity.publicKey,
          token,
          invalidate: Ref.set(cached, Option.none()),
        },
        createLinkCode: pipe(
          signedIn(connection =>
            connection.client['Session.CreateLinkCode']({
              identity: EventLog.encodeIdentityString(identity),
            }),
          ),
          Effect.mapBoth({
            onSuccess: answer => answer.code,
            onFailure: linkErrorOf,
          }),
        ),
      }
    }),
)

export const redeemWith: {
  (code: string): (setup: SyncSetup) => Effect.Effect<string, LinkRefused>
  (setup: SyncSetup, code: string): Effect.Effect<string, LinkRefused>
} = Function.dual(
  2,
  (setup: SyncSetup, code: string): Effect.Effect<string, LinkRefused> =>
    Effect.flatMap(setup.redeem(code), answer =>
      RedeemAnswer.match(answer, {
        Redeemed: ({ identity }) => Effect.succeed(identity),
        Refused: ({ problem }) => Effect.fail(refusedFor(problem)),
      }),
    ),
)

const socketUrlOf = (origin: string, storeId: string): string => {
  const url = new URL(PLAYER_LOG_PATH, origin)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.searchParams.set('store', storeId)
  return url.toString()
}

const OFFLINE_CLOSE_CODE = 4000

const closedWhenOffline = Layer.effect(
  Socket.WebSocketConstructor,
  Effect.map(Socket.WebSocketConstructor, open => (url, options) => {
    const socket = open(url, options)
    const goOffline = () => socket.close(OFFLINE_CLOSE_CODE, 'Offline')
    globalThis.addEventListener('offline', goOffline)
    socket.addEventListener(
      'close',
      () => globalThis.removeEventListener('offline', goOffline),
      { once: true },
    )
    return socket
  }),
).pipe(Layer.provide(Socket.layerWebSocketConstructorGlobal))

const socketProtocol = (
  url: string,
  hooks: RpcClient.ConnectionHooks['Service'],
) =>
  RpcClient.layerProtocolSocket({
    retryTransientErrors: true,
    pingInterval: '60 seconds',
  }).pipe(
    Layer.provide(Layer.succeed(RpcClient.ConnectionHooks, hooks)),
    Layer.provide(Socket.layerWebSocket(url)),
    Layer.provide(closedWhenOffline),
    Layer.provide(RpcSerialization.layerSchemaBinary()),
  )

const redeemOver = (origin: string, code: string) =>
  pipe(
    Layer.build(FetchHttpClient.layer),
    Effect.flatMap(http =>
      pipe(
        HttpClientRequest.post(new URL(LINK_REDEEM_PATH, origin).href),
        HttpClientRequest.schemaBodyJson(RedeemRequest)({ code }),
        Effect.flatMap(HttpClient.execute),
        Effect.flatMap(HttpClientResponse.schemaBodyJson(RedeemAnswer)),
        Effect.provideContext(http),
        Effect.provideService(HttpClient.TracerPropagationEnabled, false),
      ),
    ),
    Effect.scoped,
    Effect.mapError(offline),
  )

export const browserSetup = (origin: string): Effect.Effect<SyncSetup> =>
  Effect.map(browserTransports(origin), transports => ({
    connect: (storeId, hooks) =>
      Effect.flatMap(
        Effect.orDie(
          Layer.build(socketProtocol(socketUrlOf(origin, storeId), hooks)),
        ),
        protocol =>
          Effect.provideContext(
            RpcClient.make(PlayerLogRpcs, { disableTracing: true }),
            protocol,
          ),
      ),
    redeem: code => redeemOver(origin, code),
    transports,
  }))
