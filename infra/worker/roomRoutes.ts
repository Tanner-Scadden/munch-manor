import * as Clock from 'effect/Clock'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'

import {
  CreateRequest,
  DEFAULT_CALLING,
  JoinRequest,
  ROOM_PATHS,
  RoomRefusal,
  normalizeRoomCode,
  roomScopeId,
} from '@munch/netcode'
import { verifyToken } from '@munch/sync-engine'

import { type GameRoomBindings, refusalResponse } from './gameRoom.ts'
import { ROOM_CODE_HEADER } from './gameRoomCore.ts'
import {
  MATCHMAKER_NAME,
  REGION_HEADER,
  continentOf,
  createRoomIn,
  joinRoomIn,
} from './roomCalls.ts'
import {
  CORS_HEADERS,
  bearerOf,
  json,
  syncErrorResponse,
  tryCall,
} from './syncCore.ts'

// The /room paths of the API Worker: creating and joining a room by code,
// QUICK PLAY's socket, and a room's game socket, each handed to its Durable
// Object (the GameRoom in gameRoom.ts, the Matchmaker).

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
        Option.match(maybeBody, {
          onNone: () => DEFAULT_CALLING,
          onSome: body => body.calling ?? DEFAULT_CALLING,
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
        maybeBody.value.calling ?? DEFAULT_CALLING,
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

