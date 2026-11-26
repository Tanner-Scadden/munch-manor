import type * as cf from '@cloudflare/workers-types'
import { Effect, Layer, Scope } from 'effect'
import {
  EventLogMessage,
  EventLogServerUnencrypted,
  SqlEventLogServerUnencrypted,
} from 'effect/eventlog'
import { RpcSerialization, RpcServer } from 'effect/rpc'

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
        const transport = yield* makeTransport(ctx).pipe(
          Effect.provide(RpcSerialization.layerSchemaBinary()),
        )
        const server = RpcServer.layer(EventLogMessage.EventLogRemoteRpcs).pipe(
          Layer.provide(
            EventLogServerUnencrypted.layerNoRpcServer(
              masterySchema,
              ServerHandlersLayer,
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
      return new Response(this.activation)
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
