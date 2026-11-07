import { Function, Record, String } from 'effect'
import * as Array from 'effect/Array'
import * as Clock from 'effect/Clock'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import * as Semaphore from 'effect/Semaphore'

import type {
  DurableObjectNamespace,
  DurableObjectState,
  RateLimit,
  WebSocket as WorkersWebSocket,
} from '@cloudflare/workers-types'
import {
  ChallengeResponse,
  Connection,
  IDENTITY_PATHS,
  IdentityFailure,
  OPENED,
  PING_JSON,
  PONG_JSON,
  makeChallenge,
} from '@munch/sync-engine'

import { roomScopeStub } from './gameRoom.ts'
import {
  BadSyncBody,
  CORS_HEADERS,
  type DirectoryHost,
  type Linked,
  NIGHTMARE_PATH,
  type ScopeHost,
  type Socket,
  SyncCallFailed,
  type SyncSetupFailed,
  encodeNightmareAnswer,
  failureResponse,
  isWebSocketUpgrade,
  json,
  makeDirectoryHost,
  nightmareUnlockedIn,
  playerScopeId,
  playerScopeOf,
  scopeHostOnce,
  sqlOf,
  syncErrorResponse,
  tryCall,
} from './syncCore.ts'

// NOTE: GAME_ROOMS and MATCHMAKER are optional so a Worker without them
// (an older deploy, a test) answers that rooms are unavailable instead of
// failing.
export type SyncBindings = Readonly<{
  SYNC_SCOPES: DurableObjectNamespace
  SYNC_DIRECTORY: DurableObjectNamespace
  SYNC_SECRET: string
  SYNC_BY_ADDRESS: RateLimit
  GAME_ROOMS?: DurableObjectNamespace | undefined
  MATCHMAKER?: DurableObjectNamespace | undefined
}>

const DIRECTORY_NAME = 'directory'
const SCOPE_HEADER = 'x-sync-scope'
const LINKED_DEVICES_PATH = '/internal/linked-devices'

const AttachmentSchema = Schema.Struct({
  scope: Schema.String,
  connection: Connection,
})
type Attachment = typeof AttachmentSchema.Type

const decodeAttachment = Schema.decodeUnknownOption(AttachmentSchema)

// NOTE: the values encoded here are built in this file from their own
// Schemas, so an encode cannot fail; if one did, it would be a defect, or
// for the linked devices body, a failed call like the fetch it goes in.
const encodeAttachment = (attachment: Attachment) =>
  Effect.orDie(Schema.encodeEffect(AttachmentSchema)(attachment))

const LinkedDevicesBody = Schema.fromJsonString(
  Schema.Struct({ count: Schema.Finite, id: Schema.String }),
)
const encodeLinkedDevices = (body: typeof LinkedDevicesBody.Type) =>
  Effect.mapError(Schema.encodeEffect(LinkedDevicesBody)(body), cause =>
    SyncCallFailed.make({ step: 'tell the scope', cause }),
  )

const ChallengeJson = Schema.fromJsonString(ChallengeResponse)
const encodeChallenge = (challenge: typeof ChallengeJson.Type) =>
  Effect.orDie(Schema.encodeEffect(ChallengeJson)(challenge))

const decodeLinkedDevices = (body: string) =>
  Effect.mapError(Schema.decodeEffect(LinkedDevicesBody)(body), error =>
    BadSyncBody.make({ reason: error.message }),
  )

// SCOPE

// NOTE: one message is handled at a time: the input gate only covers
// storage, and token checks await WebCrypto.
export class SyncScope {
  private readonly lock = Semaphore.makeUnsafe(1)
  private host: Option.Option<Effect.Effect<ScopeHost, SyncSetupFailed>> =
    Option.none()

  private readonly ctx: DurableObjectState
  private readonly env: SyncBindings

  constructor(ctx: DurableObjectState, env: SyncBindings) {
    this.ctx = ctx
    this.env = env
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(PING_JSON, PONG_JSON),
    )
  }

  // NOTE: the object is named by its scope (fetch checks), so every caller
  // passes the same scope and the first one builds the host.
  private hostFor(scope: string): Effect.Effect<ScopeHost, SyncSetupFailed> {
    return Effect.suspend(() =>
      Option.getOrElse(this.host, () => {
        const once = Effect.runSync(
          scopeHostOnce(sqlOf(this.ctx.storage), scope, this.env.SYNC_SECRET),
        )
        this.host = Option.some(once)
        return once
      }),
    )
  }

  private socketOf(
    socket: WorkersWebSocket,
  ): Option.Option<Socket & { scope: string }> {
    return Option.map(
      decodeAttachment(socket.deserializeAttachment()),
      attachment => ({
        scope: attachment.scope,
        connection: attachment.connection,
        send: (message: string) => {
          socket.send(message)
        },
        setConnection: (connection: Connection) =>
          Effect.flatMap(
            encodeAttachment({ scope: attachment.scope, connection }),
            encoded =>
              Effect.sync(() => {
                socket.serializeAttachment(encoded)
              }),
          ),
      }),
    )
  }

  private everyone(): ReadonlyArray<Socket> {
    return Array.getSomes(
      Array.map(this.ctx.getWebSockets(), socket => this.socketOf(socket)),
    )
  }

  private accept(scope: string): Effect.Effect<Response> {
    const { ctx } = this
    return Effect.map(
      encodeAttachment({ scope, connection: OPENED }),
      encoded => {
        const pair = new WebSocketPair()
        const client = pair[0]
        const server = pair[1]
        ctx.acceptWebSocket(server)
        server.serializeAttachment(encoded)
        return new Response(null, { status: 101, webSocket: client })
      },
    )
  }

  private handle(
    request: Request,
  ): Effect.Effect<Response, SyncSetupFailed | SyncCallFailed | BadSyncBody> {
    const url = new URL(request.url)
    const scope = request.headers.get(SCOPE_HEADER) ?? ''
    if (!this.ctx.id.equals(this.env.SYNC_SCOPES.idFromName(scope))) {
      return Effect.succeed(
        json(400, '{"_tag":"BadRequest","reason":"Wrong scope"}'),
      )
    }
    const { lock } = this
    const everyone = () => this.everyone()
    const accept = () => this.accept(scope)
    const hostFor = this.hostFor(scope)
    return Effect.gen(function* () {
      const host = yield* hostFor
      if (url.pathname === IDENTITY_PATHS.socket) {
        return yield* accept()
      }
      if (url.pathname === IDENTITY_PATHS.exchange) {
        const body = yield* tryCall('read the body', () => request.text())
        return yield* lock.withPermit(
          Effect.suspend(() => host.exchange(body, everyone())),
        )
      }
      if (url.pathname === NIGHTMARE_PATH) {
        const unlocked = yield* nightmareUnlockedIn(host)
        const answer = yield* encodeNightmareAnswer(unlocked)
        return json(200, answer)
      }
      if (url.pathname === LINKED_DEVICES_PATH) {
        const text = yield* tryCall('read the body', () => request.text())
        const { count, id } = yield* decodeLinkedDevices(text)
        yield* lock.withPermit(
          Effect.suspend(() => host.linkedDevices(count, id, everyone())),
        )
        return json(200, '{}')
      }
      return json(404, '{}')
    })
  }

  fetch(request: Request): Promise<Response> {
    return this.handle(request).pipe(syncErrorResponse, Effect.runPromise)
  }

  webSocketMessage(
    socket: WorkersWebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    const maybeSocket = this.socketOf(socket)
    if (Option.isNone(maybeSocket) || typeof message !== 'string') {
      socket.close(1003, 'Unsupported')
      return Promise.resolve()
    }
    const { lock } = this
    const everyone = () => this.everyone()
    return Effect.runPromise(
      Effect.flatMap(this.hostFor(maybeSocket.value.scope), host =>
        lock.withPermit(
          Effect.suspend(() =>
            Effect.asVoid(
              host.onMessage(maybeSocket.value, message, everyone()),
            ),
          ),
        ),
      ).pipe(
        Effect.catchTag('SyncSetupFailed', error =>
          Effect.logError('Sync setup failed', error.cause),
        ),
      ),
    )
  }

  webSocketClose(socket: WorkersWebSocket, code: number, reason: string): void {
    socket.close(code, reason)
  }
}

// DIRECTORY

export class SyncDirectory {
  private readonly host: DirectoryHost

  constructor(ctx: DurableObjectState, env: SyncBindings) {
    this.host = Effect.runSync(
      makeDirectoryHost({
        sql: sqlOf(ctx.storage),
        secret: env.SYNC_SECRET,
        tellScope: linked => tellScope(env, linked),
      }),
    )
  }

  fetch(request: Request): Promise<Response> {
    return Effect.runPromise(this.host.fetch(request))
  }
}

// NOTE: the cross-scope step, done by hand until there is an outbox for
// server mutations: after a link, the player's scope records the new device
// count. The id makes a retry harmless.
const tellScope = (env: SyncBindings, linked: Linked) =>
  Effect.gen(function* () {
    const scope = playerScopeId(linked.playerId)
    const stub = env.SYNC_SCOPES.get(env.SYNC_SCOPES.idFromName(scope))
    const body = yield* encodeLinkedDevices({
      count: linked.devices,
      id: `linked-${linked.deviceId}-${linked.devices}`,
    })
    const response = yield* tryCall('tell the scope', () =>
      stub.fetch(`https://sync${LINKED_DEVICES_PATH}`, {
        method: 'POST',
        headers: { [SCOPE_HEADER]: scope },
        body,
      }),
    )
    if (!response.ok) {
      return yield* SyncCallFailed.make({
        step: 'tell the scope',
        cause: `HTTP ${response.status}`,
      })
    }
  })

// ROUTES

// NOTE: a rate limiter that errors lets the request through, as the
// analytics limits do, and is logged.
const isWithinRate = (env: SyncBindings, request: Request) => {
  const address = request.headers.get('cf-connecting-ip') ?? 'unknown'
  return tryCall('check the rate limit', () =>
    env.SYNC_BY_ADDRESS.limit({ key: `sync:${address}` }),
  ).pipe(
    Effect.map(outcome => outcome.success),
    Effect.catchTag('SyncCallFailed', error =>
      Effect.as(
        Effect.logWarning(
          'The sync rate limiter failed, so the request goes through',
          error.cause,
        ),
        true,
      ),
    ),
  )
}

const isIdentityPath = (pathname: string): boolean =>
  pathname === IDENTITY_PATHS.session ||
  pathname === IDENTITY_PATHS.link ||
  pathname === IDENTITY_PATHS.redeem

const routeSyncPath = (request: Request, env: SyncBindings, url: URL) =>
  Effect.gen(function* () {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }
    if (
      url.pathname === IDENTITY_PATHS.socket ||
      url.pathname === IDENTITY_PATHS.exchange
    ) {
      return yield* forwardToScope(request, env, url)
    }
    if (request.method !== 'POST') {
      return json(405, '{}')
    }
    if (!(yield* isWithinRate(env, request))) {
      return yield* failureResponse(IdentityFailure.cases.RateLimited.make({}))
    }
    if (url.pathname === IDENTITY_PATHS.challenge) {
      const now = yield* Clock.currentTimeMillis
      const nonce = yield* Effect.mapError(
        makeChallenge(env.SYNC_SECRET, now),
        cause => SyncCallFailed.make({ step: 'make a challenge', cause }),
      )
      const challenge = yield* encodeChallenge({ nonce })
      return json(200, challenge)
    }
    if (isIdentityPath(url.pathname)) {
      const stub = env.SYNC_DIRECTORY.get(
        env.SYNC_DIRECTORY.idFromName(DIRECTORY_NAME),
      )
      const body = yield* tryCall('read the body', () => request.text())
      const response = yield* tryCall('call the directory', () =>
        stub.fetch(request.url, {
          method: 'POST',
          headers: Record.fromEntries(request.headers.entries()),
          body,
        }),
      )
      const text = yield* tryCall('read the directory answer', () =>
        response.text(),
      )
      return new Response(text, {
        status: response.status,
        headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
      })
    }
    return json(404, '{}')
  })

// NOTE: every /sync path. The rest of the Worker is the analytics API. Every
// failure is answered here, so the effect never fails.
export const routeSync: {
  (
    env: SyncBindings,
  ): (request: Request) => Effect.Effect<Option.Option<Response>>
  (request: Request, env: SyncBindings): Effect.Effect<Option.Option<Response>>
} = Function.dual(
  2,
  (
    request: Request,
    env: SyncBindings,
  ): Effect.Effect<Option.Option<Response>> =>
    Effect.suspend(() => {
      const url = new URL(request.url)
      return String.startsWith('/sync/')(url.pathname)
        ? routeSyncPath(request, env, url).pipe(
            syncErrorResponse,
            Effect.asSome,
          )
        : Effect.succeedNone
    }),
)

const forwardToScope = (request: Request, env: SyncBindings, url: URL) =>
  Effect.gen(function* () {
    const maybeTarget = Option.orElse(
      Option.map(playerScopeOf(url), scope => ({
        scope,
        stub: env.SYNC_SCOPES.get(env.SYNC_SCOPES.idFromName(scope)),
      })),
      () =>
        Option.flatMap(
          Option.fromNullishOr(url.searchParams.get('scope')),
          scope =>
            Option.map(roomScopeStub(env, scope), stub => ({ scope, stub })),
        ),
    )
    if (Option.isNone(maybeTarget)) {
      return json(400, '{"_tag":"BadRequest","reason":"Bad scope"}')
    }
    const isUpgrade = isWebSocketUpgrade(request)
    if (url.pathname === IDENTITY_PATHS.socket && !isUpgrade) {
      return json(426, '{}')
    }
    const stub = maybeTarget.value.stub
    const headers = {
      ...Record.fromEntries(request.headers.entries()),
      [SCOPE_HEADER]: maybeTarget.value.scope,
    }
    const body =
      request.method === 'POST'
        ? yield* tryCall('read the body', () => request.text())
        : undefined
    const response = yield* tryCall('call the scope', () =>
      stub.fetch(request.url, {
        method: request.method,
        headers,
        body: body ?? null,
      }),
    )
    if (isUpgrade) {
      return new Response(null, {
        status: response.status,
        webSocket: response.webSocket,
      })
    }
    const text = yield* tryCall('read the scope answer', () => response.text())
    return new Response(text, {
      status: response.status,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
    })
  })
