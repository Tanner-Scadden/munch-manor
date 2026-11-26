import { Array, Function, Predicate } from 'effect'
import * as Effect from 'effect/Effect'
import * as Latch from 'effect/Latch'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Schema from 'effect/Schema'
import type { RpcMessage } from 'effect/rpc'
import { RpcSerialization, RpcServer } from 'effect/rpc'

import type {
  DurableObjectState,
  WebSocket as WorkersWebSocket,
} from '@cloudflare/workers-types'

const SOCKET_TAG = 'rpc'
const RESTART_CODE = 1012
const RESTART_REASON = 'Woke with this request unfinished'

const SavedRequest = Schema.TaggedStruct('Request', {
  id: Schema.Union([Schema.String, Schema.Finite]),
  tag: Schema.String,
  payload: Schema.Unknown,
  headers: Schema.Array(Schema.Tuple([Schema.String, Schema.String])),
})
type SavedRequest = typeof SavedRequest.Type

const Attachment = Schema.Struct({
  clientId: Schema.Finite,
  session: Schema.optionalKey(Schema.String),
  resumable: Schema.Array(SavedRequest),
  isOtherPending: Schema.Boolean,
})
type Attachment = typeof Attachment.Type
const decodeAttachment = Schema.decodeUnknownOption(Attachment)

const CLIENT_TAGS: ReadonlySet<unknown> = new Set([
  'Request',
  'Ack',
  'Interrupt',
  'Ping',
  'Eof',
])

const isFromClient = (
  message: unknown,
): message is RpcMessage.FromClientEncoded =>
  Predicate.hasProperty(message, '_tag') && CLIENT_TAGS.has(message._tag)

export interface ResumeOptions {
  readonly resumableTags: ReadonlySet<string>
  readonly sessionTag: string
  readonly sessionOf: (payload: unknown) => Option.Option<string>
}

interface Connection {
  readonly id: number
  readonly socket: WorkersWebSocket
  readonly parser: RpcSerialization.Parser
  readonly pending: Map<string, Option.Option<SavedRequest>>
  readonly sessionRequests: Map<string, string>
  session: Option.Option<string>
}

export interface HibernatingTransport {
  readonly protocol: RpcServer.Protocol['Service']
  readonly upgrade: Effect.Effect<Response>
  readonly message: (
    socket: WorkersWebSocket,
    data: string | ArrayBuffer,
  ) => Effect.Effect<void>
  readonly close: (socket: WorkersWebSocket) => Effect.Effect<void>
  readonly sessionOf: (clientId: number) => Option.Option<string>
}

const savedOf = (request: RpcMessage.RequestEncoded): SavedRequest => ({
  _tag: 'Request',
  id: request.id,
  tag: request.tag,
  payload: request.payload,
  headers: request.headers,
})

const requestOf = (saved: SavedRequest): RpcMessage.RequestEncoded => ({
  ...saved,
  headers: Array.map(saved.headers, ([key, value]): [string, string] => [
    key,
    value,
  ]),
})

const attachmentOf = (connection: Connection): Attachment => {
  const pending = globalThis.Array.from(connection.pending.values())
  return {
    clientId: connection.id,
    ...Option.match(connection.session, {
      onNone: () => ({}),
      onSome: session => ({ session }),
    }),
    resumable: Array.getSomes(pending),
    isOtherPending: Array.some(pending, Option.isNone),
  }
}

const isRestorable = (
  attachment: Attachment,
  isTaken: (clientId: number) => boolean,
): boolean =>
  !attachment.isOtherPending &&
  !isTaken(attachment.clientId) &&
  (attachment.resumable.length === 0 || attachment.session !== undefined)

const isSessionSuccess = (response: RpcMessage.FromServerEncoded): boolean =>
  response._tag === 'Exit' && response.exit._tag === 'Success'

type TransportEffect = Effect.Effect<
  HibernatingTransport,
  never,
  RpcSerialization.RpcSerialization
>

export const makeTransport: {
  (options: ResumeOptions): (state: DurableObjectState) => TransportEffect
  (state: DurableObjectState, options: ResumeOptions): TransportEffect
} = Function.dual(
  2,
  (state: DurableObjectState, options: ResumeOptions): TransportEffect =>
    Effect.gen(function* () {
      const serialization = yield* RpcSerialization.RpcSerialization
      const disconnects = yield* Queue.make<number>()
      const ready = yield* Latch.make()
      const bySocket = new Map<WorkersWebSocket, Connection>()
      const byId = new Map<number, Connection>()
      const toResume: Array<readonly [number, SavedRequest]> = []
      const writer: {
        receive: Option.Option<
          (
            clientId: number,
            message: RpcMessage.FromClientEncoded,
          ) => Effect.Effect<void>
        >
        nextId: number
      } = { receive: Option.none(), nextId: 0 }

      const persist = (connection: Connection) =>
        Effect.sync(() => {
          connection.socket.serializeAttachment(attachmentOf(connection))
        })

      const closeWith = (
        socket: WorkersWebSocket,
        code: number,
        reason: string,
      ): Effect.Effect<void> =>
        Effect.gen(function* () {
          yield* Effect.ignore(
            Effect.try({
              try: () => socket.close(code, reason),
              catch: () => 'closed already',
            }),
          )
          const connection = bySocket.get(socket)
          if (connection === undefined) {
            return
          }
          bySocket.delete(socket)
          byId.delete(connection.id)
          Queue.offerUnsafe(disconnects, connection.id)
        })

      const register = (
        socket: WorkersWebSocket,
        id: number,
        session: Option.Option<string>,
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
        writer.nextId = Math.max(writer.nextId, id + 1)
        return connection
      }

      yield* Effect.forEach(
        state.getWebSockets(SOCKET_TAG),
        socket => {
          const maybeAttachment = Option.filter(
            decodeAttachment(socket.deserializeAttachment()),
            attachment => isRestorable(attachment, id => byId.has(id)),
          )
          if (Option.isNone(maybeAttachment)) {
            return closeWith(socket, RESTART_CODE, RESTART_REASON)
          }
          const attachment = maybeAttachment.value
          const connection = register(
            socket,
            attachment.clientId,
            Option.fromNullishOr(attachment.session),
          )
          Array.forEach(attachment.resumable, saved => {
            connection.pending.set(
              globalThis.String(saved.id),
              Option.some(saved),
            )
            toResume.push([connection.id, saved])
          })
          return Effect.void
        },
        { discard: true },
      )

      const settleExit = (
        connection: Connection,
        response: RpcMessage.ResponseExitEncoded,
      ) =>
        Effect.suspend(() => {
          const id = globalThis.String(response.requestId)
          const session = connection.sessionRequests.get(id)
          connection.sessionRequests.delete(id)
          if (session !== undefined && isSessionSuccess(response)) {
            connection.session = Option.some(session)
          }
          connection.pending.delete(id)
          return persist(connection)
        })

      const send = (
        connection: Connection,
        response: RpcMessage.FromServerEncoded,
      ): Effect.Effect<void> =>
        Effect.gen(function* () {
          if (!byId.has(connection.id)) {
            return
          }
          const encoded = connection.parser.encode(response)
          if (encoded === undefined) {
            return yield* closeWith(connection.socket, 1011, 'Unencodable')
          }
          connection.socket.send(encoded)
          if (response._tag === 'Exit') {
            yield* settleExit(connection, response)
          }
          if (
            response._tag === 'Defect' ||
            response._tag === 'ClientProtocolError'
          ) {
            yield* closeWith(connection.socket, 1011, response._tag)
          }
        }).pipe(
          Effect.catchCause(() => closeWith(connection.socket, 1011, 'Error')),
          Effect.uninterruptible,
        )

      const protocol = RpcServer.Protocol.of({
        run: write =>
          Effect.acquireUseRelease(
            Effect.gen(function* () {
              writer.receive = Option.some(write)
              yield* Effect.forEach(
                toResume.splice(0),
                ([clientId, saved]) =>
                  byId.has(clientId)
                    ? write(clientId, requestOf(saved))
                    : Effect.void,
                { discard: true },
              )
            }),
            () => Effect.andThen(ready.open, Effect.never),
            () =>
              Effect.sync(() => {
                writer.receive = Option.none()
              }),
          ),
        disconnects,
        send: (id, response) =>
          Effect.suspend(() => {
            const connection = byId.get(id)
            return connection === undefined
              ? Effect.void
              : send(connection, response)
          }),
        end: id =>
          Effect.suspend(() => {
            const connection = byId.get(id)
            return connection === undefined
              ? Effect.void
              : closeWith(connection.socket, 1000, '')
          }),
        clientIds: Effect.sync(() => new Set(byId.keys())),
        initialMessage: Effect.succeedNone,
        supportsAck: true,
        supportsTransferables: false,
        supportsSpanPropagation: true,
        supportsNotifications: true,
        codecFor: serialization.codecFor,
      })

      const upgrade = Effect.gen(function* () {
        yield* ready.await
        const pair = new WebSocketPair()
        const server = pair[1]
        state.acceptWebSocket(server, [SOCKET_TAG])
        yield* persist(register(server, writer.nextId, Option.none()))
        return new Response(null, { status: 101, webSocket: pair[0] })
      })

      const note = (
        connection: Connection,
        request: RpcMessage.RequestEncoded,
      ): void => {
        const id = globalThis.String(request.id)
        connection.pending.set(
          id,
          options.resumableTags.has(request.tag)
            ? Option.some(savedOf(request))
            : Option.none(),
        )
        if (request.tag === options.sessionTag) {
          Option.map(options.sessionOf(request.payload), session =>
            connection.sessionRequests.set(id, session),
          )
        }
      }

      const message = (socket: WorkersWebSocket, data: string | ArrayBuffer) =>
        Effect.gen(function* () {
          yield* ready.await
          const connection = bySocket.get(socket)
          if (connection === undefined || Option.isNone(writer.receive)) {
            return yield* closeWith(socket, RESTART_CODE, RESTART_REASON)
          }
          const receive = writer.receive.value
          const decoded = connection.parser.decode(
            typeof data === 'string' ? data : new Uint8Array(data),
          )
          const messages = Array.filter(decoded, isFromClient)
          Array.forEach(messages, request => {
            if (request._tag === 'Request' && request.isNotification !== true) {
              note(connection, request)
            }
          })
          yield* persist(connection)
          yield* Effect.forEach(
            messages,
            request =>
              byId.has(connection.id)
                ? receive(connection.id, request)
                : Effect.void,
            { discard: true },
          )
        }).pipe(Effect.catchCause(() => closeWith(socket, 1011, 'Error')))

      return {
        protocol,
        upgrade,
        message,
        close: socket => closeWith(socket, 1000, ''),
        sessionOf: clientId =>
          Option.flatMap(
            Option.fromNullishOr(byId.get(clientId)),
            connection => connection.session,
          ),
      }
    }),
)
