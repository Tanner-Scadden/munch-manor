import * as Array from 'effect/Array'
import * as Effect from 'effect/Effect'
import type * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'
import type * as SqlClient from 'effect/sql/SqlClient'

import {
  CallingInput,
  type ClientFrame,
  CreatedRoom,
  DEFAULT_CALLING,
  DEFAULT_MODE,
  JoinedRoom,
  KickedPlayer,
  LeftRoom,
  type Lobby,
  LookInput,
  MAX_NAME_INPUT,
  type Matchmaking,
  NameInput,
  RankInput,
  RecordedRoomResult,
  type RefusedReason,
  RoomRefusal,
  type RoomResult,
  RoomScope,
  type RoomTicket,
  type RoomVisibility,
  RoomVisibility as RoomVisibilitySchema,
  SERVER_VERSIONS,
  canJoin,
  cleanRank,
  isOpenToQuickPlay,
  lobbyOfSnapshot,
  negotiateVersion,
} from '@munch/netcode'
import {
  type Delta,
  ServerMessage,
  decodeArgs,
  verifyToken,
} from '@munch/sync-engine'

import { callingOfCode, lookCodeOf, lookOfCode } from '../../src/playerData.ts'
import {
  type ScopeHost,
  type ScopeHostFailed,
  type Socket,
  type SyncSetupFailed,
  authenticateWith,
  buildOn,
  deliver,
  joinedOf,
  makeScopeHost,
  setupOnce,
} from './syncCore.ts'

// NOTE: the GameRoom's logic apart from the Workers runtime, so `bun test`
// covers it over in-memory SQLite: the `room:<code>` scope host and what
// the Durable Object does around it (creating, seating, recording results,
// reacting to lobby mutations), and the answer to a game socket's Hello.
// The game's own rules are the pure Room in @munch/netcode.

// ROOM HOST

export interface RoomHost {
  readonly scope: ScopeHost
  readonly lobby: Effect.Effect<Option.Option<Lobby>>
  readonly create: (
    playerId: string,
    name: string,
    look: string,
    rank: number,
    calling: string,
    nightmare: boolean,
    code: string,
    visibility: RoomVisibility,
  ) => Effect.Effect<Result.Result<RoomTicket, RoomRefusal>>
  readonly join: (
    playerId: string,
    name: string,
    look: string,
    rank: number,
    calling: string,
    nightmare: boolean,
    everyone: ReadonlyArray<Socket>,
  ) => Effect.Effect<Result.Result<RoomTicket, RoomRefusal>>
  readonly recordResult: (
    result: RoomResult,
    everyone: ReadonlyArray<Socket>,
  ) => Effect.Effect<void>
  readonly freeSeat: (
    playerId: string,
    round: number,
    everyone: ReadonlyArray<Socket>,
  ) => Effect.Effect<void>
  readonly forget: (playerId: string) => Effect.Effect<void>
}

const refusal = (
  refused: RoomRefusal,
): Result.Result<RoomTicket, RoomRefusal> => Result.fail(refused)

const ticketOf = (
  lobby: Lobby,
  playerId: string,
): Result.Result<RoomTicket, RoomRefusal> =>
  Option.match(
    Array.findFirst(lobby.members, member => member.playerId === playerId),
    {
      onNone: () => refusal(RoomRefusal.cases.Unavailable.make({})),
      onSome: member => Result.succeed({ code: lobby.code, slot: member.slot }),
    },
  )

// NOTE: a server mutation's delta goes to every socket joined to the scope,
// as the engine's own pushes do.
const broadcastApplied = (
  host: ScopeHost,
  delta: Delta,
  everyone: ReadonlyArray<Socket>,
) =>
  Effect.flatMap(Effect.orDie(host.server.head), head =>
    deliver(
      [
        ServerMessage.cases.Deltas.make({
          scope: host.server.scope,
          head,
          deltas: [delta],
        }),
      ],
      joinedOf(everyone),
    ),
  )

export const makeRoomHost = (
  scope: string,
  secret: string,
): Effect.Effect<RoomHost, ScopeHostFailed, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const host = yield* makeScopeHost(
      scope,
      authenticateWith(secret),
      RoomScope,
    )
    const { server } = host

    const lobby = Effect.map(Effect.orDie(server.snapshot), snapshot =>
      snapshot._tag === 'Snapshot'
        ? lobbyOfSnapshot(snapshot.tables)
        : Option.none(),
    )

    const create = (
      playerId: string,
      name: string,
      look: string,
      rank: number,
      calling: string,
      nightmare: boolean,
      code: string,
      visibility: RoomVisibility,
    ) =>
      Effect.gen(function* () {
        if (Option.isSome(yield* lobby)) {
          return refusal(RoomRefusal.cases.Started.make({}))
        }
        yield* Effect.orDie(server.addMember(playerId))
        const outcome = yield* Effect.orDie(
          server.runServer(
            CreatedRoom,
            {
              code,
              host: playerId,
              hostName: name.slice(0, MAX_NAME_INPUT),
              hostLook: lookOfRequest(look),
              hostRank: cleanRank(rank),
              hostCalling: callingOfRequest(calling),
              hostNightmare: nightmare,
              mode: DEFAULT_MODE,
              visibility,
            },
            `created-room-${code}`,
          ),
        )
        if (outcome._tag !== 'Applied') {
          return refusal(RoomRefusal.cases.Started.make({}))
        }
        return Result.succeed({ code, slot: 0 })
      })

    const join = (
      playerId: string,
      name: string,
      look: string,
      rank: number,
      calling: string,
      nightmare: boolean,
      everyone: ReadonlyArray<Socket>,
    ) =>
      Effect.gen(function* () {
        const maybeLobby = yield* lobby
        if (Option.isNone(maybeLobby) || maybeLobby.value.status === 'Closed') {
          return refusal(RoomRefusal.cases.NoRoom.make({}))
        }
        const current = maybeLobby.value
        if (
          Array.some(current.members, member => member.playerId === playerId)
        ) {
          return ticketOf(current, playerId)
        }
        if (!canJoin(current)) {
          return refusal(
            current.status === 'Playing'
              ? RoomRefusal.cases.Started.make({})
              : RoomRefusal.cases.Full.make({}),
          )
        }
        yield* Effect.orDie(server.addMember(playerId))
        const head = yield* Effect.orDie(server.head)
        const outcome = yield* Effect.orDie(
          server.runServer(
            JoinedRoom,
            {
              playerId,
              name: name.slice(0, MAX_NAME_INPUT),
              look: lookOfRequest(look),
              rank: cleanRank(rank),
              calling: callingOfRequest(calling),
              nightmare,
            },
            `joined-room-${head}-${playerId}`,
          ),
        )
        if (outcome._tag !== 'Applied') {
          yield* Effect.orDie(server.removeMember(playerId))
          return refusal(RoomRefusal.cases.Full.make({}))
        }
        yield* broadcastApplied(host, outcome.delta, everyone)
        return Option.match(yield* lobby, {
          onNone: () => refusal(RoomRefusal.cases.Unavailable.make({})),
          onSome: joined => ticketOf(joined, playerId),
        })
      })

    const recordResult = (
      result: RoomResult,
      everyone: ReadonlyArray<Socket>,
    ) =>
      Effect.gen(function* () {
        const outcome = yield* Effect.orDie(
          server.runServer(
            RecordedRoomResult,
            { result },
            `recorded-result-${result.round}`,
          ),
        )
        if (outcome._tag === 'Applied') {
          yield* broadcastApplied(host, outcome.delta, everyone)
        }
      })

    const freeSeat = (
      playerId: string,
      round: number,
      everyone: ReadonlyArray<Socket>,
    ) =>
      Effect.gen(function* () {
        const outcome = yield* Effect.orDie(
          server.runServer(
            LeftRoom,
            { by: playerId },
            `freed-seat-${round}-${playerId}`,
          ),
        )
        yield* Effect.orDie(server.removeMember(playerId))
        if (outcome._tag === 'Applied') {
          yield* broadcastApplied(host, outcome.delta, everyone)
        }
      })

    return {
      scope: host,
      lobby,
      create,
      join,
      recordResult,
      freeSeat,
      forget: playerId => Effect.orDie(server.removeMember(playerId)),
    }
  })

// NOTE: built once per Durable Object on first use, like the sync scopes.
export const roomHostOnce = <E>(
  sql: Layer.Layer<SqlClient.SqlClient, E>,
  scope: string,
  secret: string,
): Effect.Effect<Effect.Effect<RoomHost, SyncSetupFailed>> =>
  setupOnce(buildOn(sql, makeRoomHost(scope, secret)))

// NOTE: a look a player sent is kept only when it reads back as one of the
// game's looks (src/playerData.ts); anything else seats them with none,
// and the game draws their seat's own look.
export const lookOfRequest = (look: string): string =>
  Option.match(lookOfCode(look), {
    onNone: () => '',
    onSome: lookCodeOf,
  })

// NOTE: a calling a player sent is kept only when it reads back as one of
// the game's callings (src/playerData.ts); anything else seats them as YOU.
// The Worker cannot check the player's rank reached it: like the rank, it
// is for show and for the seat's gun and hearts, never for scoring.
const callingOfRequest = (calling: string): string =>
  Option.match(callingOfCode(calling), {
    onNone: () => DEFAULT_CALLING,
    onSome: known => known,
  })

// REACTIONS

// NOTE: what the Durable Object does after lobby mutations from players
// apply: start the run if the last READY started it, stop it, or drop a
// player who was kicked or left.
export type Reaction =
  | { readonly _tag: 'MaybeStart' }
  | { readonly _tag: 'EndGame' }
  | {
      readonly _tag: 'DropPlayer'
      readonly playerId: string
      readonly kicked: boolean
    }

const decodeKicked = (delta: Delta) =>
  Effect.option(decodeArgs(KickedPlayer, delta.args))
const decodeLeft = (delta: Delta) =>
  Effect.option(decodeArgs(LeftRoom, delta.args))

export const reactionsOf = (
  deltas: ReadonlyArray<Delta>,
): Effect.Effect<ReadonlyArray<Reaction>> =>
  Effect.map(
    Effect.forEach(deltas, (delta): Effect.Effect<Option.Option<Reaction>> => {
      if (delta.name === 'ChangedReady') {
        return Effect.succeedSome({ _tag: 'MaybeStart' })
      }
      if (delta.name === 'EndedGame') {
        return Effect.succeedSome({ _tag: 'EndGame' })
      }
      if (delta.name === 'KickedPlayer') {
        return Effect.map(decodeKicked(delta), maybeArgs =>
          Option.map(maybeArgs, args => ({
            _tag: 'DropPlayer',
            playerId: args.playerId,
            kicked: true,
          })),
        )
      }
      if (delta.name === 'LeftRoom') {
        return Effect.map(decodeLeft(delta), maybeArgs =>
          Option.map(maybeArgs, args => ({
            _tag: 'DropPlayer',
            playerId: args.by,
            kicked: false,
          })),
        )
      }
      return Effect.succeedNone
    }),
    Array.getSomes,
  )

// GAME SOCKETS

export type HelloAnswer =
  | { readonly _tag: 'Refuse'; readonly reason: RefusedReason }
  | {
      readonly _tag: 'Accept'
      readonly playerId: string
      readonly slot: number
      readonly version: number
    }

const refuse = (reason: RefusedReason): HelloAnswer => ({
  _tag: 'Refuse',
  reason,
})

// NOTE: the first frame on a game socket must be a Hello with a version
// both sides speak and a session token of a member of this room.
export const answerHello = (
  frame: ClientFrame,
  secret: string,
  maybeLobby: Option.Option<Lobby>,
  nowMs: number,
): Effect.Effect<HelloAnswer> =>
  Effect.gen(function* () {
    if (frame._tag !== 'Hello') {
      return refuse('BadMessage')
    }
    const maybeVersion = negotiateVersion(frame, SERVER_VERSIONS)
    if (Option.isNone(maybeVersion)) {
      return refuse('VersionMismatch')
    }
    const claims = yield* Effect.result(verifyToken(secret, frame.token, nowMs))
    if (Result.isFailure(claims)) {
      return refuse('Unauthorized')
    }
    if (Option.isNone(maybeLobby) || maybeLobby.value.status === 'Closed') {
      return refuse('NoRoom')
    }
    return Option.match(
      Array.findFirst(
        maybeLobby.value.members,
        member => member.playerId === claims.success.playerId,
      ),
      {
        onNone: () => refuse('NotMember'),
        onSome: (member): HelloAnswer => ({
          _tag: 'Accept',
          playerId: member.playerId,
          slot: member.slot,
          version: maybeVersion.value,
        }),
      },
    )
  })

// INTERNAL REQUESTS

// NOTE: what the Worker asks the room after checking the token, with the
// player it vouches for.
export const InternalCreate = Schema.fromJsonString(
  Schema.Struct({
    playerId: Schema.String,
    name: NameInput,
    look: Schema.optionalKey(LookInput),
    rank: Schema.optionalKey(RankInput),
    calling: Schema.optionalKey(CallingInput),
    code: Schema.String,
    visibility: RoomVisibilitySchema,
  }),
)
export const InternalJoin = Schema.fromJsonString(
  Schema.Struct({
    playerId: Schema.String,
    name: NameInput,
    look: Schema.optionalKey(LookInput),
    rank: Schema.optionalKey(RankInput),
    calling: Schema.optionalKey(CallingInput),
  }),
)

export const INTERNAL_PATHS = {
  create: '/internal/room/create',
  join: '/internal/room/join',
}

export const ROOM_CODE_HEADER = 'x-room-code'

// NOTE: when the watchdog or the cleanup should run next. A room with a
// game checks its loop every minute; any other room is deleted a day after
// its last change.
const WATCHDOG_MS = 60 * 1000
export const DELETE_AFTER_MS = 24 * 60 * 60 * 1000
export const STALLED_LOOP_MS = 5000

export type AlarmDecision =
  | { readonly _tag: 'CheckLoop'; readonly nextMs: number }
  | { readonly _tag: 'Interrupted'; readonly nextMs: number }
  | { readonly _tag: 'Delete' }
  | { readonly _tag: 'Later'; readonly nextMs: number }

export const decideAlarm = (options: {
  readonly nowMs: number
  readonly gameRunning: boolean
  readonly lobby: Option.Option<Lobby>
  readonly socketsOpen: number
}): AlarmDecision => {
  const { nowMs } = options
  if (options.gameRunning) {
    return { _tag: 'CheckLoop', nextMs: nowMs + WATCHDOG_MS }
  }
  return Option.match(options.lobby, {
    onNone: (): AlarmDecision => ({ _tag: 'Delete' }),
    onSome: (lobby): AlarmDecision => {
      if (lobby.status === 'Playing') {
        return { _tag: 'Interrupted', nextMs: nowMs + WATCHDOG_MS }
      }
      const due = lobby.updatedMs + DELETE_AFTER_MS
      return due <= nowMs && options.socketsOpen === 0
        ? { _tag: 'Delete' }
        : { _tag: 'Later', nextMs: Math.max(due, nowMs + WATCHDOG_MS) }
    },
  })
}

// QUICK PLAY

// NOTE: what a public room tells the Matchmaker after its lobby changed:
// how many it seats, and whether it still takes players. A private room
// says nothing.
export const listingOf = (
  lobby: Lobby,
): Option.Option<Matchmaking.RoomListing> =>
  lobby.visibility === 'Public'
    ? Option.some({
        code: lobby.code,
        members: lobby.members.length,
        open: isOpenToQuickPlay(lobby),
      })
    : Option.none()
