import { Function, Record } from 'effect'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import { RpcSerialization, RpcServer } from 'effect/rpc'
import * as SqlClient from 'effect/sql/SqlClient'

import type {
  DurableObjectNamespace,
  DurableObjectState,
  RateLimit,
  WebSocket as WorkersWebSocket,
} from '@cloudflare/workers-types'

import { readPlayerFacts } from '../../src/platform/save/playerProjection.ts'
import {
  PLAYER_LOG_PATH,
  PlayerLogRpcs,
} from '../../src/shared/records/sessionApi.ts'
import { type HibernatingTransport, makeTransport } from './doProtocol.ts'
import { issueLinkCodeVia, linkStoreOf } from './linkCodes.ts'
import {
  AUTHENTICATE_TAG,
  CHANGES_TAG,
  authenticatedKeyOf,
  playerLogHandlers,
} from './playerLogCore.ts'
import {
  NIGHTMARE_PATH,
  SyncSetupFailed,
  encodeNightmareAnswer,
  isWebSocketUpgrade,
  json,
  setupOnce,
  sqlOf,
  tryCall,
} from './syncCore.ts'

export type PlayerLogBindings = Readonly<{
  SYNC_SECRET: string
  SYNC_BY_ADDRESS: RateLimit
  PLAYER_LOGS: DurableObjectNamespace
  LINK_CODES: DurableObjectNamespace
}>

const PLAYER_STORE = /^player:[\w-]{1,64}$/

interface Served {
  readonly transport: HibernatingTransport
  readonly facts: Effect.Effect<Response>
}

const serve = (state: DurableObjectState, env: PlayerLogBindings) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const serialization = yield* Layer.build(
      RpcSerialization.layerSchemaBinary(),
    )
    const transport = yield* Effect.provideContext(
      makeTransport(state, {
        resumableTags: new Set([CHANGES_TAG]),
        sessionTag: AUTHENTICATE_TAG,
        sessionOf: authenticatedKeyOf,
      }),
      serialization,
    )
    const links = linkStoreOf(env.LINK_CODES)
    yield* Layer.build(
      RpcServer.layer(PlayerLogRpcs).pipe(
        Layer.provide(
          playerLogHandlers({
            isHere: storeId =>
              env.PLAYER_LOGS.idFromName(storeId).equals(state.id),
            secret: env.SYNC_SECRET,
            issueLinkCode: request => issueLinkCodeVia(links, request),
            sessionOf: transport.sessionOf,
          }),
        ),
        Layer.provide(Layer.succeed(RpcServer.Protocol, transport.protocol)),
        Layer.provide(Layer.succeed(SqlClient.SqlClient, sql)),
      ),
    )
    const facts = Effect.provideService(
      Effect.flatMap(readPlayerFacts, encodeNightmareAnswer),
      SqlClient.SqlClient,
      sql,
    ).pipe(Effect.map(body => json(200, body)))
    return { transport, facts }
  })

export class PlayerLog {
  private readonly served: Effect.Effect<Served, SyncSetupFailed>

  constructor(state: DurableObjectState, env: PlayerLogBindings) {
    this.served = sqlOf(state.storage).pipe(
      Layer.build,
      Effect.flatMap(sql => Effect.provideContext(serve(state, env), sql)),
      Effect.mapError(cause => SyncSetupFailed.make({ cause })),
      setupOnce,
      Effect.runSync,
    )
  }

  private run(use: (served: Served) => Effect.Effect<void>): Promise<void> {
    return Effect.runPromise(
      Effect.flatMap(this.served, use).pipe(
        Effect.catchTag('SyncSetupFailed', error =>
          Effect.logError('Player log setup failed', error.cause),
        ),
      ),
    )
  }

  fetch(request: Request): Promise<Response> {
    return Effect.runPromise(
      Effect.flatMap(this.served, served =>
        new URL(request.url).pathname === NIGHTMARE_PATH
          ? served.facts
          : isWebSocketUpgrade(request)
            ? served.transport.upgrade
            : Effect.succeed(json(426, '{}')),
      ).pipe(
        Effect.catchTag('SyncSetupFailed', error =>
          Effect.as(
            Effect.logError('Player log setup failed', error.cause),
            json(503, '{}'),
          ),
        ),
      ),
    )
  }

  webSocketMessage(
    socket: WorkersWebSocket,
    data: string | ArrayBuffer,
  ): Promise<void> {
    return this.run(served => served.transport.message(socket, data))
  }

  webSocketClose(socket: WorkersWebSocket): Promise<void> {
    return this.run(served => served.transport.close(socket))
  }

  webSocketError(socket: WorkersWebSocket): Promise<void> {
    return this.run(served => served.transport.close(socket))
  }
}

const forward = (request: Request, env: PlayerLogBindings, store: string) =>
  Effect.gen(function* () {
    if (!isWebSocketUpgrade(request)) {
      return json(426, '{}')
    }
    const response = yield* tryCall('open the player log', () =>
      env.PLAYER_LOGS.get(env.PLAYER_LOGS.idFromName(store)).fetch(
        request.url,
        { headers: Record.fromEntries(request.headers.entries()) },
      ),
    )
    return new Response(null, {
      status: response.status,
      webSocket: response.webSocket,
    })
  }).pipe(Effect.orElseSucceed(() => json(503, '{}')))

export const routePlayerLog: {
  (
    env: PlayerLogBindings,
  ): (request: Request) => Effect.Effect<Option.Option<Response>>
  (
    request: Request,
    env: PlayerLogBindings,
  ): Effect.Effect<Option.Option<Response>>
} = Function.dual(
  2,
  (
    request: Request,
    env: PlayerLogBindings,
  ): Effect.Effect<Option.Option<Response>> =>
    Effect.suspend(() => {
      const url = new URL(request.url)
      if (url.pathname !== PLAYER_LOG_PATH) {
        return Effect.succeedNone
      }
      return Effect.asSome(
        Option.match(
          Option.filter(
            Option.fromNullishOr(url.searchParams.get('store')),
            store => PLAYER_STORE.test(store),
          ),
          {
            onNone: () => Effect.succeed(json(400, '{}')),
            onSome: store => forward(request, env, store),
          },
        ),
      )
    }),
)
