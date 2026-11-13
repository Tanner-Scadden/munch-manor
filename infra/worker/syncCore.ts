import { Function, String } from 'effect'
import * as Array from 'effect/Array'
import * as Clock from 'effect/Clock'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import * as Scope from 'effect/Scope'
import * as Semaphore from 'effect/Semaphore'
import type * as SqlClient from 'effect/sql/SqlClient'

import type { DurableObjectState } from '@cloudflare/workers-types'
import * as SqliteClient from '@effect/sql-sqlite-do/SqliteClient'
import type { Unauthorized } from '@munch/sync-engine'
import {
  Actor,
  type Authenticate,
  type Connection,
  type Delta,
  type Directory,
  IDENTITY_PATHS,
  IdentityFailure,
  IdentityRefused,
  OPENED,
  RedeemRequest,
  type ScopeDefinition,
  type ScopeServer,
  ServerMessage,
  SessionRequest,
  decodeExchange,
  encodeExchangeReply,
  encodeServerMessage,
  handleMessage,
  handleRaw,
  identityFailureStatus,
  makeDirectory,
  makeScopeServer,
  parseScopeId,
  verifyToken,
} from '@munch/sync-engine'

import {
  LinkedDevices,
  PlayerScope,
  playerScopeId,
} from '../../src/platform/playerScope.ts'
import { PLAYER_SCOPE_KIND } from '../../src/platform/playerScopeParts.ts'
import { SavedJournal } from '../../src/shared/journalData.ts'

// NOTE: the sync Worker's logic, kept apart from the Durable Object classes
// in sync.ts so `bun test` can run it without the Workers runtime. One
// Durable Object per scope (SyncScope) holds that scope's log and tables in
// its SQLite storage; one Durable Object (SyncDirectory) maps devices to
// players and keeps the link codes.

// LIMITS

const MAX_EXCHANGE_BYTES = 64 * 1024
const MAX_IDENTITY_BYTES = 4 * 1024

export const CORS_HEADERS: Readonly<Record<string, string>> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization',
  'access-control-max-age': '86400',
}

export const json: {
  (body: string): (status: number) => Response
  (status: number, body: string): Response
} = Function.dual(
  2,
  (status: number, body: string): Response =>
    new Response(body, {
      status,
      headers: { 'content-type': 'application/json', ...CORS_HEADERS },
    }),
)

const encodeIdentityFailure = Schema.encodeEffect(
  Schema.fromJsonString(IdentityFailure),
)

export const failureResponse = (
  failure: IdentityFailure,
): Effect.Effect<Response> =>
  Effect.map(Effect.orDie(encodeIdentityFailure(failure)), text =>
    json(identityFailureStatus(failure), text),
  )

// ERRORS

// NOTE: a Durable Object's services (its SQLite client and the scope host or
// directory on it) could not be built. The next request tries again.
export class SyncSetupFailed extends Schema.TaggedError<
  SyncSetupFailed,
  { readonly brand: unique symbol }
>()('SyncSetupFailed', { cause: Schema.Unknown }) {}

// NOTE: the scope server could not open its log and tables.
export class ScopeHostFailed extends Schema.TaggedError<
  ScopeHostFailed,
  { readonly brand: unique symbol }
>()('ScopeHostFailed', { cause: Schema.Unknown }) {}

// NOTE: reading a body, or a call to another Durable Object, failed.
export class SyncCallFailed extends Schema.TaggedError<
  SyncCallFailed,
  { readonly brand: unique symbol }
>()('SyncCallFailed', { step: Schema.String, cause: Schema.Unknown }) {}

// NOTE: an internal request whose body did not decode.
export class BadSyncBody extends Schema.TaggedError<
  BadSyncBody,
  { readonly brand: unique symbol }
>()('BadSyncBody', { reason: Schema.String }) {}

export type SyncError = SyncSetupFailed | SyncCallFailed | BadSyncBody

// NOTE: every sync error becomes a JSON answer, and the internal ones are
// logged. The client treats a failed request as one to try again later.
export const syncErrorResponse = (
  effect: Effect.Effect<Response, SyncError>,
): Effect.Effect<Response> =>
  effect.pipe(
    Effect.catchTags({
      BadSyncBody: error =>
        failureResponse(
          IdentityFailure.cases.BadRequest.make({ reason: error.reason }),
        ),
      SyncSetupFailed: error =>
        Effect.as(
          Effect.logError('Sync setup failed', error.cause),
          json(500, '{}'),
        ),
      SyncCallFailed: error =>
        Effect.as(
          Effect.logError(`Sync call failed: ${error.step}`, error.cause),
          json(500, '{}'),
        ),
    }),
  )

export const tryCall: {
  <A>(
    call: () => PromiseLike<A>,
  ): (step: string) => Effect.Effect<A, SyncCallFailed>
  <A>(
    step: string,
    call: () => PromiseLike<A>,
  ): Effect.Effect<A, SyncCallFailed>
} = Function.dual(
  2,
  <A>(
    step: string,
    call: () => PromiseLike<A>,
  ): Effect.Effect<A, SyncCallFailed> =>
    Effect.tryPromise({
      try: () => call(),
      catch: cause => SyncCallFailed.make({ step, cause }),
    }),
)

// NIGHTMARE

// NOTE: whether a player has unlocked Nightmare, and the Dare Journal's
// milestones they have reached, as their own scope holds them on the
// server. A co-op room asks before it seats them, so the lobby never takes
// a client's word for Nightmare (Lobby.ts, ChangedPicks), and as a run
// starts, so the host's milestones open the room's new dare things
// (src/world/dare/milestones.ts). Anything that goes wrong reads as locked
// with no milestones.
export const NIGHTMARE_PATH = '/internal/nightmare'
const SCOPE_HEADER = 'x-sync-scope'

export type PlayerFacts = Readonly<{
  unlocked: boolean
  milestones: ReadonlyArray<string>
}>

const NO_FACTS: PlayerFacts = { unlocked: false, milestones: [] }

const PlayerRows = Schema.Array(
  Schema.Struct({
    nightmare: Schema.String,
    journal: Schema.String.pipe(Schema.optionalKey),
  }),
)
const decodePlayerRows = Schema.decodeUnknownOption(PlayerRows)
const decodeJournal = Schema.decodeUnknownOption(
  Schema.fromJsonString(SavedJournal),
)

export const playerFactsIn = (
  tables: Readonly<Record<string, ReadonlyArray<unknown>>>,
): PlayerFacts =>
  Option.match(
    Option.flatMap(decodePlayerRows(tables['player'] ?? []), Array.head),
    {
      onNone: () => NO_FACTS,
      onSome: row => ({
        unlocked: row.nightmare === 'Unlocked',
        milestones: Option.match(
          Option.flatMap(Option.fromUndefinedOr(row.journal), decodeJournal),
          {
            onNone: () => [],
            onSome: journal => journal.milestones,
          },
        ),
      }),
    },
  )

/** @stability unstable */
export const playerFactsOf = (host: ScopeHost): Effect.Effect<PlayerFacts> =>
  Effect.map(Effect.orDie(host.server.snapshot), snapshot =>
    snapshot._tag === 'Snapshot' ? playerFactsIn(snapshot.tables) : NO_FACTS,
  )

const NightmareAnswer = Schema.fromJsonString(
  Schema.Struct({
    unlocked: Schema.Boolean,
    milestones: Schema.Array(Schema.String).pipe(Schema.optionalKey),
  }),
)
const decodeNightmareAnswer = Schema.decodeUnknownOption(NightmareAnswer)

export const encodeNightmareAnswer = (
  facts: PlayerFacts,
): Effect.Effect<string> =>
  Effect.orDie(Schema.encodeEffect(NightmareAnswer)(facts))

type ScopeAnswer = Readonly<{
  ok: boolean
  text: () => Promise<string>
}>

type FetchScope = (
  scope: string,
  url: string,
  headers: Readonly<Record<string, string>>,
) => Promise<ScopeAnswer>

export const readPlayerFacts: {
  (playerId: string): (fetchScope: FetchScope) => Effect.Effect<PlayerFacts>
  (fetchScope: FetchScope, playerId: string): Effect.Effect<PlayerFacts>
} = Function.dual(
  2,
  (fetchScope: FetchScope, playerId: string): Effect.Effect<PlayerFacts> => {
    const scope = playerScopeId(playerId)
    return tryCall('read the player facts', () =>
      fetchScope(scope, `https://sync${NIGHTMARE_PATH}`, {
        [SCOPE_HEADER]: scope,
      }),
    ).pipe(
      Effect.flatMap(response =>
        response.ok
          ? tryCall('read the answer', () => response.text())
          : Effect.succeed(''),
      ),
      Effect.map(text =>
        Option.match(decodeNightmareAnswer(text), {
          onNone: () => NO_FACTS,
          onSome: answer => ({
            unlocked: answer.unlocked,
            milestones: answer.milestones ?? [],
          }),
        }),
      ),
      Effect.orElseSucceed(() => NO_FACTS),
    )
  },
)

// SETUP

// NOTE: a Durable Object builds its Effect services once, on first use, in a
// scope that lives as long as the object. Only a success is kept: a failed
// build closes its scope and the next caller builds again, so one failure
// does not break the object until it is evicted. Callers that arrive while a
// build is running share it.
export const setupOnce = <A, E>(
  setup: Effect.Effect<A, E, Scope.Scope>,
): Effect.Effect<Effect.Effect<A, E>> =>
  Effect.cachedWithTTL(
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      return yield* setup.pipe(
        Scope.provide(scope),
        Effect.onError(cause => Scope.close(scope, Exit.failCause(cause))),
      )
    }),
    exit => (Exit.isSuccess(exit) ? Duration.infinity : Duration.zero),
  )

// NOTE: builds the SQLite client in the setup's scope, then the services on
// it, so the client lives as long as they do. A storage call that throws is
// a setup failure too, so it is answered and retried like one.
/** @stability unstable */
export const buildOn: {
  <A, E1, E2>(
    make: Effect.Effect<A, E2, SqlClient.SqlClient>,
  ): (
    sql: Layer.Layer<SqlClient.SqlClient, E1>,
  ) => Effect.Effect<A, SyncSetupFailed, Scope.Scope>
  <A, E1, E2>(
    sql: Layer.Layer<SqlClient.SqlClient, E1>,
    make: Effect.Effect<A, E2, SqlClient.SqlClient>,
  ): Effect.Effect<A, SyncSetupFailed, Scope.Scope>
} = Function.dual(
  2,
  <A, E1, E2>(
    sql: Layer.Layer<SqlClient.SqlClient, E1>,
    make: Effect.Effect<A, E2, SqlClient.SqlClient>,
  ): Effect.Effect<A, SyncSetupFailed, Scope.Scope> =>
    Effect.flatMap(Layer.build(sql), context =>
      Effect.provide(make, context),
    ).pipe(
      Effect.mapError(cause => SyncSetupFailed.make({ cause })),
      Effect.catchDefect(cause => Effect.fail(SyncSetupFailed.make({ cause }))),
    ),
)

// AUTH

export const authenticateWith =
  (secret: string): Authenticate =>
  token =>
    Effect.flatMap(Clock.currentTimeMillis, nowMs =>
      Effect.map(verifyToken(secret, token, nowMs), claims =>
        Actor.cases.Device.make({
          playerId: claims.playerId,
          deviceId: claims.deviceId,
        }),
      ),
    )

// NOTE: each Durable Object's SQLite client, over its own storage. The hosts
// here build it once, on first use, and keep it for the object's life (see
// setupOnce).
/** @stability unstable */
export const sqlOf = (storage: DurableObjectState['storage']) =>
  SqliteClient.layer({ storage })

// NOTE: whether a request asks to become a WebSocket.
export const isWebSocketUpgrade = (request: Request): boolean =>
  Option.exists(
    Option.fromNullishOr(request.headers.get('upgrade')),
    header => String.toLowerCase(header) === 'websocket',
  )

export const bearerOf = (request: Request): Option.Option<string> =>
  Option.flatMap(
    Option.fromNullishOr(request.headers.get('authorization')),
    header =>
      String.startsWith('Bearer ')(header)
        ? Option.some(String.slice(7)(header))
        : Option.none(),
  )

// NOTE: only player scopes exist so far. A scope id that does not parse, or
// names another kind, never reaches a Durable Object.
export const playerScopeOf = (url: URL): Option.Option<string> =>
  Option.flatMap(Option.fromNullishOr(url.searchParams.get('scope')), scope =>
    Option.filter(
      parseScopeId(scope),
      address => address.kind === PLAYER_SCOPE_KIND,
    ).pipe(Option.as(scope)),
  )

// SCOPE HOST

export interface Socket {
  readonly send: (message: string) => void
  readonly connection: Connection
  readonly setConnection: (connection: Connection) => Effect.Effect<void>
}

// NOTE: `onMessage` and `exchangeWith` say which deltas they applied, so a
// host with more to do on a mutation (the GameRoom starting a game on
// StartedGame) can react after the broadcast.
/** @stability unstable */
export interface ScopeHost {
  readonly server: ScopeServer
  readonly onMessage: (
    socket: Socket,
    raw: string,
    everyone: ReadonlyArray<Socket>,
  ) => Effect.Effect<ReadonlyArray<Delta>>
  readonly exchange: (
    body: string,
    everyone: ReadonlyArray<Socket>,
  ) => Effect.Effect<Response>
  readonly exchangeWith: (
    body: string,
    everyone: ReadonlyArray<Socket>,
  ) => Effect.Effect<{
    readonly response: Response
    readonly applied: ReadonlyArray<Delta>
  }>
  readonly linkedDevices: (
    count: number,
    id: string,
    everyone: ReadonlyArray<Socket>,
  ) => Effect.Effect<void>
}

const encodeAll = (messages: ReadonlyArray<ServerMessage>) =>
  Effect.forEach(messages, message =>
    Effect.orDie(encodeServerMessage(message)),
  )

export const deliver: {
  (
    sockets: ReadonlyArray<Socket>,
  ): (messages: ReadonlyArray<ServerMessage>) => Effect.Effect<void>
  (
    messages: ReadonlyArray<ServerMessage>,
    sockets: ReadonlyArray<Socket>,
  ): Effect.Effect<void>
} = Function.dual(
  2,
  (
    messages: ReadonlyArray<ServerMessage>,
    sockets: ReadonlyArray<Socket>,
  ): Effect.Effect<void> =>
    Effect.flatMap(encodeAll(messages), encoded =>
      Effect.sync(() =>
        Array.forEach(sockets, socket => {
          Array.forEach(encoded, text => {
            socket.send(text)
          })
        }),
      ),
    ),
)

export const joinedOf = (sockets: ReadonlyArray<Socket>) =>
  Array.filter(sockets, socket => socket.connection._tag === 'Joined')

const deltasOf = (
  messages: ReadonlyArray<ServerMessage>,
): ReadonlyArray<Delta> =>
  Array.flatMap(messages, message =>
    message._tag === 'Deltas' ? message.deltas : [],
  )

/** @stability unstable */
export const makeScopeHost: {
  (
    authenticate: Authenticate,
    definition: ScopeDefinition,
  ): (
    scope: string,
  ) => Effect.Effect<ScopeHost, ScopeHostFailed, SqlClient.SqlClient>
  (
    scope: string,
    authenticate: Authenticate,
    definition: ScopeDefinition,
  ): Effect.Effect<ScopeHost, ScopeHostFailed, SqlClient.SqlClient>
} = Function.dual(
  3,
  (
    scope: string,
    authenticate: Authenticate,
    definition: ScopeDefinition,
  ): Effect.Effect<ScopeHost, ScopeHostFailed, SqlClient.SqlClient> =>
    Effect.gen(function* () {
      const server = yield* Effect.mapError(
        makeScopeServer({ definition, scope }),
        cause => ScopeHostFailed.make({ cause }),
      )

      const onMessage = (
        socket: Socket,
        raw: string,
        everyone: ReadonlyArray<Socket>,
      ) =>
        Effect.gen(function* () {
          const result = yield* handleRaw(
            server,
            authenticate,
            socket.connection,
            raw,
          )
          yield* socket.setConnection(result.connection)
          yield* deliver(result.broadcast, joinedOf(everyone))
          yield* deliver(result.reply, [socket])
          return deltasOf(result.broadcast)
        })

      // NOTE: the HTTP fallback: a batch of messages on a connection that
      // lasts one request. The requester gets the broadcasts too, so it sees
      // its own deltas; sockets on the same scope get the broadcasts as usual.
      const exchangeWith = (body: string, everyone: ReadonlyArray<Socket>) =>
        Effect.gen(function* () {
          if (new TextEncoder().encode(body).byteLength > MAX_EXCHANGE_BYTES) {
            return { response: json(413, '[]'), applied: [] }
          }
          const decoded = yield* Effect.result(decodeExchange(body))
          if (decoded._tag === 'Failure') {
            return { response: json(400, '[]'), applied: [] }
          }
          const replies = yield* Effect.reduce(
            decoded.success,
            () => ({ connection: OPENED, out: Array.empty<ServerMessage>() }),
            (state, message) =>
              Effect.gen(function* () {
                const result = yield* handleMessage(
                  server,
                  authenticate,
                  state.connection,
                  message,
                )
                yield* deliver(result.broadcast, joinedOf(everyone))
                return {
                  connection: result.connection,
                  out: Array.appendAll(state.out, [
                    ...result.broadcast,
                    ...result.reply,
                  ]),
                }
              }),
          )
          const reply = yield* Effect.orDie(encodeExchangeReply(replies.out))
          return { response: json(200, reply), applied: deltasOf(replies.out) }
        })

      const exchange = (body: string, everyone: ReadonlyArray<Socket>) =>
        Effect.map(exchangeWith(body, everyone), result => result.response)

      // NOTE: the server mutation a link makes. Its delta goes to every
      // device on the scope at once.
      const linkedDevices = (
        count: number,
        id: string,
        everyone: ReadonlyArray<Socket>,
      ) =>
        Effect.gen(function* () {
          const outcome = yield* Effect.orDie(
            server.runServer(LinkedDevices, { count }, id),
          )
          if (outcome._tag === 'Applied') {
            const head = yield* Effect.orDie(server.head)
            yield* deliver(
              [
                ServerMessage.cases.Deltas.make({
                  scope: server.scope,
                  head,
                  deltas: [outcome.delta],
                }),
              ],
              joinedOf(everyone),
            )
          }
        })

      return { server, onMessage, exchange, exchangeWith, linkedDevices }
    }),
)

// DIRECTORY

export interface DirectoryRequest {
  readonly path: string
  readonly body: string
  readonly bearer: Option.Option<string>
}

export interface Linked {
  readonly playerId: string
  readonly devices: number
  readonly deviceId: string
}

const decodeBody = <A, I>(schema: Schema.Codec<A, I>, body: string) =>
  Effect.mapError(
    Schema.decodeEffect(Schema.fromJsonString(schema))(body),
    error =>
      IdentityRefused.make({
        failure: IdentityFailure.cases.BadRequest.make({
          reason: error.message,
        }),
      }),
  )

const claimsFrom = (
  secret: string,
  bearer: Option.Option<string>,
  nowMs: number,
) =>
  Option.match(bearer, {
    onNone: () =>
      Effect.fail(
        IdentityRefused.make({
          failure: IdentityFailure.cases.Unauthorized.make({
            reason: 'No token',
          }),
        }),
      ),
    onSome: token =>
      Effect.mapError(
        verifyToken(secret, token, nowMs),
        (error: Unauthorized) =>
          IdentityRefused.make({
            failure: IdentityFailure.cases.Unauthorized.make({
              reason: error.reason,
            }),
          }),
      ),
  })

const ok = <A, I>(
  schema: Schema.Codec<A, I>,
  value: A,
): Effect.Effect<Response> =>
  Effect.map(
    Effect.orDie(Schema.encodeEffect(Schema.fromJsonString(schema))(value)),
    text => json(200, text),
  )

export const SessionResponseJson = Schema.Struct({
  token: Schema.String,
  deviceId: Schema.String,
  playerId: Schema.String,
  devices: Schema.Finite,
  expiresMs: Schema.Finite,
})

const LinkCodeJson = Schema.Struct({
  code: Schema.String,
  expiresMs: Schema.Finite,
})

// NOTE: answers one identity request. On a successful redeem it also says
// which player gained a device, so the caller can tell that player's scope.
export const handleDirectory: {
  (
    secret: string,
    request: DirectoryRequest,
    nowMs: number,
  ): (directory: Directory) => Effect.Effect<{
    readonly response: Response
    readonly linked: Option.Option<Linked>
  }>
  (
    directory: Directory,
    secret: string,
    request: DirectoryRequest,
    nowMs: number,
  ): Effect.Effect<{
    readonly response: Response
    readonly linked: Option.Option<Linked>
  }>
} = Function.dual(
  4,
  (
    directory: Directory,
    secret: string,
    request: DirectoryRequest,
    nowMs: number,
  ): Effect.Effect<{
    readonly response: Response
    readonly linked: Option.Option<Linked>
  }> =>
    Effect.gen(function* () {
      if (
        new TextEncoder().encode(request.body).byteLength > MAX_IDENTITY_BYTES
      ) {
        const response = yield* failureResponse(
          IdentityFailure.cases.BadRequest.make({ reason: 'Too large' }),
        )
        return { response, linked: Option.none() }
      }
      if (request.path === IDENTITY_PATHS.session) {
        const body = yield* decodeBody(SessionRequest, request.body)
        const session = yield* directory.session(body, nowMs)
        const response = yield* ok(SessionResponseJson, session)
        return { response, linked: Option.none() }
      }
      if (request.path === IDENTITY_PATHS.link) {
        const claims = yield* claimsFrom(secret, request.bearer, nowMs)
        const code = yield* directory.createLinkCode(claims, nowMs)
        const response = yield* ok(LinkCodeJson, code)
        return { response, linked: Option.none() }
      }
      if (request.path === IDENTITY_PATHS.redeem) {
        const claims = yield* claimsFrom(secret, request.bearer, nowMs)
        const body = yield* decodeBody(RedeemRequest, request.body)
        const redeemed = yield* directory.redeem(claims, body.code, nowMs)
        const response = yield* ok(SessionResponseJson, redeemed.session)
        return {
          response,
          linked: Option.some({
            playerId: redeemed.session.playerId,
            devices: redeemed.session.devices,
            deviceId: redeemed.session.deviceId,
          }),
        }
      }
      const response = yield* failureResponse(
        IdentityFailure.cases.BadRequest.make({ reason: 'No such path' }),
      )
      return { response, linked: Option.none() }
    }).pipe(
      Effect.catchTag('IdentityRefused', error =>
        Effect.map(failureResponse(error.failure), response => ({
          response,
          linked: Option.none(),
        })),
      ),
    ),
)

// DURABLE OBJECT HOSTS

// NOTE: what SyncScope runs, apart from the Workers runtime: its scope host,
// built once on first use.
/** @stability unstable */
export const scopeHostOnce: {
  <E>(
    scope: string,
    secret: string,
  ): (
    sql: Layer.Layer<SqlClient.SqlClient, E>,
  ) => Effect.Effect<Effect.Effect<ScopeHost, SyncSetupFailed>>
  <E>(
    sql: Layer.Layer<SqlClient.SqlClient, E>,
    scope: string,
    secret: string,
  ): Effect.Effect<Effect.Effect<ScopeHost, SyncSetupFailed>>
} = Function.dual(
  3,
  <E>(
    sql: Layer.Layer<SqlClient.SqlClient, E>,
    scope: string,
    secret: string,
  ): Effect.Effect<Effect.Effect<ScopeHost, SyncSetupFailed>> =>
    setupOnce(
      buildOn(sql, makeScopeHost(scope, authenticateWith(secret), PlayerScope)),
    ),
)

export interface DirectoryHost {
  readonly fetch: (request: Request) => Effect.Effect<Response>
}

// NOTE: what SyncDirectory runs, apart from the Workers runtime. One request
// is handled at a time: the input gate only covers storage, and token checks
// await WebCrypto. After a link, the player's scope is told the new device
// count. The link is already saved by then, so a failure to tell is logged
// and the link still answers 200.
/** @stability unstable */
export const makeDirectoryHost = <E>(options: {
  readonly sql: Layer.Layer<SqlClient.SqlClient, E>
  readonly secret: string
  readonly tellScope: (linked: Linked) => Effect.Effect<void, SyncCallFailed>
}): Effect.Effect<DirectoryHost> =>
  Effect.gen(function* () {
    const lock = yield* Semaphore.make(1)
    const directory = yield* setupOnce(
      buildOn(options.sql, makeDirectory(options.secret)),
    )
    const fetch = (request: Request) =>
      syncErrorResponse(
        Effect.gen(function* () {
          const ready = yield* directory
          const body = yield* tryCall('read the body', () => request.text())
          const nowMs = yield* Clock.currentTimeMillis
          const handled = yield* lock.withPermit(
            handleDirectory(
              ready,
              options.secret,
              directoryRequestOf(request, body),
              nowMs,
            ),
          )
          if (Option.isSome(handled.linked)) {
            yield* options
              .tellScope(handled.linked.value)
              .pipe(
                Effect.catchTag('SyncCallFailed', error =>
                  Effect.logWarning(
                    `Telling the scope about a link failed: ${error.step}`,
                    error.cause,
                  ),
                ),
              )
          }
          return handled.response
        }),
      )
    return { fetch }
  })

const directoryRequestOf = (
  request: Request,
  body: string,
): DirectoryRequest => ({
  path: new URL(request.url).pathname,
  body,
  bearer: bearerOf(request),
})

export { playerScopeId }
