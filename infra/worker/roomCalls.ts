import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'

import type {
  DurableObjectLocationHint,
  DurableObjectNamespace,
} from '@cloudflare/workers-types'
import {
  Matchmaking,
  RoomRefusal,
  type RoomTicket,
  RoomTicket as RoomTicketSchema,
  type RoomVisibility,
  makeRoomCode,
  roomScopeId,
} from '@munch/netcode'

import {
  INTERNAL_PATHS,
  InternalCreate,
  InternalJoin,
  ROOM_CODE_HEADER,
} from './gameRoomCore.ts'
import { type SyncCallFailed, tryCall } from './syncCore.ts'

// NOTE: calls between the Worker, the GameRoom objects, and the
// Matchmaker. Only the Worker and these objects can reach the internal
// paths: the Worker forwards nothing else to them.

export const MATCHMAKER_NAME = 'matchmaker'
export const LISTING_PATH = '/internal/listing'

export interface Called {
  readonly status: number
  readonly text: string
}

// REGIONS

// NOTE: the continent a request came from (Cloudflare's `request.cf`), to
// queue QUICK PLAY by continent and to place a new room near its creator.
export const REGION_HEADER = 'x-room-region'

const CfContinent = Schema.Struct({ continent: Schema.String })
const decodeCf = Schema.decodeUnknownOption(CfContinent)

export const continentOf = (request: Request): string =>
  Option.match(decodeCf(Reflect.get(request, 'cf')), {
    onNone: () => '',
    onSome: cf => (/^[A-Z]{2}$/.test(cf.continent) ? cf.continent : ''),
  })

const LOCATION_HINTS: Readonly<Record<string, DurableObjectLocationHint>> = {
  NA: 'enam',
  SA: 'sam',
  EU: 'weur',
  AF: 'afr',
  AS: 'apac',
  OC: 'oc',
}

// NOTE: a hint only takes effect when the object is first made, so a
// room lives near the player who created it; its lobby and its run share
// the one object.
const stubFor = (
  rooms: DurableObjectNamespace,
  code: string,
  region: string,
) => {
  const id = rooms.idFromName(roomScopeId(code))
  const hint = LOCATION_HINTS[region]
  return hint === undefined
    ? rooms.get(id)
    : rooms.get(id, { locationHint: hint })
}

const callRoom = (
  rooms: DurableObjectNamespace,
  code: string,
  path: string,
  body: string,
  region = '',
): Effect.Effect<Called, SyncCallFailed> =>
  Effect.gen(function* () {
    const stub = stubFor(rooms, code, region)
    const response = yield* tryCall('call the room', () =>
      stub.fetch(`https://room${path}`, {
        method: 'POST',
        headers: { [ROOM_CODE_HEADER]: code },
        body,
      }),
    )
    const text = yield* tryCall('read the room answer', () => response.text())
    return { status: response.status, text }
  })

const CREATE_ATTEMPTS = 5

const encodeCreate = Schema.encodeEffect(InternalCreate)
const encodeJoin = Schema.encodeEffect(InternalJoin)
const encodeListing = Schema.encodeSync(
  Schema.fromJsonString(Matchmaking.RoomListing),
)

// NOTE: a new room under a fresh code; a code already in use (409) draws
// another, a few times.
export const createRoomIn = (
  rooms: DurableObjectNamespace,
  playerId: string,
  name: string,
  look: string,
  rank: number,
  calling: string,
  visibility: RoomVisibility,
  region = '',
  attempt = 0,
): Effect.Effect<Called, SyncCallFailed> =>
  Effect.gen(function* () {
    const code = yield* makeRoomCode
    const body = yield* Effect.orDie(
      encodeCreate({ playerId, name, look, rank, calling, code, visibility }),
    )
    const called = yield* callRoom(
      rooms,
      code,
      INTERNAL_PATHS.create,
      body,
      region,
    )
    return called.status === 409 && attempt + 1 < CREATE_ATTEMPTS
      ? yield* createRoomIn(
          rooms,
          playerId,
          name,
          look,
          rank,
          calling,
          visibility,
          region,
          attempt + 1,
        )
      : called
  })

export const joinRoomIn = (
  rooms: DurableObjectNamespace,
  code: string,
  playerId: string,
  name: string,
  look: string,
  rank: number,
  calling: string,
): Effect.Effect<Called, SyncCallFailed> =>
  Effect.flatMap(
    Effect.orDie(encodeJoin({ playerId, name, look, rank, calling })),
    body => callRoom(rooms, code, INTERNAL_PATHS.join, body),
  )

const decodeTicket = Schema.decodeOption(
  Schema.fromJsonString(RoomTicketSchema),
)
const decodeRefusal = Schema.decodeOption(Schema.fromJsonString(RoomRefusal))

export const ticketOf = (
  called: Called,
): Result.Result<RoomTicket, RoomRefusal> =>
  called.status === 200
    ? Option.match(decodeTicket(called.text), {
        onNone: () => Result.fail(RoomRefusal.cases.Unavailable.make({})),
        onSome: ticket => Result.succeed(ticket),
      })
    : Result.fail(
        Option.getOrElse(decodeRefusal(called.text), () =>
          RoomRefusal.cases.Unavailable.make({}),
        ),
      )

// NOTE: a public room tells the Matchmaker how it stands. A failure is
// logged; the next change says it again, and a stale listing ages out.
export const reportListing = (
  matchmakers: DurableObjectNamespace | undefined,
  listing: Matchmaking.RoomListing,
): Effect.Effect<void> =>
  matchmakers === undefined
    ? Effect.void
    : tryCall('tell the matchmaker', () =>
        matchmakers
          .get(matchmakers.idFromName(MATCHMAKER_NAME))
          .fetch(`https://matchmaker${LISTING_PATH}`, {
            method: 'POST',
            body: encodeListing(listing),
          }),
      ).pipe(
        Effect.asVoid,
        Effect.catchTag('SyncCallFailed', error =>
          Effect.logWarning('Telling the matchmaker failed', error.cause),
        ),
      )
