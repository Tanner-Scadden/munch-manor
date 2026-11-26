import type * as cf from '@cloudflare/workers-types'
import { Effect, Exit, Latch, Option, Queue, Schema } from 'effect'
import { Rpc, RpcMessage, RpcSerialization, RpcServer } from 'effect/rpc'

const SOCKET_TAG = 'rpc'
const RESTART_REASON = 'Durable Object woke with this request unfinished'

const SavedRequest = Schema.Struct({
  _tag: Schema.Literal('Request'),
  id: Schema.Union([Schema.String, Schema.Number]),
  tag: Schema.String,
  payload: Schema.Unknown,
  headers: Schema.Array(Schema.Tuple([Schema.String, Schema.String])),
})
type SavedRequest = typeof SavedRequest.Type

const Metadata = Schema.Struct({
  clientId: Schema.Number,
  session: Schema.optional(Schema.String),
  resumable: Schema.Array(SavedRequest),
  isOtherPending: Schema.Boolean,
})
const isMetadata = Schema.is(Metadata)

export interface ResumeOptions {
  readonly resumableTags: ReadonlySet<string>
  readonly sessionRpc: Rpc.AnyWithProps
  readonly sessionOf: (payload: unknown) => string | undefined
}

interface Connection {
  readonly id: number
  readonly socket: cf.WebSocket
  readonly parser: RpcSerialization.Parser
  readonly pending: Map<string, SavedRequest | undefined>
  readonly sessionRequests: Map<string, string>
  session: string | undefined
}

export interface Transport {
  readonly protocol: RpcServer.Protocol['Service']
  readonly upgrade: () => Effect.Effect<Response>
  readonly message: (
    socket: cf.WebSocket,
    data: string | ArrayBuffer,
  ) => Effect.Effect<void>
  readonly close: (socket: cf.WebSocket) => Effect.Effect<void>
  readonly sessionOf: (clientId: number) => string | undefined
  readonly resumedCount: number
  readonly restoreLog: ReadonlyArray<string>
  readonly describe: () => string
}

const savedOf = (request: RpcMessage.RequestEncoded): SavedRequest => ({
  _tag: 'Request',
  id: request.id,
  tag: request.tag,
  payload: request.payload,
  headers: request.headers,
})

export const makeTransport = (
  state: cf.DurableObjectState,
  options: ResumeOptions,
): Effect.Effect<Transport, never, RpcSerialization.RpcSerialization> =>
  Effect.gen(function* () {
    const serialization = yield* RpcSerialization.RpcSerialization
    const disconnects = yield* Queue.make<number>()
    const ready = yield* Latch.make()
    const bySocket = new Map<cf.WebSocket, Connection>()
    const byId = new Map<number, Connection>()
    const toResume: Array<[number, SavedRequest]> = []
    const restoreLog: Array<string> = []
    let nextId = 0
    const decodeSessionPayload = Schema.decodeUnknownOption(
      serialization.codecFor(options.sessionRpc.payloadSchema) as Schema.Codec<unknown, unknown>,
    )
    const decodeSessionExit = Schema.decodeUnknownOption(
      serialization.codecFor(Rpc.exitSchema(options.sessionRpc as never)) as Schema.Codec<
        Exit.Exit<unknown, unknown>,
        unknown
      >,
    )
    let receive:
      | Parameters<RpcServer.Protocol['Service']['run']>[0]
      | undefined

    const persist = (connection: Connection) =>
      Effect.sync(() => {
        const pending = [...connection.pending.values()]
        connection.socket.serializeAttachment({
          clientId: connection.id,
          session: connection.session,
          resumable: pending.filter(saved => saved !== undefined),
          isOtherPending: pending.some(saved => saved === undefined),
        })
      })

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

    const register = (
      socket: cf.WebSocket,
      id: number,
      session: string | undefined,
    ): Connection => {
      const connection: Connection = {
        id,
        socket,
        parser: serialization.makeUnsafe(),
        pending: new Map(),
        sessionRequests: new Map(),
        session,
      }
      bySocket.set(socket, connection)
      byId.set(id, connection)
      nextId = Math.max(nextId, id + 1)
      return connection
    }

    for (const socket of state.getWebSockets(SOCKET_TAG)) {
      const metadata: unknown = socket.deserializeAttachment()
      if (
        !isMetadata(metadata) ||
        metadata.isOtherPending ||
        byId.has(metadata.clientId) ||
        (metadata.resumable.length > 0 && metadata.session === undefined)
      ) {
        restoreLog.push(`closed: ${JSON.stringify(metadata, (_, v: unknown) => (v instanceof Uint8Array ? `bytes(${v.length})` : v))}`)
        yield* close(socket)
      } else {
        const connection = register(socket, metadata.clientId, metadata.session)
        for (const saved of metadata.resumable) {
          connection.pending.set(String(saved.id), saved)
          toResume.push([connection.id, saved])
        }
      }
    }
    const resumedCount = toResume.length

    const send = (connection: Connection, response: RpcMessage.FromServerEncoded) =>
      Effect.gen(function* () {
        if (!byId.has(connection.id)) return
        const encoded = connection.parser.encode(response)
        if (encoded === undefined) return yield* close(connection.socket)
        connection.socket.send(encoded)
        if (response._tag === 'Exit') {
          const id = String(response.requestId)
          const session = connection.sessionRequests.get(id)
          connection.sessionRequests.delete(id)
          if (
            session !== undefined &&
            Option.exists(decodeSessionExit(response.exit), Exit.isSuccess)
          ) {
            connection.session = session
          }
          connection.pending.delete(id)
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
          Effect.gen(function* () {
            receive = write
            for (const [clientId, saved] of toResume.splice(0)) {
              if (byId.has(clientId)) {
                yield* write(clientId, {
                  ...saved,
                  headers: saved.headers.map(([key, value]) => [key, value] as [string, string]),
                })
              }
            }
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
        yield* persist(register(server, nextId, undefined))
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
          if (request._tag !== 'Request' || request.isNotification === true) continue
          const id = String(request.id)
          connection.pending.set(
            id,
            options.resumableTags.has(request.tag) ? savedOf(request) : undefined,
          )
          const session =
            request.tag === options.sessionRpc._tag
              ? Option.getOrUndefined(
                  Option.flatMapNullishOr(decodeSessionPayload(request.payload), options.sessionOf),
                )
              : undefined
          if (session !== undefined) connection.sessionRequests.set(id, session)
        }
        yield* persist(connection)
        for (const request of requests) {
          if (!byId.has(connection.id)) return
          yield* receive(connection.id, request)
        }
      }).pipe(Effect.catchCause(() => close(socket)))

    return {
      protocol,
      upgrade,
      message,
      close: socket => close(socket, 1000, ''),
      sessionOf: clientId => byId.get(clientId)?.session,
      resumedCount,
      restoreLog,
      describe: () =>
        [...byId.values()]
          .map(c => `live ${c.id} session=${c.session ?? '-'} pending=${[...c.pending.keys()].join(',')} sessionRequests=${[...c.sessionRequests.keys()].join(',')}`)
          .join('\n'),
    }
  })
