import type * as cf from '@cloudflare/workers-types'
import { Context, Effect, Layer, Predicate, Redacted, Scope } from 'effect'
import {
  EventLog,
  EventLogMessage,
  EventLogServer,
  EventLogServerUnencrypted,
  SqlEventLogServerUnencrypted,
} from 'effect/eventlog'
import { type Rpc, RpcSerialization, RpcServer } from 'effect/rpc'

import * as SqliteClient from '@effect/sql-sqlite-do/SqliteClient'

import { type Transport, makeTransport } from './doProtocol.ts'
import { masterySchema } from './mastery.ts'
import {
  AuthorizationLayer,
  ServerHandlersLayer,
  storeMappingLayer,
} from './serverParts.ts'

type Env = { EVENTLOG: cf.DurableObjectNamespace }

let activations = 0

const CHANGES_TAG = 'EventLog.Changes'

const authenticatedKeyOf = (payload: unknown) =>
  Predicate.isObject(payload) && typeof payload['publicKey'] === 'string'
    ? payload['publicKey']
    : undefined

const restoreSession = (
  client: Rpc.ServerClient,
  sessionOf: (clientId: number) => string | undefined,
) => {
  const publicKey = sessionOf(client.id)
  if (publicKey === undefined) return
  const known = Context.getOrUndefined(
    client.annotations,
    EventLogServer.AuthenticatedIdentities,
  )
  if (known?.has(publicKey) === true) return
  client
    .annotate(EventLog.Identity, {
      publicKey,
      privateKey: Redacted.make(new Uint8Array(32)),
    })
    .annotate(EventLogServer.AuthenticatedIdentities, new Set([publicKey]))
}

const restoringHandlers = <A, E, R>(
  handlers: Layer.Layer<A, E, R>,
  sessionOf: (clientId: number) => string | undefined,
) =>
  Layer.effectContext(
    Effect.map(Layer.build(handlers), context => {
      const entries = new Map(context.mapUnsafe)
      for (const rpc of EventLogMessage.EventLogRemoteRpcs.requests.values()) {
        const entry: Rpc.Handler<string> | undefined = entries.get(rpc.key)
        if (entry === undefined) continue
        entries.set(rpc.key, {
          ...entry,
          handler: (
            payload: unknown,
            options: Parameters<Rpc.Handler<string>['handler']>[1],
          ) => {
            restoreSession(options.client, sessionOf)
            return entry.handler(payload, options)
          },
        })
      }
      return Context.makeUnsafe<A>(entries)
    }),
  )

export class EventLogStore {
  private readonly ready: Promise<Transport>
  private readonly activation: string

  constructor(ctx: cf.DurableObjectState, env: Env) {
    activations += 1
    this.activation = `${activations}@${new Date().toISOString()}`
    const isHere = (storeId: string) =>
      env.EVENTLOG.idFromName(storeId).equals(ctx.id)
    this.ready = Effect.runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.make()
        const transport = yield* makeTransport(ctx, {
          resumableTags: new Set([CHANGES_TAG]),
          sessionRpc: EventLogMessage.AuthenticateRpc,
          sessionOf: authenticatedKeyOf,
        }).pipe(
          Effect.provide(RpcSerialization.layerSchemaBinary()),
        )
        const server = RpcServer.layer(EventLogMessage.EventLogRemoteRpcs).pipe(
          Layer.provide(
            restoringHandlers(
              EventLogServerUnencrypted.layerNoRpcServer(
                masterySchema,
                ServerHandlersLayer,
              ),
              clientId => transport.sessionOf(clientId),
            ),
          ),
          Layer.provide([
            AuthorizationLayer,
            storeMappingLayer(isHere),
            SqlEventLogServerUnencrypted.layerStorage(),
          ]),
          Layer.provide(Layer.succeed(RpcServer.Protocol, transport.protocol)),
          Layer.provide(SqliteClient.layer({ storage: ctx.storage })),
        )
        yield* Layer.buildWithScope(server, scope)
        return transport
      }),
    )
  }

  async fetch(request: Request): Promise<Response> {
    const transport = await this.ready
    if (new URL(request.url).pathname.endsWith('/activation')) {
      return new Response(`${this.activation} resumed=${transport.resumedCount}\n${transport.restoreLog.join('\n')}\n${transport.describe()}`)
    }
    return Effect.runPromise(transport.upgrade())
  }

  async webSocketMessage(socket: cf.WebSocket, data: string | ArrayBuffer) {
    const transport = await this.ready
    await Effect.runPromise(transport.message(socket, data))
  }

  async webSocketClose(socket: cf.WebSocket) {
    const transport = await this.ready
    await Effect.runPromise(transport.close(socket))
  }

  async webSocketError(socket: cf.WebSocket) {
    const transport = await this.ready
    await Effect.runPromise(transport.close(socket))
  }
}

const STORE_PATH = /^\/eventlog\/([^/]+)(\/activation)?$/

export default {
  fetch: (request: Request, env: Env): Promise<Response> | Response => {
    const match = STORE_PATH.exec(new URL(request.url).pathname)
    if (match === null) return new Response('not found', { status: 404 })
    const store = decodeURIComponent(match[1] ?? '')
    const stub = env.EVENTLOG.get(env.EVENTLOG.idFromName(store))
    return stub.fetch(request as never) as unknown as Promise<Response>
  },
}
