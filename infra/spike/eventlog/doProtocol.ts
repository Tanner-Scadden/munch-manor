import type * as cf from '@cloudflare/workers-types'
import { Effect, Latch, Queue, Schema } from 'effect'
import { RpcMessage, RpcSerialization, RpcServer } from 'effect/rpc'

const SOCKET_TAG = 'rpc'
const RESTART_REASON = 'Durable Object woke with this request unfinished'

const Metadata = Schema.Struct({
  clientId: Schema.Number,
  pending: Schema.Boolean,
})
const isMetadata = Schema.is(Metadata)

interface Connection {
  readonly id: number
  readonly socket: cf.WebSocket
  readonly parser: RpcSerialization.Parser
  readonly pending: Set<string | number>
}

export interface Transport {
  readonly protocol: RpcServer.Protocol['Service']
  readonly upgrade: () => Effect.Effect<Response>
  readonly message: (
    socket: cf.WebSocket,
    data: string | ArrayBuffer,
  ) => Effect.Effect<void>
  readonly close: (socket: cf.WebSocket) => Effect.Effect<void>
}

export const makeTransport = (
  state: cf.DurableObjectState,
): Effect.Effect<Transport, never, RpcSerialization.RpcSerialization> =>
  Effect.gen(function* () {
    const serialization = yield* RpcSerialization.RpcSerialization
    const disconnects = yield* Queue.make<number>()
    const ready = yield* Latch.make()
    const bySocket = new Map<cf.WebSocket, Connection>()
    const byId = new Map<number, Connection>()
    let nextId = 0
    let receive:
      | Parameters<RpcServer.Protocol['Service']['run']>[0]
      | undefined

    const persist = (connection: Connection) =>
      Effect.sync(() =>
        connection.socket.serializeAttachment({
          clientId: connection.id,
          pending: connection.pending.size > 0,
        }),
      )

    const close = (socket: cf.WebSocket, code = 1012, reason = RESTART_REASON) =>
      Effect.sync(() => {
        const connection = bySocket.get(socket)
        try {
          socket.close(code, reason)
        } catch {}
        if (connection === undefined) return
        bySocket.delete(socket)
        byId.delete(connection.id)
        Queue.offerUnsafe(disconnects, connection.id)
      })

    const register = (socket: cf.WebSocket, id: number): Connection => {
      const connection: Connection = {
        id,
        socket,
        parser: serialization.makeUnsafe(),
        pending: new Set(),
      }
      bySocket.set(socket, connection)
      byId.set(id, connection)
      nextId = Math.max(nextId, id + 1)
      return connection
    }

    for (const socket of state.getWebSockets(SOCKET_TAG)) {
      const metadata: unknown = socket.deserializeAttachment()
      if (!isMetadata(metadata) || metadata.pending || byId.has(metadata.clientId)) {
        yield* close(socket)
      } else {
        register(socket, metadata.clientId)
      }
    }

    const send = (connection: Connection, response: RpcMessage.FromServerEncoded) =>
      Effect.gen(function* () {
        if (!byId.has(connection.id)) return
        const encoded = connection.parser.encode(response)
        if (encoded === undefined) return yield* close(connection.socket)
        connection.socket.send(encoded)
        if (response._tag === 'Exit') {
          connection.pending.delete(response.requestId)
          yield* persist(connection)
        }
        if (response._tag === 'Defect' || response._tag === 'ClientProtocolError') {
          yield* close(connection.socket)
        }
      }).pipe(
        Effect.catchCause(() => close(connection.socket)),
        Effect.uninterruptible,
      )

    const protocol = RpcServer.Protocol.of({
      run: write =>
        Effect.acquireUseRelease(
          Effect.sync(() => {
            receive = write
          }),
          () => ready.open.pipe(Effect.andThen(Effect.never)),
          () =>
            Effect.sync(() => {
              receive = undefined
            }),
        ),
      disconnects,
      send: (id, response) =>
        Effect.suspend(() => {
          const connection = byId.get(id)
          return connection === undefined ? Effect.void : send(connection, response)
        }),
      end: id =>
        Effect.suspend(() => {
          const connection = byId.get(id)
          return connection === undefined
            ? Effect.void
            : close(connection.socket, 1000, '')
        }),
      clientIds: Effect.sync(() => new Set(byId.keys())),
      initialMessage: Effect.succeedNone,
      supportsAck: true,
      supportsTransferables: false,
      supportsSpanPropagation: true,
      supportsNotifications: true,
      codecFor: serialization.codecFor,
    })

    const upgrade = () =>
      Effect.gen(function* () {
        yield* ready.await
        const pair = new WebSocketPair()
        const server = pair[1] as unknown as cf.WebSocket
        state.acceptWebSocket(server, [SOCKET_TAG])
        yield* persist(register(server, nextId))
        return new Response(null, { status: 101, webSocket: pair[0] })
      })

    const message = (socket: cf.WebSocket, data: string | ArrayBuffer) =>
      Effect.gen(function* () {
        yield* ready.await
        const connection = bySocket.get(socket)
        if (connection === undefined || receive === undefined) return yield* close(socket)
        const requests = connection.parser.decode(
          typeof data === 'string' ? data : new Uint8Array(data),
        ) as ReadonlyArray<RpcMessage.FromClientEncoded>
        for (const request of requests) {
          if (request._tag === 'Request') connection.pending.add(request.id)
        }
        yield* persist(connection)
        for (const request of requests) {
          if (!byId.has(connection.id)) return
          yield* receive(connection.id, request)
        }
      }).pipe(Effect.catchCause(() => close(socket)))

    return { protocol, upgrade, message, close: socket => close(socket, 1000, '') }
  })
