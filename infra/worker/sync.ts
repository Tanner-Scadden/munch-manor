import { Function, Record, String } from 'effect'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'

import type {
  DurableObjectNamespace,
  RateLimit,
} from '@cloudflare/workers-types'

import { SCOPE_PATHS } from '@munch/sync-engine'

import { roomScopeStub } from './gameRoom.ts'
import {
  CORS_HEADERS,
  isWebSocketUpgrade,
  json,
  syncErrorResponse,
  tryCall,
} from './syncCore.ts'

export type SyncBindings = Readonly<{
  SYNC_SECRET: string
  SYNC_BY_ADDRESS: RateLimit
  PLAYER_LOGS: DurableObjectNamespace
  LINK_CODES: DurableObjectNamespace
  GAME_ROOMS?: DurableObjectNamespace | undefined
  MATCHMAKER?: DurableObjectNamespace | undefined
}>

const SCOPE_HEADER = 'x-sync-scope'

const forwardToRoom = (request: Request, env: SyncBindings, url: URL) =>
  Effect.gen(function* () {
    const maybeTarget = Option.flatMap(
      Option.fromNullishOr(url.searchParams.get('scope')),
      scope => Option.map(roomScopeStub(env, scope), stub => ({ scope, stub })),
    )
    if (Option.isNone(maybeTarget)) {
      return json(400, '{"_tag":"BadRequest","reason":"Bad scope"}')
    }
    const isUpgrade = isWebSocketUpgrade(request)
    if (url.pathname === SCOPE_PATHS.socket && !isUpgrade) {
      return json(426, '{}')
    }
    const { scope, stub } = maybeTarget.value
    const headers = {
      ...Record.fromEntries(request.headers.entries()),
      [SCOPE_HEADER]: scope,
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

const routeSyncPath = (request: Request, env: SyncBindings, url: URL) =>
  Effect.gen(function* () {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }
    if (
      url.pathname === SCOPE_PATHS.socket ||
      url.pathname === SCOPE_PATHS.exchange
    ) {
      return yield* forwardToRoom(request, env, url)
    }
    return json(404, '{}')
  })

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
