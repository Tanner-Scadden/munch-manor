import * as Array from 'effect/Array'
import * as Clock from 'effect/Clock'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'
import * as Semaphore from 'effect/Semaphore'

import type {
  DurableObjectNamespace,
  DurableObjectState,
  WebSocket as WorkersWebSocket,
} from '@cloudflare/workers-types'
import {
  type ClosedReason,
  CreateRequest,
  JoinRequest,
  type Lobby,
  ROOM_PATHS,
  Room,
  RoomRefusal,
  RoomTicket,
  type World as RoomWorldOf,
  SERVER_VERSIONS,
  ServerFrame,
  decodeClientFrame,
  encodeServerFrame,
  normalizeRoomCode,
  roomCodeOfScope,
  roomRefusalStatus,
  roomScopeId,
} from '@munch/netcode'
import {
  Connection,
  IDENTITY_PATHS,
  OPENED,
  PING_JSON,
  PONG_JSON,
  verifyToken,
} from '@munch/sync-engine'

import {
  type OwnSeat,
  type RoomWorld,
  roomSettingsOf,
  roomWorldFor,
} from '../../src/roomWorld.ts'
import type { World as GameState } from '../../src/world.ts'
import { worldFromJson, worldToJson } from '../../src/worldWire.ts'
import {
  INTERNAL_PATHS,
  InternalCreate,
  InternalJoin,
  ROOM_CODE_HEADER,
  type RoomHost,
  STALLED_LOOP_MS,
  answerHello,
  decideAlarm,
  listingOf,
  reactionsOf,
  roomHostOnce,
} from './gameRoomCore.ts'
import {
  MATCHMAKER_NAME,
  REGION_HEADER,
  continentOf,
  createRoomIn,
  joinRoomIn,
  reportListing,
} from './roomCalls.ts'
import type { SyncBindings } from './sync.ts'
import type { SyncCallFailed } from './syncCore.ts'
import {
  BadSyncBody,
  CORS_HEADERS,
  type Socket,
  type SyncSetupFailed,
  bearerOf,
  json,
  readNightmareUnlock,
  sqlOf,
  syncErrorResponse,
  tryCall,
} from './syncCore.ts'

// NOTE: one co-op room per Durable Object, named `room:<code>`. It holds
// the room's lobby scope (its SQLite storage, through the sync engine) and,
// while a game runs, the game itself in memory: the pure Room from
// @munch/netcode, stepped by a timer loop about every 50 ms, which keeps
// the object awake. In the lobby there is no timer, so it hibernates with
// its sockets open. An alarm is the watchdog: it restarts a stalled loop,
// records a game the object lost to a restart as Interrupted, and deletes
// a room a day after its last change. The run starts when the lobby's last
// READY makes it Playing. A public room tells the Matchmaker (matchmaker.ts)
// whenever its lobby changes. See MULTIPLAYER.md, Phase 2 and 3.
//
// The world is the game's own (src/roomWorld.ts): `stepWorld` over the
// lobby's seats, with the mode and difficulty the host picked. A won
// campaign's last World is kept in storage, so the next run can keep going
// into endless (Lobby.ts, KeepGoing) even after the object hibernates.

export type GameRoomBindings = SyncBindings

type GameWorld = RoomWorld
type GameRules = RoomWorldOf<GameWorld, OwnSeat>

const KEPT_KEY = 'kept-world'

const SCOPE_HEADER = 'x-sync-scope'
const GAME_TAG = 'game'
const SYNC_TAG = 'sync'

const Attachment = Schema.TaggedUnion({
  Sync: { scope: Schema.String, connection: Connection },
  GameOpened: { scope: Schema.String, socket: Schema.String },
  GameJoined: {
    scope: Schema.String,
    socket: Schema.String,
    playerId: Schema.String,
  },
})
type Attachment = typeof Attachment.Type
type SyncAttachment = typeof Attachment.cases.Sync.Type
type GameAttachment =
  | typeof Attachment.cases.GameOpened.Type
  | typeof Attachment.cases.GameJoined.Type

const decodeAttachment = Schema.decodeUnknownOption(Attachment)
const encodeAttachment = Schema.encodeSync(Attachment)

const attachmentOf = (socket: WorkersWebSocket): Option.Option<Attachment> =>
  decodeAttachment(socket.deserializeAttachment())

interface Game {
  readonly world: GameRules
  readonly room: Room.Room<GameWorld>
  readonly round: number
  readonly advancedMs: number
}

const sendFrame = (socket: WorkersWebSocket, frame: ServerFrame) =>
  Result.match(encodeServerFrame(frame), {
    onFailure: () => undefined,
    onSuccess: bytes => {
      socket.send(bytes)
    },
  })

export class GameRoom {
  private readonly lock = Semaphore.makeUnsafe(1)
  private host: Option.Option<Effect.Effect<RoomHost, SyncSetupFailed>> =
    Option.none()
  private game: Option.Option<Game> = Option.none()
  private loop: Option.Option<Fiber.Fiber<void>> = Option.none()

  private readonly ctx: DurableObjectState
  private readonly env: GameRoomBindings

  constructor(ctx: DurableObjectState, env: GameRoomBindings) {
    this.ctx = ctx
    this.env = env
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(PING_JSON, PONG_JSON),
    )
  }

  // SETUP

  // NOTE: the room's code is in its own table once created, so the alarm
  // can find its scope with no socket open.
  private storedScope(): Effect.Effect<Option.Option<string>> {
    return Effect.try({
      try: () =>
        Option.flatMap(
          Option.fromNullishOr(
            this.ctx.storage.sql
              .exec('SELECT code FROM room WHERE id = 1')
              .toArray()[0],
          ),
          row => {
            const code = row['code']
            return typeof code === 'string'
              ? Option.map(normalizeRoomCode(code), roomScopeId)
              : Option.none()
          },
        ),
      catch: () => Option.none<string>(),
    }).pipe(Effect.catch(none => Effect.succeed(none)))
  }

  private hostFor(scope: string): Effect.Effect<RoomHost, SyncSetupFailed> {
    return Effect.suspend(() =>
      Option.getOrElse(this.host, () => {
        const once = Effect.runSync(
          roomHostOnce(sqlOf(this.ctx.storage), scope, this.env.SYNC_SECRET),
        )
        this.host = Option.some(once)
        return once
      }),
    )
  }

  private isNamed(scope: string): boolean {
    const rooms = this.env.GAME_ROOMS
    return rooms !== undefined && this.ctx.id.equals(rooms.idFromName(scope))
  }

  // SOCKETS

  private syncSockets(): ReadonlyArray<
    Socket & {
      readonly playerId: Option.Option<string>
      readonly close: () => void
    }
  > {
    return Array.getSomes(
      Array.map(this.ctx.getWebSockets(SYNC_TAG), socket =>
        Option.flatMap(attachmentOf(socket), attachment =>
          attachment._tag === 'Sync'
            ? Option.some({
                connection: attachment.connection,
                playerId:
                  attachment.connection._tag === 'Joined'
                    ? Option.some(attachment.connection.playerId)
                    : Option.none(),
                send: (message: string) => {
                  socket.send(message)
                },
                setConnection: (connection: Connection) => {
                  socket.serializeAttachment(
                    encodeAttachment({
                      _tag: 'Sync',
                      scope: attachment.scope,
                      connection,
                    }),
                  )
                },
                close: () => socket.close(4001, 'Removed'),
              })
            : Option.none(),
        ),
      ),
    )
  }

  private gameSockets(): ReadonlyArray<{
    readonly socket: WorkersWebSocket
    readonly id: string
    readonly playerId: Option.Option<string>
  }> {
    return Array.getSomes(
      Array.map(this.ctx.getWebSockets(GAME_TAG), socket =>
        Option.flatMap(attachmentOf(socket), attachment =>
          Attachment.match(attachment, {
            GameOpened: opened =>
              Option.some({
                socket,
                id: opened.socket,
                playerId: Option.none<string>(),
              }),
            GameJoined: joined =>
              Option.some({
                socket,
                id: joined.socket,
                playerId: Option.some(joined.playerId),
              }),
            Sync: () => Option.none(),
          }),
        ),
      ),
    )
  }

  private accept(tag: string, attachment: Attachment): Response {
    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    this.ctx.acceptWebSocket(server, [tag])
    server.serializeAttachment(encodeAttachment(attachment))
    return new Response(null, { status: 101, webSocket: client })
  }

  // GAME

  private apply(
    out: ReadonlyArray<Room.Out>,
    host: RoomHost,
  ): Effect.Effect<void> {
    const sockets = this.gameSockets()
    const byId = (id: string) =>
      Array.findFirst(sockets, entry => entry.id === id)
    const game = this.game
    const everyone = () => this.syncSockets()
    return Effect.forEach(
      out,
      item =>
        Match.valueTags(item, {
          Send: ({ socket, frame }) =>
            Effect.sync(() =>
              Option.map(byId(socket), entry => sendFrame(entry.socket, frame)),
            ),
          Close: ({ socket }) =>
            Effect.sync(() =>
              Option.map(byId(socket), entry =>
                entry.socket.close(1000, 'Done'),
              ),
            ),
          FreedSeat: ({ playerId }) =>
            this.lock.withPermit(
              host.freeSeat(
                playerId,
                Option.match(game, {
                  onNone: () => 0,
                  onSome: current => current.round,
                }),
                everyone(),
              ),
            ),
          Ended: ended => this.finish(ended, host),
        }),
      { discard: true },
    )
  }

  private finish(ended: Room.Ended, host: RoomHost): Effect.Effect<void> {
    const round = Option.match(this.game, {
      onNone: () => 0,
      onSome: game => game.round,
    })
    const rtts = Option.match(this.game, {
      onNone: () => [],
      onSome: game => Room.rttsOf(game.room),
    })
    const maybeWon = Option.filter(
      Option.map(this.game, game => game.room.world.world),
      () => ended.reason === 'Won',
    )
    this.game = Option.none()
    const stopLoop = Option.match(this.loop, {
      onNone: () => Effect.void,
      onSome: fiber => Effect.asVoid(Fiber.interrupt(fiber)),
    })
    this.loop = Option.none()
    const everyone = this.syncSockets()
    return Effect.gen({ self: this }, function* () {
      yield* Effect.logInfo(
        `Room game ${round} ended (${ended.reason}) at tick ${ended.tick}; round trips`,
        rtts,
      )
      yield* Option.match(maybeWon, {
        onNone: () => Effect.void,
        onSome: world => this.keep(world),
      })
      yield* this.lock.withPermit(
        host.recordResult(
          {
            round,
            reason: ended.reason,
            ticks: ended.tick,
            scores: ended.scores,
          },
          everyone,
        ),
      )
      yield* this.list(host)
      yield* stopLoop
    })
  }

  private tickLoop(host: RoomHost): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      const current = this.game
      if (Option.isNone(current)) {
        return
      }
      const nowMs = yield* Clock.currentTimeMillis
      const stepped = Room.advance(
        current.value.world,
        current.value.room,
        nowMs,
      )
      this.game = Option.some({
        world: current.value.world,
        room: stepped.room,
        round: current.value.round,
        advancedMs: nowMs,
      })
      yield* this.apply(stepped.out, host)
      if (Option.isNone(this.game)) {
        return
      }
      const after = yield* Clock.currentTimeMillis
      yield* Effect.sleep(Math.max(1, Room.nextWakeMs(stepped.room) - after))
      return yield* this.tickLoop(host)
    })
  }

  private startLoop(host: RoomHost): void {
    Option.map(this.loop, fiber => Effect.runFork(Fiber.interrupt(fiber)))
    this.loop = Option.some(Effect.runFork(this.tickLoop(host)))
  }

  private startGame(host: RoomHost): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      const maybeLobby = yield* host.lobby
      if (
        Option.isNone(maybeLobby) ||
        maybeLobby.value.status !== 'Playing' ||
        Option.isSome(this.game)
      ) {
        return
      }
      const lobby = maybeLobby.value
      const sockets = this.gameSockets()
      const nowMs = yield* Clock.currentTimeMillis
      const seed = crypto.getRandomValues(new Uint32Array(1))[0] ?? nowMs
      const isNightmareOpen = yield* this.nightmareOf(lobby.host)
      const maybeKept = Option.filter(
        lobby.mode === 'KeepGoing' ? yield* this.kept : Option.none(),
        kept => kept.difficulty.chosen !== 'Nightmare' || isNightmareOpen,
      )
      yield* this.forgetKept
      const world = roomWorldFor(
        roomSettingsOf(
          lobby.mode,
          lobby.difficulty === 'Nightmare' && !isNightmareOpen
            ? 'Hard'
            : lobby.difficulty,
        ),
        maybeKept,
      )
      const started = Room.startRoom(
        world,
        Array.map(lobby.members, member => ({
          slot: member.slot,
          playerId: member.playerId,
          socket: Option.map(
            Array.findLast(sockets, entry =>
              Option.exists(
                entry.playerId,
                playerId => playerId === member.playerId,
              ),
            ),
            entry => entry.id,
          ),
        })),
        seed,
        nowMs,
      )
      this.game = Option.some({
        world,
        room: started.room,
        round: lobby.round,
        advancedMs: nowMs,
      })
      yield* this.apply(started.out, host)
      this.startLoop(host)
      yield* tryCall('set the watchdog', () =>
        this.ctx.storage.setAlarm(nowMs + 60 * 1000),
      ).pipe(Effect.ignore)
    })
  }

  private endGame(host: RoomHost, reason: ClosedReason): Effect.Effect<void> {
    return Option.match(this.game, {
      onNone: () => Effect.void,
      onSome: game =>
        this.apply(Room.endRoom(game.world, game.room, reason), host),
    })
  }

  private dropPlayer(
    playerId: string,
    kicked: boolean,
    host: RoomHost,
  ): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      yield* host.forget(playerId)
      Array.forEach(this.syncSockets(), socket => {
        if (Option.exists(socket.playerId, id => id === playerId)) {
          socket.close()
        }
      })
      const game = this.game
      if (Option.isSome(game)) {
        const dropped = Room.dropPlayer(
          game.value.world,
          game.value.room,
          playerId,
          kicked,
        )
        this.game = Option.some({ ...game.value, room: dropped.room })
        return yield* this.apply(dropped.out, host)
      }
      Array.forEach(this.gameSockets(), entry => {
        if (Option.exists(entry.playerId, id => id === playerId)) {
          if (kicked) {
            sendFrame(entry.socket, ServerFrame.cases.Kicked.make({}))
          }
          entry.socket.close(1000, kicked ? 'Kicked' : 'Left')
        }
      })
    })
  }

  private react(
    deltas: Parameters<typeof reactionsOf>[0],
    host: RoomHost,
  ): Effect.Effect<void> {
    return Effect.flatMap(reactionsOf(deltas), reactions =>
      Effect.andThen(
        Effect.forEach(
          reactions,
          reaction =>
            Match.valueTags(reaction, {
              MaybeStart: () => this.startGame(host),
              EndGame: () => this.endGame(host, 'EndedByHost'),
              DropPlayer: ({ playerId, kicked }) =>
                this.dropPlayer(playerId, kicked, host),
            }),
          { discard: true },
        ),
        Array.isReadonlyArrayNonEmpty(deltas) ? this.list(host) : Effect.void,
      ),
    )
  }

  // NOTE: a public room tells the Matchmaker how it stands after a change,
  // without waiting: the Matchmaker may call back to seat someone.
  private list(host: RoomHost): Effect.Effect<void> {
    const matchmakers = this.env.MATCHMAKER
    return Effect.flatMap(host.lobby, maybeLobby =>
      Option.match(Option.flatMap(maybeLobby, listingOf), {
        onNone: () => Effect.void,
        onSome: listing =>
          Effect.sync(() => {
            Effect.runFork(reportListing(matchmakers, listing))
          }),
      }),
    )
  }

  // NIGHTMARE

  // NOTE: read from the player's own scope on the server each time it
  // matters: when the room seats them and when a run starts, so a
  // Nightmare run or a kept Nightmare run never rests on a client's word.
  private nightmareOf(playerId: string): Effect.Effect<boolean> {
    const scopes = this.env.SYNC_SCOPES
    return readNightmareUnlock(
      (scope, url, headers) =>
        scopes.get(scopes.idFromName(scope)).fetch(url, { headers }),
      playerId,
    )
  }

  // KEPT RUN

  private keep(world: GameState): Effect.Effect<void> {
    return tryCall('keep the won run', () =>
      this.ctx.storage.put(KEPT_KEY, worldToJson(world)),
    ).pipe(Effect.ignore)
  }

  private get kept(): Effect.Effect<Option.Option<GameState>> {
    return tryCall('read the kept run', () =>
      this.ctx.storage.get<string>(KEPT_KEY),
    ).pipe(
      Effect.flatMap(text =>
        Effect.try({
          try: () =>
            typeof text === 'string'
              ? Option.some(worldFromJson(text))
              : Option.none(),
          catch: () => Option.none<GameState>(),
        }),
      ),
      Effect.catch(() => Effect.succeedNone),
    )
  }

  private get forgetKept(): Effect.Effect<void> {
    return tryCall('forget the kept run', () =>
      this.ctx.storage.delete(KEPT_KEY),
    ).pipe(Effect.ignore)
  }

  // HTTP

  private handle(
    request: Request,
  ): Effect.Effect<Response, SyncSetupFailed | SyncCallFailed | BadSyncBody> {
    const url = new URL(request.url)
    const scope =
      request.headers.get(SCOPE_HEADER) ??
      roomScopeId(request.headers.get(ROOM_CODE_HEADER) ?? '')
    if (Option.isNone(roomCodeOfScope(scope)) || !this.isNamed(scope)) {
      return Effect.succeed(
        json(400, '{"_tag":"BadRequest","reason":"Wrong room"}'),
      )
    }
    const hostFor = this.hostFor(scope)
    return Effect.gen({ self: this }, function* () {
      const host = yield* hostFor
      if (url.pathname === IDENTITY_PATHS.socket) {
        return this.accept(SYNC_TAG, {
          _tag: 'Sync',
          scope,
          connection: OPENED,
        })
      }
      if (url.pathname === ROOM_PATHS.socket) {
        return this.accept(GAME_TAG, {
          _tag: 'GameOpened',
          scope,
          // NOTE: a socket's id needs no Effect service.
          // @effect-diagnostics-next-line cryptoRandomUUIDInEffect:off
          socket: crypto.randomUUID(),
        })
      }
      if (url.pathname === IDENTITY_PATHS.exchange) {
        const body = yield* tryCall('read the body', () => request.text())
        const everyone = this.syncSockets()
        const result = yield* this.lock.withPermit(
          Effect.suspend(() => host.scope.exchangeWith(body, everyone)),
        )
        yield* this.react(result.applied, host)
        return result.response
      }
      if (url.pathname === INTERNAL_PATHS.create) {
        const text = yield* tryCall('read the body', () => request.text())
        const body = yield* Effect.mapError(
          Schema.decodeEffect(InternalCreate)(text),
          error => new BadSyncBody({ reason: error.message }),
        )
        const nightmare = yield* this.nightmareOf(body.playerId)
        const created = yield* this.lock.withPermit(
          host.create(
            body.playerId,
            body.name,
            body.look ?? '',
            body.rank ?? 1,
            nightmare,
            body.code,
            body.visibility,
          ),
        )
        if (Result.isSuccess(created)) {
          const nowMs = yield* Clock.currentTimeMillis
          yield* tryCall('set the cleanup alarm', () =>
            this.ctx.storage.setAlarm(nowMs + 24 * 60 * 60 * 1000),
          ).pipe(Effect.ignore)
          yield* this.list(host)
        }
        return ticketResponse(created)
      }
      if (url.pathname === INTERNAL_PATHS.join) {
        const text = yield* tryCall('read the body', () => request.text())
        const body = yield* Effect.mapError(
          Schema.decodeEffect(InternalJoin)(text),
          error => new BadSyncBody({ reason: error.message }),
        )
        const nightmare = yield* this.nightmareOf(body.playerId)
        const everyone = this.syncSockets()
        const joined = yield* this.lock.withPermit(
          host.join(
            body.playerId,
            body.name,
            body.look ?? '',
            body.rank ?? 1,
            nightmare,
            everyone,
          ),
        )
        yield* this.list(host)
        return ticketResponse(joined)
      }
      return json(404, '{}')
    })
  }

  fetch(request: Request): Promise<Response> {
    return Effect.runPromise(syncErrorResponse(this.handle(request)))
  }

  // MESSAGES

  private onSync(
    socket: WorkersWebSocket,
    attachment: SyncAttachment,
    message: string,
  ): Effect.Effect<void, SyncSetupFailed> {
    return Effect.gen({ self: this }, function* () {
      const host = yield* this.hostFor(attachment.scope)
      const self: Socket = {
        connection: attachment.connection,
        send: text => {
          socket.send(text)
        },
        setConnection: connection => {
          socket.serializeAttachment(
            encodeAttachment({
              _tag: 'Sync',
              scope: attachment.scope,
              connection,
            }),
          )
        },
      }
      const everyone = this.syncSockets()
      const applied = yield* this.lock.withPermit(
        Effect.suspend(() => host.scope.onMessage(self, message, everyone)),
      )
      yield* this.react(applied, host)
    })
  }

  private onGame(
    socket: WorkersWebSocket,
    attachment: GameAttachment,
    bytes: Uint8Array,
  ): Effect.Effect<void, SyncSetupFailed> {
    return Effect.gen({ self: this }, function* () {
      const host = yield* this.hostFor(attachment.scope)
      const nowMs = yield* Clock.currentTimeMillis
      const decoded = decodeClientFrame(bytes)
      if (Result.isFailure(decoded)) {
        return refuseAndClose(socket, 'BadMessage')
      }
      const frame = decoded.success
      if (attachment._tag === 'GameOpened') {
        const answer = yield* answerHello(
          frame,
          this.env.SYNC_SECRET,
          yield* host.lobby,
          nowMs,
        )
        if (answer._tag === 'Refuse') {
          return refuseAndClose(socket, answer.reason)
        }
        socket.serializeAttachment(
          encodeAttachment({
            _tag: 'GameJoined',
            scope: attachment.scope,
            socket: attachment.socket,
            playerId: answer.playerId,
          }),
        )
        const game = this.game
        const linked = Option.flatMap(game, current =>
          Room.link(
            current.world,
            current.room,
            answer.playerId,
            attachment.socket,
            nowMs,
          ),
        )
        if (Option.isSome(game) && Option.isSome(linked)) {
          this.game = Option.some({ ...game.value, room: linked.value.room })
          return yield* this.apply(linked.value.out, host)
        }
        sendFrame(
          socket,
          ServerFrame.cases.Welcome.make({
            version: answer.version,
            slot: answer.slot,
            state: 'Waiting',
            tick: 0,
          }),
        )
        return
      }
      const game = this.game
      if (Option.isNone(game)) {
        return
      }
      const received = Room.receive(
        game.value.world,
        game.value.room,
        attachment.socket,
        frame,
        nowMs,
      )
      this.game = Option.some({ ...game.value, room: received.room })
      yield* this.apply(received.out, host)
    })
  }

  // NOTE: every socket of this object belongs to its one room, and each
  // attachment names its scope.
  private scopeOfObject(): Effect.Effect<Option.Option<string>> {
    const fromSockets = Option.map(
      Array.head(
        Array.getSomes(Array.map(this.ctx.getWebSockets(), attachmentOf)),
      ),
      attachment => attachment.scope,
    )
    return Option.isSome(fromSockets)
      ? Effect.succeed(fromSockets)
      : this.storedScope()
  }

  webSocketMessage(
    socket: WorkersWebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    const maybeAttachment = attachmentOf(socket)
    if (Option.isNone(maybeAttachment)) {
      socket.close(1003, 'Unsupported')
      return Promise.resolve()
    }
    const attachment = maybeAttachment.value
    const handled: Effect.Effect<void, SyncSetupFailed> =
      attachment._tag === 'Sync'
        ? typeof message === 'string'
          ? this.onSync(socket, attachment, message)
          : Effect.sync(() => socket.close(1003, 'Text only'))
        : typeof message === 'string'
          ? Effect.void
          : this.onGame(socket, attachment, new Uint8Array(message))
    return Effect.runPromise(
      handled.pipe(
        Effect.catchTag('SyncSetupFailed', error =>
          Effect.logError('Room setup failed', error.cause),
        ),
      ),
    )
  }

  webSocketClose(
    socket: WorkersWebSocket,
    code: number,
    reason: string,
  ): Promise<void> {
    const maybeAttachment = attachmentOf(socket)
    const game = this.game
    if (
      Option.isSome(maybeAttachment) &&
      maybeAttachment.value._tag === 'GameJoined' &&
      Option.isSome(game)
    ) {
      const socketId = maybeAttachment.value.socket
      return Effect.runPromise(
        Effect.gen({ self: this }, function* () {
          const nowMs = yield* Clock.currentTimeMillis
          const current = this.game
          if (Option.isSome(current)) {
            const unlinked = Room.unlink(current.value.room, socketId, nowMs)
            this.game = Option.some({ ...current.value, room: unlinked.room })
            Array.forEach(unlinked.out, item => {
              if (item._tag === 'Send') {
                Option.map(
                  Array.findFirst(
                    this.gameSockets(),
                    entry => entry.id === item.socket,
                  ),
                  entry => sendFrame(entry.socket, item.frame),
                )
              }
            })
          }
          socket.close(code, reason)
        }),
      )
    }
    socket.close(code, reason)
    return Promise.resolve()
  }

  webSocketError(socket: WorkersWebSocket): Promise<void> {
    return this.webSocketClose(socket, 1011, 'Error')
  }

  // ALARM

  // NOTE: a game whose loop stopped advancing gets a new loop.
  private checkLoop(
    maybeHost: Option.Option<RoomHost>,
    nowMs: number,
  ): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      if (
        Option.isSome(maybeHost) &&
        Option.exists(
          this.game,
          game => nowMs - game.advancedMs > STALLED_LOOP_MS,
        )
      ) {
        yield* Effect.logWarning('The room loop stalled; restarting it')
        this.startLoop(maybeHost.value)
      }
    })
  }

  // NOTE: a lobby still Playing with no game running was cut off: record
  // the round as Interrupted and tell anyone still linked.
  private interrupted(
    maybeHost: Option.Option<RoomHost>,
    lobby: Option.Option<Lobby>,
  ): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      if (Option.isSome(maybeHost) && Option.isSome(lobby)) {
        yield* this.lock.withPermit(
          maybeHost.value.recordResult(
            {
              round: lobby.value.round,
              reason: 'Interrupted',
              ticks: 0,
              scores: [],
            },
            this.syncSockets(),
          ),
        )
        Array.forEach(this.gameSockets(), entry =>
          sendFrame(
            entry.socket,
            ServerFrame.cases.RoomClosed.make({ reason: 'Interrupted' }),
          ),
        )
      }
    })
  }

  // NOTE: only an empty, unchanged room gets here, or an object that never
  // held one. A sync scope rebuilds its tables on next use.
  private deleteRoom(): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      this.host = Option.none()
      yield* tryCall('delete the room', () =>
        this.ctx.storage.deleteAll(),
      ).pipe(Effect.ignore)
    })
  }

  alarm(): Promise<void> {
    return Effect.runPromise(
      Effect.gen({ self: this }, function* () {
        const maybeScope = yield* this.scopeOfObject()
        const nowMs = yield* Clock.currentTimeMillis
        const maybeHost = Option.isSome(maybeScope)
          ? Option.some(yield* this.hostFor(maybeScope.value))
          : Option.none<RoomHost>()
        const lobby = Option.isSome(maybeHost)
          ? yield* maybeHost.value.lobby
          : Option.none<Lobby>()
        const decision = decideAlarm({
          nowMs,
          gameRunning: Option.isSome(this.game),
          lobby,
          socketsOpen: this.ctx.getWebSockets().length,
        })
        return yield* Match.valueTags(decision, {
          CheckLoop: ({ nextMs }) =>
            Effect.andThen(
              this.checkLoop(maybeHost, nowMs),
              setAlarm(this.ctx, nextMs),
            ),
          Interrupted: ({ nextMs }) =>
            Effect.andThen(
              this.interrupted(maybeHost, lobby),
              setAlarm(this.ctx, nextMs),
            ),
          Later: ({ nextMs }) => setAlarm(this.ctx, nextMs),
          Delete: () => this.deleteRoom(),
        })
      }).pipe(
        Effect.catchTag('SyncSetupFailed', error =>
          Effect.logError('Room alarm failed', error.cause),
        ),
      ),
    )
  }
}

const setAlarm = (ctx: DurableObjectState, atMs: number) =>
  tryCall('set the alarm', () => ctx.storage.setAlarm(atMs)).pipe(Effect.ignore)

const refuseAndClose = (
  socket: WorkersWebSocket,
  reason: Parameters<typeof ServerFrame.cases.Refused.make>[0]['reason'],
) => {
  sendFrame(
    socket,
    ServerFrame.cases.Refused.make({
      reason,
      minVersion: SERVER_VERSIONS.minVersion,
      maxVersion: SERVER_VERSIONS.maxVersion,
    }),
  )
  socket.close(1008, reason)
}

const encodeRefusal = Schema.encodeSync(Schema.fromJsonString(RoomRefusal))
const encodeTicket = Schema.encodeSync(Schema.fromJsonString(RoomTicket))

const refusalResponse = (refusal: RoomRefusal): Response =>
  json(roomRefusalStatus(refusal), encodeRefusal(refusal))

const ticketResponse = (result: Result.Result<RoomTicket, RoomRefusal>) =>
  Result.match(result, {
    onSuccess: ticket => json(200, encodeTicket(ticket)),
    onFailure: refusalResponse,
  })

// ROUTES

const isWithinRate = (env: GameRoomBindings, request: Request) => {
  const address = request.headers.get('cf-connecting-ip') ?? 'unknown'
  return tryCall('check the rate limit', () =>
    env.SYNC_BY_ADDRESS.limit({ key: `room:${address}` }),
  ).pipe(
    Effect.map(outcome => outcome.success),
    Effect.catchTag('SyncCallFailed', () => Effect.succeed(true)),
  )
}

const answer = (status: number, text: string): Response =>
  new Response(text, {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
  })

const routeRoomPath = (request: Request, env: GameRoomBindings, url: URL) =>
  Effect.gen(function* () {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }
    const rooms = env.GAME_ROOMS
    if (rooms === undefined) {
      return refusalResponse(RoomRefusal.cases.Unavailable.make({}))
    }
    if (url.pathname === ROOM_PATHS.quick) {
      const matchmakers = env.MATCHMAKER
      if (matchmakers === undefined) {
        return refusalResponse(RoomRefusal.cases.Unavailable.make({}))
      }
      if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
        return json(426, '{}')
      }
      const stub = matchmakers.get(matchmakers.idFromName(MATCHMAKER_NAME))
      const response = yield* tryCall('open the quick play socket', () =>
        stub.fetch(request.url, {
          headers: {
            ...Object.fromEntries(request.headers.entries()),
            [REGION_HEADER]: continentOf(request),
          },
        }),
      )
      return new Response(null, {
        status: response.status,
        webSocket: response.webSocket,
      })
    }
    if (url.pathname === ROOM_PATHS.socket) {
      const maybeCode = normalizeRoomCode(url.searchParams.get('code') ?? '')
      if (Option.isNone(maybeCode)) {
        return refusalResponse(RoomRefusal.cases.NoRoom.make({}))
      }
      if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
        return json(426, '{}')
      }
      const stub = rooms.get(rooms.idFromName(roomScopeId(maybeCode.value)))
      const response = yield* tryCall('open the room socket', () =>
        stub.fetch(request.url, {
          headers: {
            ...Object.fromEntries(request.headers.entries()),
            [ROOM_CODE_HEADER]: maybeCode.value,
          },
        }),
      )
      return new Response(null, {
        status: response.status,
        webSocket: response.webSocket,
      })
    }
    if (request.method !== 'POST') {
      return json(405, '{}')
    }
    const nowMs = yield* Clock.currentTimeMillis
    const claims = yield* Effect.result(
      Option.match(bearerOf(request), {
        onNone: () => verifyToken(env.SYNC_SECRET, '', nowMs),
        onSome: token => verifyToken(env.SYNC_SECRET, token, nowMs),
      }),
    )
    if (Result.isFailure(claims)) {
      return refusalResponse(
        RoomRefusal.cases.Unauthorized.make({ reason: claims.failure.reason }),
      )
    }
    if (!(yield* isWithinRate(env, request))) {
      return refusalResponse(RoomRefusal.cases.RateLimited.make({}))
    }
    const playerId = claims.success.playerId
    const text = yield* tryCall('read the body', () => request.text())
    if (url.pathname === ROOM_PATHS.create) {
      const maybeBody = Schema.decodeOption(
        Schema.fromJsonString(CreateRequest),
      )(text)
      const called = yield* createRoomIn(
        rooms,
        playerId,
        Option.match(maybeBody, {
          onNone: () => '',
          onSome: body => body.name,
        }),
        Option.match(maybeBody, {
          onNone: () => '',
          onSome: body => body.look ?? '',
        }),
        Option.match(maybeBody, {
          onNone: () => 1,
          onSome: body => body.rank ?? 1,
        }),
        'Private',
        continentOf(request),
      )
      return answer(called.status, called.text)
    }
    if (url.pathname === ROOM_PATHS.join) {
      const maybeBody = Schema.decodeOption(Schema.fromJsonString(JoinRequest))(
        text,
      )
      const maybeCode = Option.flatMap(maybeBody, body =>
        normalizeRoomCode(body.code),
      )
      if (Option.isNone(maybeCode) || Option.isNone(maybeBody)) {
        return refusalResponse(RoomRefusal.cases.NoRoom.make({}))
      }
      const called = yield* joinRoomIn(
        rooms,
        maybeCode.value,
        playerId,
        maybeBody.value.name,
        maybeBody.value.look ?? '',
        maybeBody.value.rank ?? 1,
      )
      return answer(called.status, called.text)
    }
    return json(404, '{}')
  })

// NOTE: the /room paths. Every failure is answered here.
export const routeRoom = (
  request: Request,
  env: GameRoomBindings,
): Effect.Effect<Option.Option<Response>> =>
  Effect.suspend(() => {
    const url = new URL(request.url)
    return url.pathname.startsWith('/room/')
      ? Effect.asSome(syncErrorResponse(routeRoomPath(request, env, url)))
      : Effect.succeedNone
  })

// NOTE: the sync paths of a room scope go to its GameRoom, which hosts the
// scope beside the game.
export const roomScopeStub = (
  env: GameRoomBindings,
  scope: string,
): Option.Option<ReturnType<DurableObjectNamespace['get']>> =>
  Option.flatMap(roomCodeOfScope(scope), code =>
    Option.map(Option.fromNullishOr(env.GAME_ROOMS), rooms =>
      rooms.get(rooms.idFromName(roomScopeId(code))),
    ),
  )
