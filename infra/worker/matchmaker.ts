import * as Array from 'effect/Array'
import * as Clock from 'effect/Clock'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'

import type {
  DurableObjectState,
  WebSocket as WorkersWebSocket,
} from '@cloudflare/workers-types'
import {
  Matchmaking,
  ROOM_PATHS,
  RoomRefusal,
  type RoomTicket,
  cleanRank,
} from '@munch/netcode'
import { PING_JSON, PONG_JSON, verifyToken } from '@munch/sync-engine'

import {
  type Made,
  type MatchmakerHost,
  makeMatchmakerHost,
} from './matchmakerCore.ts'
import {
  LISTING_PATH,
  REGION_HEADER,
  createRoomIn,
  joinRoomIn,
  ticketOf,
} from './roomCalls.ts'
import type { SyncBindings } from './sync.ts'
import { json, tryCall } from './syncCore.ts'

// NOTE: QUICK PLAY's one Durable Object (named `matchmaker`). A player
// opens a WebSocket here and says Hello with the sync session token; the
// Matchmaker seats them in an open public room, or queues them until four
// are waiting or the smaller group accepts an offer (Matchmaking.ts). It
// keeps its state in storage and its queue in hibernating sockets, so it
// bills nothing while nobody waits; an alarm wakes it when an offer is due.
// Public rooms tell it how they stand at LISTING_PATH.

const QUICK_TAG = 'quick'
const STATE_KEY = 'state'

const Attachment = Schema.TaggedUnion({
  Opened: { socket: Schema.String, region: Schema.optionalKey(Schema.String) },
  Queued: {
    socket: Schema.String,
    playerId: Schema.String,
    name: Schema.String,
    look: Schema.optionalKey(Schema.String),
    rank: Schema.optionalKey(Schema.Number),
    region: Schema.optionalKey(Schema.String),
  },
})
type Attachment = typeof Attachment.Type

const decodeAttachment = Schema.decodeUnknownOption(Attachment)
const encodeAttachment = Schema.encodeSync(Attachment)
const decodeState = Schema.decodeUnknownOption(Matchmaking.MatchmakerJson)
const encodeState = Schema.encodeSync(Matchmaking.MatchmakerJson)
const decodeClient = Schema.decodeUnknownOption(Matchmaking.QuickClientJson)
const encodeServer = Schema.encodeSync(Matchmaking.QuickServerJson)
const decodeListing = Schema.decodeUnknownOption(
  Schema.fromJsonString(Matchmaking.RoomListing),
)

const unavailable = (): Result.Result<RoomTicket, RoomRefusal> =>
  Result.fail(RoomRefusal.cases.Unavailable.make({}))

const attachmentOf = (socket: WorkersWebSocket): Option.Option<Attachment> =>
  decodeAttachment(socket.deserializeAttachment())

export class Matchmaker {
  private host: Option.Option<MatchmakerHost> = Option.none()

  private readonly ctx: DurableObjectState
  private readonly env: SyncBindings

  constructor(ctx: DurableObjectState, env: SyncBindings) {
    this.ctx = ctx
    this.env = env
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(PING_JSON, PONG_JSON),
    )
  }

  private socketById(id: string): Option.Option<WorkersWebSocket> {
    return Array.findFirst(this.ctx.getWebSockets(QUICK_TAG), socket =>
      Option.exists(
        attachmentOf(socket),
        attachment => attachment.socket === id,
      ),
    )
  }

  private makeRoom(
    players: ReadonlyArray<Matchmaking.Queued>,
  ): Effect.Effect<Result.Result<Made, RoomRefusal>> {
    const rooms = this.env.GAME_ROOMS
    const [first, ...rest] = players
    if (rooms === undefined || first === undefined) {
      return Effect.succeed(Result.fail(RoomRefusal.cases.Unavailable.make({})))
    }
    return Effect.gen(function* () {
      const created = ticketOf(
        yield* createRoomIn(
          rooms,
          first.playerId,
          first.name,
          first.look ?? '',
          first.rank ?? 1,
          'Public',
          first.region ?? '',
        ),
      )
      if (Result.isFailure(created)) {
        return Result.fail(created.failure)
      }
      const code = created.success.code
      const joined = yield* Effect.forEach(rest, player =>
        Effect.map(
          joinRoomIn(
            rooms,
            code,
            player.playerId,
            player.name,
            player.look ?? '',
            player.rank ?? 1,
          ),
          called => ({
            socket: player.socket,
            ticket: ticketOf(called),
          }),
        ),
      )
      const made: Made = {
        code,
        tickets: [{ socket: first.socket, ticket: created }, ...joined],
      }
      return Result.succeed(made)
    }).pipe(
      Effect.catchTag('SyncCallFailed', () =>
        Effect.succeed(Result.fail(RoomRefusal.cases.Unavailable.make({}))),
      ),
    )
  }

  private hostOnce(): Effect.Effect<MatchmakerHost> {
    return Option.match(this.host, {
      onSome: Effect.succeed,
      onNone: () =>
        Effect.tap(
          makeMatchmakerHost({
            load: tryCall('read the queue', () =>
              this.ctx.storage.get<string>(STATE_KEY),
            ).pipe(
              Effect.map(stored =>
                Option.getOrElse(
                  Option.flatMap(Option.fromNullishOr(stored), decodeState),
                  () => Matchmaking.emptyMatchmaker,
                ),
              ),
              Effect.catchTag('SyncCallFailed', () =>
                Effect.succeed(Matchmaking.emptyMatchmaker),
              ),
            ),
            save: matchmaker =>
              tryCall('save the queue', () =>
                this.ctx.storage.put(STATE_KEY, encodeState(matchmaker)),
              ).pipe(Effect.ignore),
            send: (id, message) =>
              Effect.sync(() =>
                Option.map(this.socketById(id), socket =>
                  socket.send(encodeServer(message)),
                ),
              ),
            close: id =>
              Effect.sync(() =>
                Option.map(this.socketById(id), socket =>
                  socket.close(1000, 'Matched'),
                ),
              ),
            seat: (player, code) => {
              const rooms = this.env.GAME_ROOMS
              return rooms === undefined
                ? Effect.succeed(unavailable())
                : joinRoomIn(
                    rooms,
                    code,
                    player.playerId,
                    player.name,
                    player.look ?? '',
                    player.rank ?? 1,
                  ).pipe(
                    Effect.map(ticketOf),
                    Effect.catchTag('SyncCallFailed', () =>
                      Effect.succeed(unavailable()),
                    ),
                  )
            },
            makeRoom: players => this.makeRoom(players),
            wakeAt: atMs =>
              tryCall('set the alarm', () =>
                this.ctx.storage.setAlarm(atMs),
              ).pipe(Effect.ignore),
          }),
          host =>
            Effect.sync(() => {
              this.host = Option.some(host)
            }),
        ),
    })
  }

  private run(
    event: (
      matchmaker: Matchmaking.Matchmaker,
      nowMs: number,
    ) => Matchmaking.Stepped,
  ) {
    return Effect.flatMap(this.hostOnce(), host => host.run(event))
  }

  fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === ROOM_PATHS.quick) {
      const pair = new WebSocketPair()
      this.ctx.acceptWebSocket(pair[1], [QUICK_TAG])
      pair[1].serializeAttachment(
        encodeAttachment({
          _tag: 'Opened',
          // NOTE: a socket's id needs no Effect service.
          // @effect-diagnostics-next-line cryptoRandomUUID:off
          socket: crypto.randomUUID(),
          region: request.headers.get(REGION_HEADER) ?? '',
        }),
      )
      return Promise.resolve(
        new Response(null, { status: 101, webSocket: pair[0] }),
      )
    }
    if (url.pathname === LISTING_PATH && request.method === 'POST') {
      return Effect.runPromise(
        Effect.gen({ self: this }, function* () {
          const text = yield* tryCall('read the listing', () => request.text())
          const maybeListing = decodeListing(text)
          if (Option.isNone(maybeListing)) {
            return json(400, '{}')
          }
          const listing = maybeListing.value
          yield* this.run((matchmaker, nowMs) =>
            Matchmaking.listed(matchmaker, listing, nowMs),
          )
          return json(200, '{}')
        }).pipe(
          Effect.catchTag('SyncCallFailed', () =>
            Effect.succeed(json(500, '{}')),
          ),
        ),
      )
    }
    return Promise.resolve(json(404, '{}'))
  }

  webSocketMessage(
    socket: WorkersWebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    const maybeAttachment = attachmentOf(socket)
    const maybeMessage =
      typeof message === 'string' ? decodeClient(message) : Option.none()
    if (Option.isNone(maybeAttachment) || Option.isNone(maybeMessage)) {
      socket.close(1003, 'Unsupported')
      return Promise.resolve()
    }
    const attachment = maybeAttachment.value
    const said = maybeMessage.value
    return Effect.runPromise(
      Matchmaking.QuickClient.match(said, {
        Hello: hello => this.hello(socket, attachment, hello),
        Answer: ({ accept }) =>
          this.run((matchmaker, now) =>
            Matchmaking.answer(matchmaker, attachment.socket, accept, now),
          ),
        Cancel: () =>
          Effect.andThen(
            this.run((matchmaker, now) =>
              Matchmaking.leave(matchmaker, attachment.socket, now),
            ),
            Effect.sync(() => socket.close(1000, 'Cancelled')),
          ),
      }),
    )
  }

  // NOTE: a player says Hello once: a socket already queued ignores another.
  private hello(
    socket: WorkersWebSocket,
    attachment: Attachment,
    said: Matchmaking.QuickHello,
  ): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      if (attachment._tag === 'Queued') {
        return
      }
      const nowMs = yield* Clock.currentTimeMillis
      const claims = yield* Effect.result(
        verifyToken(this.env.SYNC_SECRET, said.token, nowMs),
      )
      if (Result.isFailure(claims)) {
        socket.send(
          encodeServer(
            Matchmaking.QuickServer.cases.Refused.make({
              reason: 'Unauthorized',
            }),
          ),
        )
        return socket.close(1008, 'Unauthorized')
      }
      socket.serializeAttachment(
        encodeAttachment({
          _tag: 'Queued',
          socket: attachment.socket,
          playerId: claims.success.playerId,
          name: said.name,
          look: said.look ?? '',
          rank: cleanRank(said.rank ?? 1),
          region: attachment.region ?? '',
        }),
      )
      const player: Matchmaking.Queued = {
        socket: attachment.socket,
        playerId: claims.success.playerId,
        name: said.name,
        look: said.look ?? '',
        rank: cleanRank(said.rank ?? 1),
        region: attachment.region ?? '',
        queuedMs: nowMs,
      }
      return yield* this.run((matchmaker, now) =>
        Matchmaking.arrive(matchmaker, player, now),
      )
    })
  }

  webSocketClose(
    socket: WorkersWebSocket,
    code: number,
    reason: string,
  ): Promise<void> {
    const maybeAttachment = attachmentOf(socket)
    socket.close(code, reason)
    return Option.match(maybeAttachment, {
      onNone: () => Promise.resolve(),
      onSome: attachment =>
        Effect.runPromise(
          this.run((matchmaker, now) =>
            Matchmaking.leave(matchmaker, attachment.socket, now),
          ),
        ),
    })
  }

  webSocketError(socket: WorkersWebSocket): Promise<void> {
    return this.webSocketClose(socket, 1011, 'Error')
  }

  alarm(): Promise<void> {
    return Effect.runPromise(this.run(Matchmaking.wake))
  }
}
