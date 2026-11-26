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
import type * as SqlClient from 'effect/sql/SqlClient'

import type { DurableObjectState } from '@cloudflare/workers-types'
import * as SqliteClient from '@effect/sql-sqlite-do/SqliteClient'
import {
  Actor,
  type Authenticate,
  type Connection,
  type Delta,
  OPENED,
  type ScopeDefinition,
  type ScopeServer,
  type ServerMessage,
  decodeExchange,
  encodeExchangeReply,
  encodeServerMessage,
  handleMessage,
  handleRaw,
  makeScopeServer,
} from '@munch/sync-engine'

import {
  SavedDareMarks,
  noDareMarks,
} from '../../src/shared/records/dareMarkData.ts'
import { playerStoreOf } from '../../src/shared/records/sessionApi.ts'
import { verifyToken } from './sessionToken.ts'

const MAX_EXCHANGE_BYTES = 64 * 1024

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

const BadRequestJson = Schema.fromJsonString(
  Schema.TaggedStruct('BadRequest', { reason: Schema.String }),
)

const badRequestResponse = (reason: string): Effect.Effect<Response> =>
  Effect.map(
    Effect.orDie(
      Schema.encodeEffect(BadRequestJson)({ _tag: 'BadRequest', reason }),
    ),
    text => json(400, text),
  )

export class SyncSetupFailed extends Schema.TaggedError<
  SyncSetupFailed,
  { readonly brand: unique symbol }
>()('SyncSetupFailed', { cause: Schema.Unknown }) {}

export class ScopeHostFailed extends Schema.TaggedError<
  ScopeHostFailed,
  { readonly brand: unique symbol }
>()('ScopeHostFailed', { cause: Schema.Unknown }) {}

export class SyncCallFailed extends Schema.TaggedError<
  SyncCallFailed,
  { readonly brand: unique symbol }
>()('SyncCallFailed', { step: Schema.String, cause: Schema.Unknown }) {}

export class BadSyncBody extends Schema.TaggedError<
  BadSyncBody,
  { readonly brand: unique symbol }
>()('BadSyncBody', { reason: Schema.String }) {}

export type SyncError = SyncSetupFailed | SyncCallFailed | BadSyncBody

export const syncErrorResponse = (
  effect: Effect.Effect<Response, SyncError>,
): Effect.Effect<Response> =>
  effect.pipe(
    Effect.catchTags({
      BadSyncBody: error => badRequestResponse(error.reason),
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

export const NIGHTMARE_PATH = '/internal/nightmare'

export type PlayerFacts = Readonly<{
  unlocked: boolean
  milestones: ReadonlyArray<string>
  marks: SavedDareMarks
}>

const NO_FACTS: PlayerFacts = {
  unlocked: false,
  milestones: [],
  marks: noDareMarks,
}

const NightmareAnswer = Schema.fromJsonString(
  Schema.Struct({
    unlocked: Schema.Boolean,
    milestones: Schema.Array(Schema.String).pipe(Schema.optionalKey),
    marks: SavedDareMarks.pipe(Schema.optionalKey),
  }),
)
const decodeNightmareAnswer = Schema.decodeUnknownOption(NightmareAnswer)

export const encodeNightmareAnswer = (
  facts: PlayerFacts,
): Effect.Effect<string> =>
  Effect.orDie(Schema.encodeEffect(NightmareAnswer)(facts))

type StoreAnswer = Readonly<{
  ok: boolean
  text: () => Promise<string>
}>

type FetchStore = (store: string, url: string) => Promise<StoreAnswer>

export const askPlayerFacts: {
  (playerId: string): (fetchStore: FetchStore) => Effect.Effect<PlayerFacts>
  (fetchStore: FetchStore, playerId: string): Effect.Effect<PlayerFacts>
} = Function.dual(
  2,
  (fetchStore: FetchStore, playerId: string): Effect.Effect<PlayerFacts> =>
    tryCall('read the player facts', () =>
      fetchStore(playerStoreOf(playerId), `https://player${NIGHTMARE_PATH}`),
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
            marks: answer.marks ?? noDareMarks,
          }),
        }),
      ),
      Effect.orElseSucceed(() => NO_FACTS),
    ),
)

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

export const sqlOf = (storage: DurableObjectState['storage']) =>
  SqliteClient.layer({ storage })

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

export interface Socket {
  readonly send: (message: string) => void
  readonly connection: Connection
  readonly setConnection: (connection: Connection) => Effect.Effect<void>
}

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

      return { server, onMessage, exchange, exchangeWith }
    }),
)
